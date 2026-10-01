import { createComponentConfigController } from './component-config-controller.js';
import { requestScene } from './scene-editor-state.js';
import { validateSceneDocument } from './scene-template.js';

let cached;

export async function prepareComponentPreviewCanvas(components, request = requestScene) {
  const danmaku = components.find(({ id }) => id === 'danmaku')?.controller;
  if (danmaku?.getState().loading) {
    await new Promise((resolve) => {
      const stop = danmaku.subscribe((state) => {
        if (!state.loading) queueMicrotask(() => { stop(); resolve(); });
      });
    });
  }
  const owners = components.map(({ controller }) => [controller, controller.getState().generation]);
  if (cached?.request === request && cached.owners.length === owners.length
    && owners.every(([controller, generation], index) =>
      cached.owners[index][0] === controller && cached.owners[index][1] === generation)) return cached.promise;
  const entry = { owners, request };
  cached = entry;
  function assertCurrent() {
    if (owners.some(([controller, generation]) => controller.getState().generation !== generation)) {
      throw new Error('配置来源已变化，请重新打开画布。');
    }
  }
  entry.promise = (async () => {
    const scenes = await request('list');
    assertCurrent();
    const dto = scenes[0] || await request('create', { title: '直播画布',
      canvas: danmaku?.getState().draft.layout?.canvas || { width: 1920, height: 1080 } });
    assertCurrent();
    const id = dto.document.id;
    let revision = dto.revision;
    let publishedVersion = dto.publishedVersion || 0;
    let stale = false;
    const conflictMessage = '画布已在其他入口更新，草稿已保留。点击“放弃修改”可读取最新画布。';
    const controller = createComponentConfigController({
      initial: { document: dto.document },
      read: async () => {
        assertCurrent();
        const next = await request('document', undefined, id);
        assertCurrent();
        revision = next.revision;
        publishedVersion = next.publishedVersion || 0;
        return { document: next.document };
      },
      validate: ({ document }) => {
        assertCurrent();
        validateSceneDocument(document);
        if (document.id !== id) throw new Error('画布标识不匹配，请重新打开。');
      },
      persist: async ({ document }) => {
        assertCurrent();
        let next;
        try { next = await request('save', { id, expectedRevision: revision, document }); }
        catch (error) {
          if (error.status === 409) {
            stale = true;
            throw new Error(conflictMessage);
          }
          throw error;
        }
        assertCurrent();
        revision = next.revision;
        return { document: next.document };
      },
    });
    controller.receive({ document: dto.document });
    const getState = controller.getState;
    controller.getState = () => ({ ...getState(), ...(stale ? { error: conflictMessage } : {}) });
    const discard = controller.discard;
    controller.discard = () => {
      const discarded = discard();
      if (discarded && stale) { stale = false; void controller.reload(); }
      return discarded;
    };
    return { id: 'canvas', title: '公共画布', controller,
      async publish() {
        assertCurrent();
        for (const entry of [...components, { title: '公共画布', controller }]) {
          const state = entry.controller.getState();
          if (!state.loaded || state.loading) throw new Error(`${entry.title || entry.id}尚未读取完成。`);
          if (state.dirty || state.saving) await entry.controller.save();
          assertCurrent();
          const next = entry.controller.getState();
          if (next.error || next.dirty) throw new Error(`${entry.title || entry.id}：${next.error || '仍有未保存修改，请再次保存并应用。'}`);
        }
        const sharedTypes = new Set(controller.getState().saved.document.items
          .filter((item) => item.appearance.mode === 'shared').map((item) => item.type));
        const expectedDefaults = Object.fromEntries(components.filter((entry) => sharedTypes.has(entry.id))
          .map((entry) => {
            const { saved } = entry.controller.getState();
            return [entry.id, entry.projectConfig?.(saved) || saved];
          }));
        let next;
        try { next = await request('publish', { id, expectedRevision: revision, expectedDefaults }); }
        catch (error) {
          if (error.status === 409) { stale = true; throw new Error(conflictMessage); }
          throw error;
        }
        assertCurrent();
        publishedVersion = next.publishedVersion;
        return { publishedVersion };
      },
      async source() {
        assertCurrent();
        if (!publishedVersion) throw new Error('请先保存并应用画布，再复制直播源地址。');
        const source = await request('source', undefined, id);
        assertCurrent();
        return { id, token: source.token };
      },
    };
  })().catch((error) => {
    if (cached === entry) cached = null;
    throw error;
  });
  return entry.promise;
}
