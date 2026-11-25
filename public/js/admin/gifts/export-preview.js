import {
  BANNER_WIDTH,
  BANNER_HEIGHT,
  BANNER_GAP,
  createGiftBanner,
  createGiftArtworkResolver,
  readyGiftImages,
} from '../../shared/gift-banner.js';
import { getRoomGuardState } from '../../shared/bilibili-room-guard.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgIcon(shapes, { className = '', strokeWidth = '1.9' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

function formatSubdirectory(root, directory) {
  const base = String(root || '');
  const full = String(directory || '');
  if (base && full.startsWith(base)) {
    const rest = full.slice(base.length);
    if (rest.startsWith('\\') || rest.startsWith('/')) return rest;
  }
  return full;
}

function createMetric(prefix, count, suffix) {
  const span = document.createElement('span');
  if (prefix) span.append(prefix);
  const strong = document.createElement('strong');
  strong.textContent = String(count);
  span.append(strong, suffix);
  return span;
}

function createSeparator() {
  const sep = document.createElement('span');
  sep.className = 'gift-export-sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = '·';
  return sep;
}

export function createGiftExportPreview({ showPane }) {
  const get = (id) => document.getElementById(id);
  let task = null;
  let page = 0;
  let running = false;
  let configuring = false;
  let attempted = false;
  let retry = false;
  let sequence = 0;
  let artworkCatalog;
  let artwork;
  const status = (text, state = '') => {
    get('giftExportStatus').textContent = text;
    get('giftExportStatus').dataset.state = state;
  };
  const run = (operation) =>
    Promise.resolve()
      .then(operation)
      .catch((error) => status(error.message, 'error'));
  const unwrap = (result) => {
    if (!result.ok) throw new Error(result.error);
    return result.data;
  };

  function renderSummary(selectedCount, cardCount, fileCount) {
    const pill = document.createElement('span');
    pill.className = 'gift-export-output-pill';
    const dot = document.createElement('span');
    dot.className = 'gift-export-output-dot';
    dot.setAttribute('aria-hidden', 'true');
    pill.append(dot, `输出 ${fileCount} 张 PNG`);
    const arrow = createSvgIcon(
      [
        ['path', { d: 'M5 12h14' }],
        ['path', { d: 'm13 6 6 6-6 6' }],
      ],
      { className: 'gift-export-summary-arrow', strokeWidth: '2' },
    );
    get('giftExportSummary').replaceChildren(
      createMetric('已选 ', selectedCount, ' 条'),
      createSeparator(),
      createMetric('', cardCount, ' 张卡片'),
      arrow,
      pill,
    );
  }

  function renderFileMeta(fileName, width, height, split) {
    const name = document.createElement('span');
    name.className = 'gift-export-file-name';
    name.append(
      createSvgIcon(
        [
          ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
          ['circle', { cx: '9', cy: '9', r: '2' }],
          ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
        ],
        { strokeWidth: '1.8' },
      ),
      fileName,
    );
    const size = document.createElement('span');
    size.textContent = `${width} × ${height} px`;
    const nodes = [name, createSeparator(), size];
    if (split) {
      const badge = document.createElement('span');
      badge.className = 'gift-export-split-badge';
      badge.title = '单张高度上限 6224 px，超过 39 条自动拆分';
      badge.textContent = '自动拆图 · ≤39条/张';
      nodes.push(badge);
    }
    get('giftExportFiles').replaceChildren(...nodes);
  }

  function setRadioValue(groupId, value) {
    get(groupId)
      ?.querySelectorAll('input[type="radio"]')
      .forEach((input) => {
        input.checked = input.value === value;
      });
  }

  async function render() {
    if (!task) return;
    if (artworkCatalog !== task.snapshot.catalog) {
      artworkCatalog = task.snapshot.catalog;
      artwork = createGiftArtworkResolver(artworkCatalog);
    }
    const files = task.files;
    page = Math.min(page, files.length - 1);
    const file = files[page];
    const items = task.snapshot.items.slice(file.start, file.start + file.count);
    renderSummary(task.snapshot.selectedCount ?? task.snapshot.items.length, task.snapshot.items.length, files.length);
    const dirNode = get('giftExportDirectory');
    dirNode.textContent = formatSubdirectory(task.root, task.directory);
    dirNode.title = task.directory;
    get('giftExportPage').textContent = `${page + 1} / ${files.length}`;
    get('giftExportPrev').disabled = page === 0;
    get('giftExportNext').disabled = page === files.length - 1;
    reflectSettings();
    const rootNode = get('giftExportSettingsDirectory');
    rootNode.textContent = task.root;
    rootNode.title = task.root;
    const preview = get('giftExportPreview');
    preview.dataset.background = task.background;
    preview.style.background = task.background === 'white' ? '#fff' : 'transparent';
    preview.replaceChildren(
      ...items.map((item) => createGiftBanner(item, { ...task.snapshot.config, sheen: false }, artwork)),
    );
    const width = Math.max(BANNER_WIDTH * 2, Math.ceil(preview.getBoundingClientRect().width * 2));
    const height = (items.length * BANNER_HEIGHT + (items.length - 1) * BANNER_GAP) * 2;
    renderFileMeta(file.fileName, width, height, task.mode === 'combined' && files.length > 1);
    updateSaveLabel();
    await readyGiftImages(preview);
  }

  function reflectSettings() {
    setRadioValue('giftExportMode', task.mode);
    setRadioValue('giftExportBackground', task.background);
    get('giftExportMergeAcrossDates').checked = task.mergeAcrossDates === true;
  }

  function previewStatus(readyText = '') {
    if (task.snapshot.cardsPartial) status('部分礼物无法确认送礼人，已保留原卡片。', 'warning');
    else if (task.snapshot.partial) status('当前预览仅包含已同步的礼物记录。', 'warning');
    else status(readyText);
  }

  function updateSaveLabel() {
    const label = get('giftExportSaveLabel') || get('giftExportSave');
    const fileCount = task?.files?.length;
    label.textContent = running
      ? '正在导出…'
      : retry
        ? '重新导出'
        : fileCount
          ? `导出 ${fileCount} 张 PNG`
          : '导出 PNG';
  }

  function controls() {
    get('giftExportSave').disabled = running || configuring || (attempted && !retry);
    updateSaveLabel();
    get('giftExportSettingsFields').disabled = running || configuring;
    get('giftExportCancel').hidden = !running;
  }

  function close() {
    sequence += 1;
    if (task) window.giftExport?.cancel(task.id);
    task = null;
    artworkCatalog = artwork = null;
    running = false;
    configuring = false;
    showPane('list');
  }

  async function configure(options) {
    if (!task || running || configuring) return;
    const request = sequence;
    configuring = true;
    controls();
    if (options.directoryAction !== 'choose') status('正在更新导出设置…');
    try {
      const next = unwrap(
        await window.giftExport.configure({
          id: task.id,
          mode: task.mode,
          background: task.background,
          ...options,
          remember: true,
        }),
      );
      if (request !== sequence) return;
      // Choosing a folder allocates a fresh directory even when the root stays the same.
      if (options.directoryAction === 'choose' && next.directory === task.directory) return;
      task = next;
      attempted = false;
      retry = false;
      page = 0;
      get('giftExportOpenFolder').hidden = true;
      await render();
      if (request !== sequence) return;
      unwrap(await window.giftExport.settings({
        mode: next.mode, background: next.background, mergeAcrossDates: next.mergeAcrossDates,
      }));
      if (request === sequence) previewStatus();
    } catch (error) {
      if (request === sequence) {
        reflectSettings();
        status(error.message, 'error');
      }
    } finally {
      if (request === sequence) {
        configuring = false;
        controls();
      }
    }
  }

  get('giftExportMode')?.addEventListener('change', (event) => {
    if (event.target.matches('input[type="radio"]')) configure({ mode: event.target.value });
  });
  get('giftExportBackground')?.addEventListener('change', (event) => {
    if (event.target.matches('input[type="radio"]')) configure({ background: event.target.value });
  });
  get('giftExportMergeAcrossDates')?.addEventListener('change', (event) => configure({ mergeAcrossDates: event.target.checked }));
  get('giftExportChoose')?.addEventListener('click', () => configure({ directoryAction: 'choose' }));
  get('giftExportDefault')?.addEventListener('click', () => configure({ directoryAction: 'default' }));
  get('giftExportBack')?.addEventListener('click', close);
  get('giftExportCancel')?.addEventListener('click', () => window.giftExport?.cancel(task?.id));
  get('giftExportPrev')?.addEventListener('click', () => {
    page -= 1;
    run(render);
  });
  get('giftExportNext')?.addEventListener('click', () => {
    page += 1;
    run(render);
  });
  get('giftExportOpenFolder')?.addEventListener('click', () =>
    run(async () => unwrap(await window.giftExport.openFolder(task.id))),
  );
  get('giftExportSave')?.addEventListener('click', () =>
    run(async () => {
      if (!task || running || configuring || (attempted && !retry)) return;
      let current = task;
      const roomGuard = getRoomGuardState();
      running = true;
      attempted = true;
      controls();
      status('正在生成图片…');
      const unsubscribe = window.giftExport.onProgress((progress) => {
        if (task === current && progress.id === current.id) status(`已保存 ${progress.saved} / ${progress.total} 张`);
      });
      try {
        if (retry) {
          const next = unwrap(await window.giftExport.configure({
            id: current.id, mode: current.mode, background: current.background,
          }));
          if (task !== current) return;
          task = current = next;
          retry = false;
          get('giftExportOpenFolder').hidden = true;
          await render();
          if (task !== current) return;
        }
        const result = await window.giftExport.save(current.id, roomGuard);
        if (task !== current) return;
        retry = !result.ok && !result.cancelled;
        status(
          result.ok ? `已保存 ${result.saved} 张 PNG`
            : `${result.error}。已保存 ${result.saved || 0} 张，文件已保留。${retry ? '重新导出会创建新文件夹并重新生成全部图片。' : ''}`,
          result.ok ? 'success' : 'error',
        );
        get('giftExportOpenFolder').hidden = !(result.saved > 0);
      } catch (error) {
        if (task === current) {
          retry = true;
          status(error.message, 'error');
        }
      } finally {
        unsubscribe();
        if (task === current) {
          running = false;
          controls();
        }
      }
    }),
  );

  return {
    close,
    async open(selection) {
      if (!window.giftExport) throw new Error('请在 LIRA 桌面客户端中导出图片。');
      const request = ++sequence;
      const next = unwrap(await window.giftExport.prepare(selection));
      if (request !== sequence) {
        window.giftExport.cancel(next.id);
        return;
      }
      task = next;
      configuring = false;
      attempted = false;
      retry = false;
      page = 0;
      get('giftExportOpenFolder').hidden = true;
      previewStatus();
      showPane('export');
      controls();
      await render();
    },
  };
}
