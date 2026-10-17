import { createFontLibraryToast } from './font-library-toast.js';
import { createGiftCatalogUpdateToast } from './gifts/catalog-update-toast.js';

// Share the existing progress subscriptions; downloads remain owned by the desktop services.
export function createResourceDownloads({ window: windowRef = globalThis.window,
  document: documentRef = globalThis.document, bridge = windowRef?.liraLicense,
  eventBus } = {}) {
  const region = documentRef.getElementById('resourceDownloads');
  const container = documentRef.getElementById('resourceDownloadList');
  const rows = [];
  const controllers = [];
  let initialized = false;
  let disposed = false;

  function createTask(label, isDownloading) {
    const row = documentRef.createElement('li');
    row.className = 'resource-download-row';
    row.hidden = true;
    const heading = documentRef.createElement('div');
    heading.className = 'resource-download-heading';
    const name = documentRef.createElement('strong');
    name.textContent = label;
    const percent = documentRef.createElement('span');
    const progress = documentRef.createElement('progress');
    progress.setAttribute('aria-label', `${label}下载进度（按文件数）`);
    const details = documentRef.createElement('p');
    details.className = 'hint';
    heading.append(name, percent);
    row.append(heading, progress, details);
    container.append(row);
    rows.push(row);

    return (state = {}) => {
      if (disposed) return;
      row.hidden = !isDownloading(state);
      region.hidden = rows.every(item => item.hidden);
      if (row.hidden) return;
      const total = state.total || 0;
      const completed = state.completed || 0;
      percent.textContent = total ? `${Math.floor(completed / total * 100)}%` : '准备下载';
      progress.max = total || 1;
      if (total) progress.value = completed;
      else progress.removeAttribute('value');
      details.textContent = [total ? `已处理 ${completed} / ${total}` : '', state.currentFont,
        state.failed ? `失败 ${state.failed}` : ''].filter(Boolean).join(' · ');
      details.hidden = !details.textContent;
    };
  }

  async function init() {
    if (initialized || disposed || !region || !container) return;
    initialized = true;
    const fonts = createTask('共享字体', state => state.status === 'downloading');
    const gifts = createTask('礼物图片', state =>
      ['running', 'updating'].includes(state.status) && state.phase === 'images');
    controllers.push(
      createFontLibraryToast({ window: windowRef, document: documentRef, bridge, eventBus, onState: fonts }),
      createGiftCatalogUpdateToast({ window: windowRef, document: documentRef,
        licenseBridge: bridge, eventBus, onState: gifts }),
    );
    await Promise.all(controllers.map(controller => controller.init()));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    controllers.forEach(controller => controller.dispose());
  }

  return { init, dispose };
}

export function initResourceDownloads() {
  const controller = createResourceDownloads();
  void controller.init();
  return controller;
}
