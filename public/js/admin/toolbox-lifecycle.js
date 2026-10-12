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
    if (disposed || pageId !== ownerPageId || !loaders[selected] || initialized.has(selected)) return;
    let init;
    try {
      if (!loaded.has(selected)) loaded.set(selected, loaders[selected]());
      init = await loaded.get(selected);
    } catch (error) {
      loaded.delete(selected);
      if (!disposed) onError(error);
      return;
    }
    if (disposed || pageId !== ownerPageId || featureId !== selected || initialized.has(selected)) return;
    // Aliases can share one initializer. Its partial bindings require a fresh page.
    if (failedInitializers.has(init)) {
      onInitError(failedInitializers.get(init));
      return;
    }
    try {
      init();
      initialized.add(selected);
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
