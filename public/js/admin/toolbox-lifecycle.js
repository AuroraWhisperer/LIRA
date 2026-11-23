'use strict';

// Load optional editors only when their selected panel is visible.
export function createToolboxLifecycle({ loaders, onError, onInitError = onError, ownerPageId = 'otherAssistantPage' }) {
  const loaded = new Map();
  const initialized = new Set();
  const failedInitializers = new Map();
  let pageId = '';
  let featureId = '';
  let scheduled = false;
  let disposed = false;

  async function activate() {
    const selected = featureId;
    const load = loaders[selected];
    if (disposed || pageId !== ownerPageId || !load) return;
    let init;
    try {
      if (!loaded.has(load)) loaded.set(load, load());
      init = await loaded.get(load);
    } catch (error) {
      loaded.delete(load);
      if (!disposed) onError(error);
      return;
    }
    if (disposed || pageId !== ownerPageId || featureId !== selected || initialized.has(init)) return;
    // Aliases can share one initializer. Its partial bindings require a fresh page.
    if (failedInitializers.has(init)) {
      onInitError(failedInitializers.get(init));
      return;
    }
    try {
      init();
      initialized.add(init);
    } catch (error) {
      failedInitializers.set(init, error);
      onInitError(error);
    }
  }

  function schedule() {
    if (disposed || scheduled) return;
    scheduled = true;
    // Programmatic navigation can select a page and a feature in the same turn.
    queueMicrotask(() => {
      scheduled = false;
      activate();
    });
  }

  return {
    setPage(nextPageId) {
      pageId = nextPageId;
      schedule();
    },
    selectFeature(nextFeatureId) {
      featureId = nextFeatureId;
      schedule();
    },
    dispose() {
      disposed = true;
      loaded.clear();
      failedInitializers.clear();
    },
  };
}
