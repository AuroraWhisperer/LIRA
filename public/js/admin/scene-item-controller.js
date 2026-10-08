import { sharedControllerAppearance, mergeSharedAppearancePatch } from '../shared/scene-shared-appearance.js';

export function createSceneItemController(model, itemId, defaultController, sharedAppearance) {
  const getItem = () => model.getSnapshot().items.find(entry => entry.id === itemId);
  function readState() {
    const item = getItem();
    if (!item || item.appearance.mode === 'shared') return defaultController.getState();
    const owned = sharedAppearance?.getState(item);
    const defaults = defaultController.getState();
    const draft = sharedControllerAppearance(item.type, item.appearance.config, defaults.draft);
    const saved = sharedControllerAppearance(item.type, item.appearance.config, defaults.saved);
    const state = owned || (Object.keys(draft).length ? { ...defaults, draft, saved } : null);
    if (state) return { ...state, draft: { ...item.appearance.config, ...state.draft },
      saved: { ...item.appearance.config, ...state.saved } };
    return { loaded: true, loading: false, saving: false, error: '', conflict: false,
      draft: item.appearance.config, saved: item.appearance.config, dirty: false };
  }
  const getState = () => JSON.parse(JSON.stringify(readState()));
  return { getState,
    edit(change) {
      const current = getItem();
      if (!current || current.locked) return;
      if (current.appearance.mode === 'shared') { defaultController.edit(change); return; }
      const owned = sharedAppearance?.getState(current);
      const defaults = defaultController.getState();
      const shared = owned?.draft || sharedControllerAppearance(current.type, current.appearance.config, defaults.draft);
      const changingStyle = ['resourceStyle', 'mediaStyle', 'cssStyle'].some(key => Object.hasOwn(change, key))
        || !owned && ['style', 'displayStyle', 'overlayQueueStyle'].some(key => Object.hasOwn(change, key)
          && change[key] !== current.appearance.config[key]);
      const patch = changingStyle ? {} : Object.fromEntries(Object.entries(change).filter(([key]) => Object.hasOwn(shared, key)));
      if (Object.keys(patch).length) {
        if (owned) sharedAppearance.edit(current, patch);
        else defaultController.edit(mergeSharedAppearancePatch(defaults.draft, patch, current.appearance.config, current.type));
      }
      change = Object.fromEntries(Object.entries(change).filter(([key]) => !Object.hasOwn(patch, key)));
      if (!Object.keys(change).length) return;
      model.edit((document) => {
        const item = document.items.find((entry) => entry.id === itemId);
        if (item && !item.locked && item.appearance.mode === 'independent') {
          const styleChanged = ['style', 'displayStyle', 'overlayQueueStyle'].some(key => Object.hasOwn(change, key) && change[key] !== item.appearance.config[key]);
          if (styleChanged || change.mediaStyle === null || change.resourceStyle === null) delete item.appearance.config.cssStyle;
          Object.assign(item.appearance.config, change);
          if (change.cssStyle === null) delete item.appearance.config.cssStyle;
          if (change.mediaStyle === null) delete item.appearance.config.mediaStyle;
          if (change.resourceStyle === null) delete item.appearance.config.resourceStyle;
        }
      });
    },
    save() { const item = getItem(); return sharedAppearance?.getState(item) ? sharedAppearance.save(item) : defaultController.save?.(); },
    reload() { const item = getItem(); return sharedAppearance?.getState(item) ? sharedAppearance.reload() : defaultController.reload?.(); },
    discard() { const item = getItem(); return sharedAppearance?.getState(item) ? sharedAppearance.discard(item) : defaultController.discard?.(); },
    subscribe(listener) {
      let previous;
      const notify = () => {
        const state = readState();
        const serialized = JSON.stringify(state);
        if (serialized === previous) return;
        previous = serialized;
        listener(JSON.parse(serialized));
      };
      const stopModel = model.subscribeSnapshot(notify);
      const stopDefault = defaultController.subscribe(notify);
      const stopShared = sharedAppearance?.subscribe(notify);
      return () => { stopModel(); stopDefault(); stopShared?.(); };
    },
  };
}
