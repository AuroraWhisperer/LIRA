import { BANNER_WIDTH, BANNER_HEIGHT, BANNER_GAP, createGiftBanner, giftExportPages, readyGiftImages } from '../../shared/gift-banner.js';

export function createGiftExportPreview({ showPane }) {
  const get = (id) => document.getElementById(id);
  let task = null;
  let page = 0;
  let running = false;
  let configuring = false;
  let attempted = false;
  let sequence = 0;
  const status = (text, state = '') => {
    get('giftExportStatus').textContent = text;
    get('giftExportStatus').dataset.state = state;
  };
  const run = (operation) => Promise.resolve().then(operation).catch((error) => status(error.message, 'error'));
  const unwrap = (result) => { if (!result.ok) throw new Error(result.error); return result.data; };

  async function render() {
    if (!task) return;
    const pages = giftExportPages(task.snapshot.items, task.mode);
    page = Math.min(page, pages.length - 1);
    get('giftExportSummary').textContent = `已选 ${task.snapshot.selectedCount ?? task.snapshot.items.length} 条 · ${task.snapshot.items.length} 张卡片 · 输出 ${pages.length} 张 PNG`;
    get('giftExportDirectory').textContent = task.directory;
    get('giftExportPage').textContent = `${page + 1} / ${pages.length}`;
    get('giftExportPrev').disabled = page === 0;
    get('giftExportNext').disabled = page === pages.length - 1;
    get('giftExportMode').value = task.mode;
    get('giftExportBackground').value = task.background;
    get('giftExportSettingsDirectory').textContent = task.root;
    const preview = get('giftExportPreview');
    preview.style.background = task.background === 'white' ? '#fff' : 'transparent';
    preview.replaceChildren(...pages[page].map((item) => createGiftBanner(item, task.snapshot.config, task.snapshot.catalog)));
    const width = Math.max(BANNER_WIDTH * 2, Math.ceil(preview.getBoundingClientRect().width * 2));
    get('giftExportFiles').textContent = `${task.files[page].fileName} · ${width} × ${(pages[page].length * BANNER_HEIGHT + (pages[page].length - 1) * BANNER_GAP) * 2} 像素${task.mode === 'combined' && pages.length > 1 ? '；超过单图高度，已按每张最多 39 条拆分。' : ''}`;
    await readyGiftImages(preview);
  }

  function controls() {
    get('giftExportSave').disabled = running || configuring || attempted;
    get('giftExportSave').textContent = running ? '正在导出…' : '导出 PNG';
    get('giftExportSettingsFields').disabled = running || configuring;
    get('giftExportCancel').hidden = !running;
  }

  function close() {
    sequence += 1;
    if (task) window.giftExport?.cancel(task.id);
    task = null;
    running = false;
    configuring = false;
    showPane('list');
  }

  async function configure(options) {
    if (!task || running || configuring) return;
    const request = sequence;
    configuring = true;
    controls();
    status('正在更新导出设置…');
    try {
      const next = unwrap(await window.giftExport.configure({
        id: task.id, mode: task.mode, background: task.background, ...options, remember: true,
      }));
      if (request !== sequence) return;
      task = next;
      attempted = false;
      page = 0;
      get('giftExportOpenFolder').hidden = true;
      await render();
      if (request !== sequence) return;
      unwrap(await window.giftExport.settings({ mode: next.mode, background: next.background }));
      if (request === sequence) status('设置已保存，已应用于本次导出。');
    } catch (error) {
      if (request === sequence) {
        get('giftExportMode').value = task.mode;
        get('giftExportBackground').value = task.background;
        status(error.message, 'error');
      }
    } finally {
      if (request === sequence) {
        configuring = false;
        controls();
      }
    }
  }

  get('giftExportMode')?.addEventListener('change', (event) => configure({ mode: event.target.value }));
  get('giftExportBackground')?.addEventListener('change', (event) => configure({ background: event.target.value }));
  get('giftExportChoose')?.addEventListener('click', () => configure({ directoryAction: 'choose' }));
  get('giftExportDefault')?.addEventListener('click', () => configure({ directoryAction: 'default' }));
  get('giftExportBack')?.addEventListener('click', close);
  get('giftExportCancel')?.addEventListener('click', () => window.giftExport?.cancel(task?.id));
  get('giftExportPrev')?.addEventListener('click', () => { page -= 1; run(render); });
  get('giftExportNext')?.addEventListener('click', () => { page += 1; run(render); });
  get('giftExportOpenFolder')?.addEventListener('click', () => run(async () => unwrap(await window.giftExport.openFolder(task.id))));
  get('giftExportSave')?.addEventListener('click', () => run(async () => {
    if (!task || running || configuring || attempted) return;
    const current = task;
    running = true;
    attempted = true;
    controls();
    status('正在生成图片…');
    const unsubscribe = window.giftExport.onProgress((progress) => {
      if (task === current && progress.id === current.id) status(`已保存 ${progress.saved} / ${progress.total} 张`);
    });
    try {
      const result = await window.giftExport.save(current.id);
      if (task !== current) return;
      status(result.ok ? `已保存 ${result.saved} 张 PNG` : `${result.error}。已保存 ${result.saved || 0} 张，文件已保留。`, result.ok ? 'success' : 'error');
      get('giftExportOpenFolder').hidden = !(result.saved > 0);
    } finally {
      unsubscribe();
      if (task === current) {
        running = false;
        controls();
      }
    }
  }));

  return {
    close,
    async open(selection) {
      if (!window.giftExport) throw new Error('请在 LIRA 桌面客户端中导出图片。');
      const request = ++sequence;
      const next = unwrap(await window.giftExport.prepare(selection));
      if (request !== sequence) { window.giftExport.cancel(next.id); return; }
      task = next;
      configuring = false;
      attempted = false;
      page = 0;
      get('giftExportOpenFolder').hidden = true;
      status(task.snapshot.cardsPartial ? '身份资料暂不可用，部分礼物尚未合并。'
        : task.snapshot.partial ? '当前预览仅包含已同步的礼物记录。' : '请确认左侧预览效果后导出。',
        task.snapshot.cardsPartial || task.snapshot.partial ? 'warning' : '');
      showPane('export');
      controls();
      await render();
    },
  };
}
