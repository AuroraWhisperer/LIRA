import { sharedControllerAppearance, mergeSharedAppearancePatch, sceneAppearanceKey,
  SHARED_CONTROLLER_TYPES, hasInstalledAppearance } from '../shared/scene-shared-appearance.js';

export function createSceneItemController(model, itemId, defaultController, sharedAppearance) {
  const getItem = () => model.getItemSnapshot ? model.getItemSnapshot(itemId) : model.getSnapshot().items.find(entry => entry.id === itemId);
  function readState() {
    const item = getItem();
    if (!item || item.appearance.mode === 'shared') return defaultController.getState();
    let state = sharedAppearance?.getState(item);
    if (!state && SHARED_CONTROLLER_TYPES.includes(item.type) && !hasInstalledAppearance(item.appearance.config)) {
      const defaults = defaultController.getState();
      const draft = sharedControllerAppearance(item.type, item.appearance.config, defaults.draft);
      const saved = sharedControllerAppearance(item.type, item.appearance.config, defaults.saved);
      if (Object.keys(draft).length) state = { ...defaults, draft, saved };
    }
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
      const defaults = owned ? null : defaultController.getState();
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
      let previousItem;
      let sharedKey;
      let stopShared;
      const notify = () => {
        const state = readState();
        const serialized = JSON.stringify(state);
        if (serialized === previous) return;
        previous = serialized;
        listener(JSON.parse(serialized));
      };
      const stopModel = model.subscribeSnapshot(() => {
        const item = getItem();
        if (previous !== undefined && item?.type === previousItem?.type && item?.appearance === previousItem?.appearance) return;
        previousItem = item;
        const key = item && item.appearance.mode !== 'shared' ? sceneAppearanceKey(item.type, item.appearance.config) : null;
        if (key !== sharedKey) {
          stopShared?.();
          sharedKey = key;
          stopShared = key ? sharedAppearance?.subscribe(notify, item) : null;
        }
        notify();
      });
      const defaultChanged = () => {
        const item = getItem();
        if (item && item.appearance.mode !== 'shared'
          && (!SHARED_CONTROLLER_TYPES.includes(item.type) || hasInstalledAppearance(item.appearance.config))) return;
        notify();
      };
      const stopDefault = defaultController.subscribeChanges
        ? defaultController.subscribeChanges(defaultChanged) : defaultController.subscribe(defaultChanged);
      return () => { stopModel(); stopDefault(); stopShared?.(); };
    },
  };
}
