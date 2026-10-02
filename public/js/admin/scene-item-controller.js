export function createSceneItemController(model, itemId, defaultController) {
  function readState() {
    const item = model.getSnapshot().items.find((entry) => entry.id === itemId);
    if (!item || item.appearance.mode === 'shared') return defaultController.getState();
    return { loaded: true, loading: false, saving: false, error: '', conflict: false,
      draft: item.appearance.config, saved: item.appearance.config, dirty: false };
  }
  const getState = () => JSON.parse(JSON.stringify(readState()));
  return { getState,
    edit(change) {
      model.edit((document) => {
        const item = document.items.find((entry) => entry.id === itemId);
        if (item && !item.locked && item.appearance.mode === 'independent') Object.assign(item.appearance.config, change);
      });
    },
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
      return () => { stopModel(); stopDefault(); };
    },
  };
}
