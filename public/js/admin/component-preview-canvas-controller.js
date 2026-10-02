import { createComponentConfigController } from './component-config-controller.js';
import { createComponentSaveBatch } from './component-save-batch.js';
import { getCanvasPublicationEntries } from './component-preview-publication.js';
import { requestScene, readComponentOutputSize } from './scene-api.js';
import { validateSceneDocument } from './scene-template.js';

let cached;

export async function prepareComponentPreviewCanvas(components, request = requestScene) {
  const danmaku = components.find(({ id }) => id === 'danmaku')?.controller;
  const owners = components.map(({ controller }) => [controller, controller.getState().generation]);
  if (cached?.request === request && cached.owners.length === owners.length
    && owners.every(([controller, generation], index) =>
      cached.owners[index][0] === controller && cached.owners[index][1] === generation)) return cached.promise;
  const entry = { owners, request };
  cached = entry;
  function assertCurrent() {
    if (owners.some(([controller, generation]) => controller.getState().generation !== generation)) {
      throw new Error('配置来源已变化，请重新打开场景编辑器。');
    }
  }
  entry.promise = (async () => {
    const scenes = await request('list');
    assertCurrent();
    if (!scenes.length && danmaku?.getState().loading) {
      await new Promise((resolve) => {
        const stop = danmaku.subscribe((state) => {
          if (!state.loading) queueMicrotask(() => { stop(); resolve(); });
        });
      });
      assertCurrent();
    }
    const dto = scenes[0] || await request('create', { title: '直播场景',
      canvas: danmaku?.getState().draft.layout?.canvas || { width: 1920, height: 1080 } });
    assertCurrent();
    const id = dto.document.id;
    let revision = dto.revision;
    let publishedVersion = dto.publishedVersion || 0;
    let stale = false;
    const conflictMessage = '场景已在其他入口更新，草稿已保留。点击“放弃修改”可读取最新场景。';
    const configController = createComponentConfigController({
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
        if (document.id !== id) throw new Error('场景标识不匹配，请重新打开。');
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
    const getState = () => ({ ...configController.getState(), ...(stale ? { error: conflictMessage } : {}) });
    const controller = {
      ...configController,
      getState,
      subscribe(listener) { return configController.subscribe(() => listener(getState())); },
      discard() {
        const discarded = configController.discard();
        if (discarded && stale) { stale = false; void configController.reload(); }
        return discarded;
      },
    };
    controller.receive({ document: dto.document });
    return { id: 'canvas', title: '直播场景', controller,
      async getComponentSize(type, signal) {
        assertCurrent();
        const size = await readComponentOutputSize(type, signal);
        assertCurrent();
        return size;
      },
      async publish() {
        assertCurrent();
        const targets = getCanvasPublicationEntries([...components, { id: 'canvas', title: '直播场景', controller }]);
        const initial = controller.getState();
        let document = JSON.stringify(initial.saved.document);
        let expectedRevision = revision;
        let saving = false;
        let confirmed = !initial.dirty;
        for (const entry of targets) {
          const state = entry.controller.getState();
          if (!state.loaded || state.loading) throw new Error(`${entry.title || entry.id}尚未读取完成。`);
          if (state.saving || state.conflict) throw new Error(`${entry.title || entry.id}：正在保存或存在配置冲突，请处理后重试。`);
        }
        const stop = controller.subscribe((state) => {
          // Capture this save's normalized result once, before waiting for other
          // owners. Later clean receives or saves must not move the boundary.
          if (!confirmed && saving && !state.saving) {
            document = JSON.stringify(state.saved.document);
            expectedRevision = revision;
            confirmed = true;
          }
          saving = state.saving;
        });
        const batch = createComponentSaveBatch(targets);
        let results;
        try { results = await batch.save(targets.map(({ id }) => id)); }
        finally { batch.dispose(); stop(); }
        assertCurrent();
        for (const entry of targets) {
          const next = entry.controller.getState();
          const error = results[entry.id].error || next.error;
          if (error || !next.loaded || next.loading || next.saving || next.conflict || next.dirty
            || ['failed', 'not-submitted'].includes(results[entry.id].status)) {
            throw new Error(`${entry.title || entry.id}：${error || '仍有未保存修改或状态已变化，请再次保存并应用。'}`);
          }
        }
        if (controller.getState().generation !== initial.generation || revision !== expectedRevision
          || JSON.stringify(controller.getState().saved.document) !== document) throw new Error('场景已变化，请再次保存并应用。');
        const expectedDefaults = Object.fromEntries(targets.filter((entry) => entry.id !== 'canvas')
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
        if (!publishedVersion) throw new Error('请先保存并应用场景，再复制直播源地址。');
        const source = await request('source', undefined, id);
        assertCurrent();
        return { id, token: source.token, itemIds: source.itemIds };
      },
    };
  })().catch((error) => {
    if (cached === entry) cached = null;
    throw error;
  });
  return entry.promise;
}
