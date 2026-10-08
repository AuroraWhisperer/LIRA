import { createComponentConfigController } from './component-config-controller.js';
import { createComponentSaveBatch } from './component-save-batch.js';
import { getCanvasPublicationEntries } from './component-preview-publication.js';
import { requestScene, readComponentOutputSize } from './scene-api.js';
import { validateSceneDocument } from './scene-template.js';
import { startOpeningCanvasData } from './opening-canvas-data.js';
import { startGamesCanvasData } from './games-canvas-data.js';
import { startGiftWishesCanvasData } from './gift-wishes-canvas-data.js';

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
    const binding = await request('canvas');
    assertCurrent();
    const presets = new Map();
    const listeners = new Set();
    let active;
    let busy = false;
    function notify() {
      if (active) for (const listener of listeners) listener(controller.getState());
    }
    function createPreset(dto) {
      const id = dto.document.id;
      let revision = dto.revision;
      let stale = false;
      const conflictMessage = '场景已在其他入口更新，草稿已保留。点击“放弃修改”可读取最新场景。';
      const configController = createComponentConfigController({
        initial: { document: dto.document },
        read: async () => {
          assertCurrent();
          const next = await request('document', undefined, id);
          assertCurrent();
          revision = next.revision;
          Object.assign(binding, await request('canvas'));
          assertCurrent();
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
        async delete() {
          assertCurrent();
          await request('delete', { id, expectedRevision: revision });
          assertCurrent();
        },
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
          const sharedTypes = new Set(JSON.parse(document).items.filter(item => item.appearance.mode === 'shared').map(item => item.type));
          const expectedDefaults = Object.fromEntries(targets.filter((entry) => sharedTypes.has(entry.id))
            .map((entry) => {
              const { saved } = entry.controller.getState();
              return [entry.id, entry.projectConfig?.(saved) || saved];
            }));
          let next;
          try { next = await request('canvas-publish', { id, expectedRevision: revision, expectedDefaults,
            expectedPublishedVersion: binding.publishedVersion }); }
          catch (error) {
            if (error.status === 409) { stale = true; throw new Error(conflictMessage); }
            throw error;
          }
          assertCurrent();
          binding.publishedVersion = next.publishedVersion;
          binding.activeSceneId = id;
          binding.activeSceneTitle = JSON.parse(document).title;
          notify();
          return { publishedVersion: binding.publishedVersion };
        },
        async source() {
          assertCurrent();
          if (!binding.publishedVersion) throw new Error('请先保存并应用场景，再复制直播源地址。');
          const source = await request('source', undefined, binding.outputId);
          assertCurrent();
          return { id: binding.outputId, token: source.token, itemIds: source.itemIds };
        },
      };
    }
    function retain(dto) {
      const preset = createPreset(dto);
      presets.set(dto.document.id, preset);
      preset.unsubscribe = preset.controller.subscribe(notify);
      return preset;
    }
    for (const record of scenes.length ? scenes : [dto]) retain(record);
    active = presets.get(binding.activeSceneId) || presets.get(dto.document.id);
    const controller = {
      getState() {
        return { ...active.controller.getState(),
          presets: [...presets].map(([id, preset]) => {
            const state = preset.controller.getState();
            return { id, title: state.draft.document.title, dirty: state.dirty };
          }), activeSceneId: binding.publishedVersion ? binding.activeSceneId : null,
          activeSceneTitle: binding.activeSceneTitle || '' };
      },
      subscribe(listener) { listeners.add(listener); listener(controller.getState()); return () => listeners.delete(listener); },
      ...Object.fromEntries(['edit', 'save', 'prepareSave', 'discard', 'reload', 'receive', 'reset'].map(method =>
        [method, (...args) => active.controller[method](...args)])),
    };
    async function exclusive(action) {
      assertCurrent();
      if (busy || active.controller.getState().saving) throw new Error('场景正在保存，请稍后重试。');
      busy = true;
      try { return await action(); } finally { busy = false; }
    }
    return { id: 'canvas', title: '直播场景', controller,
      startActualData(emit) {
        const previewData = {};
        const receive = data => {
          Object.assign(previewData, data.previewData);
          emit({ previewData: { ...previewData } });
        };
        const stopOpening = startOpeningCanvasData(controller, receive);
        const stopGames = startGamesCanvasData(controller, receive);
        const stopWishes = startGiftWishesCanvasData(controller, receive);
        return () => { stopOpening(); stopGames(); stopWishes(); };
      },
      getComponentSize: (...args) => active.getComponentSize(...args),
      source: () => active.source(),
      publish: () => exclusive(() => active.publish()),
      preset: input => exclusive(async () => {
        if (input?.action === 'select') {
          const next = presets.get(input.id);
          if (!next) throw new Error('场景不存在，请重新打开画布。');
          active = next;
        } else if (input?.action === 'create') {
          const original = active.controller.getState().draft.document;
          const created = await request('create', { title: input.title, canvas: original.canvas });
          assertCurrent();
          const next = retain(created);
          if (input.duplicate) {
            const items = original.items.map(item => {
              const component = components.find(entry => entry.id === item.type);
              const draft = component?.controller.getState().draft;
              return { ...item, id: crypto.randomUUID(), appearance: item.appearance.mode === 'shared'
                ? { mode: 'independent', config: component.projectConfig?.(draft) || draft } : item.appearance };
            });
            next.controller.edit({ document: { ...created.document, items } });
          }
          active = next;
        } else if (input?.action === 'delete') {
          const id = active.controller.getState().draft.document.id;
          if (input.id !== id) throw new Error('当前场景已变化，请重新选择后删除。');
          await active.delete();
          active.unsubscribe();
          presets.delete(id);
          active = presets.get(binding.activeSceneId) || presets.values().next().value;
        } else throw new Error('不支持的场景操作。');
        notify();
        return { id: active.controller.getState().draft.document.id };
      }),
    };
  })().catch((error) => {
    if (cached === entry) cached = null;
    throw error;
  });
  return entry.promise;
}
