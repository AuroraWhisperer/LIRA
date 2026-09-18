import { createGiftBanner, giftExportPages, readyGiftImages } from '../../shared/gift-banner.js';

export function createGiftExportPreview({ showPane }) {
  const get = (id) => document.getElementById(id);
  let task = null;
  let page = 0;
  let running = false;
  let sequence = 0;
  const status = (text) => { get('giftExportStatus').textContent = text; };
  const run = (operation) => Promise.resolve().then(operation).catch((error) => status(error.message));
  const unwrap = (result) => { if (!result.ok) throw new Error(result.error); return result.data; };

  async function render() {
    if (!task) return;
    const pages = giftExportPages(task.snapshot.items, task.mode);
    page = Math.min(page, pages.length - 1);
    get('giftExportSummary').textContent = `已选 ${task.snapshot.items.length} 条 · 输出 ${pages.length} 张 PNG`;
    get('giftExportDirectory').textContent = task.directory;
    get('giftExportPage').textContent = `${page + 1} / ${pages.length}`;
    get('giftExportPrev').disabled = page === 0;
    get('giftExportNext').disabled = page === pages.length - 1;
    get('giftExportMode').value = task.mode;
    get('giftExportBackground').value = task.background;
    get('giftExportFiles').textContent = `${task.files[page].fileName} · 800 × ${pages[page].length * 192 + (pages[page].length - 1) * 16} 像素${task.mode === 'combined' && pages.length > 1 ? '；超过单图高度，已按每张最多 39 条拆分。' : ''}`;
    const preview = get('giftExportPreview');
    preview.style.background = task.background === 'white' ? '#fff' : 'transparent';
    preview.replaceChildren(...pages[page].map((item) => createGiftBanner(item, task.snapshot.config, task.snapshot.catalog)));
    await readyGiftImages(preview);
  }

  async function configure(directoryAction) {
    if (!task || running) return;
    const current = task;
    const next = unwrap(await window.giftExport.configure({ id: current.id,
      mode: get('giftExportMode').value, background: get('giftExportBackground').value,
      directoryAction, remember: get('giftExportRemember').checked }));
    if (task !== current) return;
    task = next;
    await render();
    controls();
  }

  function controls() {
    for (const id of ['giftExportSave', 'giftExportMode', 'giftExportBackground', 'giftExportChoose', 'giftExportDefault', 'giftExportRemember']) {
      get(id).disabled = running;
    }
    get('giftExportCancel').hidden = !running;
  }

  function close() {
    sequence += 1;
    if (task) window.giftExport?.cancel(task.id);
    task = null;
    running = false;
    showPane('list');
  }

  get('giftExportBack')?.addEventListener('click', close);
  get('giftExportCancel')?.addEventListener('click', () => window.giftExport?.cancel(task?.id));
  get('giftExportMode')?.addEventListener('change', () => run(() => configure()));
  get('giftExportBackground')?.addEventListener('change', () => run(() => configure()));
  get('giftExportChoose')?.addEventListener('click', () => run(() => configure('choose')));
  get('giftExportDefault')?.addEventListener('click', () => run(() => configure('default')));
  get('giftExportRemember')?.addEventListener('change', () => run(() => configure()));
  get('giftExportPrev')?.addEventListener('click', () => { page -= 1; run(render); });
  get('giftExportNext')?.addEventListener('click', () => { page += 1; run(render); });
  get('giftExportOpenFolder')?.addEventListener('click', () => run(async () => unwrap(await window.giftExport.openFolder(task.id))));
  get('giftExportSave')?.addEventListener('click', () => run(async () => {
    if (!task || running) return;
    const current = task;
    running = true;
    controls();
    status('正在生成图片…');
    const unsubscribe = window.giftExport.onProgress((progress) => {
      if (task === current && progress.id === current.id) status(`已保存 ${progress.saved} / ${progress.total} 张`);
    });
    try {
      const result = await window.giftExport.save(current.id);
      if (task !== current) return;
      status(result.ok ? `已保存 ${result.saved} 张` : `${result.error}。已保存 ${result.saved || 0} 张，文件已保留。`);
      get('giftExportOpenFolder').hidden = !(result.saved > 0);
    } finally {
      unsubscribe();
      if (task === current) {
        running = false;
        controls();
        get('giftExportSave').disabled = true;
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
      page = 0;
      get('giftExportRemember').checked = false;
      get('giftExportOpenFolder').hidden = true;
      status(task.snapshot.partial ? '当前预览仅包含已同步记录，内容和样式已冻结。' : '记录和样式已冻结，可确认后导出。');
      showPane('export');
      controls();
      await render();
    },
  };
}
