'use strict';

// Load optional editors only when their selected panel is visible.
export function createToolboxLifecycle({ loaders, onError }) {
  const loaded = new Map();
  const initialized = new Set();
  let pageId = '';
  let featureId = '';
  let scheduled = false;
  let disposed = false;

  async function activate() {
    const selected = featureId;
    if (
      disposed ||
      pageId !== 'otherAssistantPage' ||
      !loaders[selected] ||
      initialized.has(selected)
    )
      return;
    try {
      if (!loaded.has(selected)) loaded.set(selected, loaders[selected]());
      const init = await loaded.get(selected);
      if (
        disposed ||
        pageId !== 'otherAssistantPage' ||
        featureId !== selected ||
        initialized.has(selected)
      )
        return;
      initialized.add(selected);
      init();
    } catch (error) {
      loaded.delete(selected);
      if (!disposed) onError(error);
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
    },
  };
}
