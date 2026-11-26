import './contextual-help.js';
import { previewElement, previewToolbarIcon } from './component-preview-elements.js';
import { loadComponentStyleCss, requestComponentStyles } from './component-style-api.js';
import { formatBytes } from '../shared/display-format.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';

const categoryName = type => SCENE_EXTRA_COMPONENTS[type]?.title
  || ({ suite: '套装', clock: '时钟', danmaku: '弹幕姬', queue: '点歌板', browser: '浏览器源', 'text-box': '文本框', overtime: '加班机' })[type] || type;

const LIBRARY_ICONS = {
  box: 'M3 8.5 12 4l9 4.5-9 4.5L3 8.5ZM3 8.5V16l9 4.5 9-4.5V8.5M12 13v7.5',
  suite: 'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z',
  danmaku: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 1-2Zm3 5h9M8 13h6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  background: 'M3 4h18v16H3Zm0 12 5-5 4 4 3-3 6 6M16 8h.01',
  opening: 'M3 5h18v14H3Zm7 4 5 3-5 3Z',
  gift: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Zm12-2a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
  cleanup: 'M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14',
  export: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  restore: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5',
};

function libraryIcon(name) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', LIBRARY_ICONS[name] || LIBRARY_ICONS.box);
  icon.append(shape);
  return icon;
}

function packageIconName(target) {
  if (target === 'suite') return 'suite';
  if (target === 'danmaku') return 'danmaku';
  if (target === 'clock' || target === 'overtime') return 'clock';
  if (target === 'background') return 'background';
  if (target === 'opening') return 'opening';
  if (['queue', 'songlist', 'lyrics', 'now-playing'].includes(target)) return 'music';
  if (['gift-frame', 'guard-thanks', 'gift-wishes', 'gift-feed', 'gift-sprint', 'heart-box-collection', 'blindbox'].includes(target)) return 'gift';
  return 'box';
}

function createHelp(label, description) {
  const help = document.createElement('lira-help');
  help.setAttribute('label', label);
  help.textContent = description;
  return help;
}

function segmentPercent(bytes, total) {
  if (!total || !bytes) return '0%';
  return `${Math.max(4, Math.round((bytes / total) * 1000) / 10)}%`;
}

export function openComponentLibraryManager({ request = requestComponentStyles, onUpdate, onChanged, onRestored }) {
  loadComponentStyleCss();
  const dialog = previewElement('dialog', 'component-library-manager');
  dialog.setAttribute('aria-label', '素材管理');
  dialog.tabIndex = -1;
  const requests = new AbortController();

  const header = previewElement('header', 'component-library-heading');
  const headingMain = previewElement('div', 'component-library-heading-main');
  const count = previewElement('span', 'component-library-count');
  headingMain.append(previewElement('h2', '', '素材管理'), count);
  header.append(headingMain);

  const body = previewElement('div', 'component-library-body');

  const packagesSection = previewElement('section', 'component-library-packages-section');
  const packagesHead = previewElement('div', 'component-library-section-head');
  const styleSummary = previewElement('span', 'component-library-section-meta');
  packagesHead.append(previewElement('h3', 'component-library-section-title', '已导入素材'), styleSummary);
  const listFrame = previewElement('div', 'component-library-packages-frame');
  const list = previewElement('ul', 'component-library-packages');
  list.append(previewElement('li', 'component-library-empty is-loading', '正在读取素材…'));
  listFrame.append(list);
  packagesSection.append(packagesHead, listFrame);

  function syncPackagesScrollEdge() {
    if (!list.classList.contains('has-packages')) {
      delete list.dataset.scrollTop;
      delete list.dataset.scrollBottom;
      return;
    }
    const overflow = list.scrollHeight - list.clientHeight > 1;
    list.dataset.scrollTop = String(overflow && list.scrollTop > 1);
    list.dataset.scrollBottom = String(overflow && list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  }
  list.addEventListener('scroll', syncPackagesScrollEdge, { passive: true, signal: requests.signal });

  const lower = previewElement('div', 'component-library-lower');

  const storageSection = previewElement('section', 'component-library-card');
  const storageHead = previewElement('div', 'component-library-section-head');
  const storageHeading = previewElement('h3', 'component-library-section-title', '存储空间');
  storageHeading.append(createHelp('存储空间说明', '移除素材包后，仍被场景使用的文件会继续保留。'));
  storageHead.append(storageHeading);
  const storageSummary = previewElement('div', 'component-library-storage-summary');
  const total = previewElement('strong', 'component-library-total', '—');
  const totalLabel = previewElement('span', 'component-library-total-label', '本机总占用');
  storageSummary.append(total, totalLabel);
  const bar = previewElement('div', 'component-library-bar');
  bar.setAttribute('aria-hidden', 'true');
  const barSegments = Object.fromEntries(['installed', 'referenced', 'reclaimable', 'pending'].map(key => {
    const segment = previewElement('span', 'component-library-bar-segment');
    segment.dataset.segment = key;
    segment.style.width = '0%';
    bar.append(segment);
    return [key, segment];
  }));
  const metrics = previewElement('dl', 'component-library-metrics');
  const metricRows = {};
  const metricValues = {};
  for (const [key, label] of [
    ['installed', '已安装素材'],
    ['referenced', '场景保留'],
    ['reclaimable', '可清理'],
    ['pending', '暂存'],
  ]) {
    const row = previewElement('div', 'component-library-metric-row');
    if (key === 'installed') row.hidden = true;
    const term = previewElement('dt');
    const dot = previewElement('span', 'component-library-metric-dot');
    dot.dataset.segment = key;
    dot.setAttribute('aria-hidden', 'true');
    term.append(dot, document.createTextNode(label));
    const value = previewElement('dd', '', '—');
    row.append(term, value);
    metrics.append(row);
    metricRows[key] = row;
    metricValues[key] = value;
  }
  const storageNote = previewElement('p', 'component-library-storage-note');
  const storageTop = previewElement('div');
  storageTop.style.display = 'grid';
  storageTop.style.gap = '8px';
  storageTop.append(storageSummary, bar, metrics, storageNote);
  storageSection.append(storageHead, storageTop);

  const backupSection = previewElement('section', 'component-library-card');
  const backupHead = previewElement('div', 'component-library-section-head');
  const backupHeading = previewElement('h3', 'component-library-section-title', '备份与恢复');
  backupHeading.append(createHelp('备份与恢复说明', '备份本机素材、已保存参数及当前账号的场景布局。未保存草稿、外部浏览器源及电脑本地背景路径不在备份中。'));
  backupHead.append(backupHeading);
  const backupBody = previewElement('div', 'component-library-backup-body');
  const actions = previewElement('div', 'component-library-backup-actions');
  const backupNote = previewElement('p', 'component-library-backup-note', '请先保存修改，未保存草稿不会导出；恢复将新建副本。');
  backupBody.append(actions, backupNote);
  backupSection.append(backupHead, backupBody);

  lower.append(storageSection, backupSection);

  const status = previewElement('p', 'component-library-status'); status.setAttribute('role', 'status');
  const confirmation = previewElement('section', 'component-library-confirmation'); confirmation.hidden = true;
  confirmation.setAttribute('aria-label', '确认操作');
  const upload = previewElement('input'); upload.type = 'file'; upload.accept = '.zip'; upload.hidden = true;
  const backupUpload = previewElement('input'); backupUpload.type = 'file'; backupUpload.accept = '.zip'; backupUpload.hidden = true;
  let selected; let busy = false; let closed = false; let inventory; let pendingBackup;

  const button = (host, text, action, className = 'secondary', iconName) => {
    const node = previewElement('button', className); node.type = 'button';
    if (iconName) node.append(libraryIcon(iconName));
    if (text) node.append(previewElement('span', '', text));
    node.disabled = busy;
    node.addEventListener('click', event => { if (!busy && !closed) action(event); }); host.append(node); return node;
  };

  const close = button(header, '', () => dialog.close(), 'secondary component-library-close');
  close.setAttribute('aria-label', '关闭'); close.title = '关闭';
  close.append(previewToolbarIcon('close'));

  const cleanup = button(storageSection, '清理未使用文件', () => askConfirmation(
    `将清理 ${formatBytes(inventory.reclaimableBytes)} 已从样式库移除且未被场景使用的素材。需要恢复时请重新导入原安装包。`, async () => {
      const result = await request('cleanup', { ids: inventory.entries.filter(entry => entry.state === 'reclaimable').map(entry => entry.id), signal: requests.signal });
      await refresh();
      status.textContent = result.failed.length ? `已释放 ${formatBytes(result.freedBytes)}，部分文件仍被占用，请稍后重试。` : `已释放 ${formatBytes(result.freedBytes)}。`;
    }, { danger: true }), 'secondary component-library-full-btn component-library-cleanup', 'cleanup');
  cleanup.disabled = true;

  button(actions, '导出素材与场景备份', async () => {
    if (busy) return;
    setBusy(true); status.textContent = '正在导出备份…';
    try {
      const blob = await request('backup', { signal: requests.signal });
      const url = URL.createObjectURL(blob);
      const link = previewElement('a'); link.href = url; link.download = 'LIRA-素材与场景备份.zip';
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = '备份已导出。未保存修改、外部浏览器源及电脑本地背景路径不在备份中。';
    } catch (error) { if (!closed) status.textContent = error.message; }
    finally { setBusy(false); }
  }, 'primary component-library-full-btn', 'export');

  button(actions, '从备份恢复为副本', () => { if (!busy) backupUpload.click(); }, 'secondary component-library-full-btn', 'restore');

  function syncCleanupState() {
    const actionable = !busy && Boolean(inventory?.reclaimableBytes) && Boolean(inventory?.integrity?.backupCurrent);
    cleanup.disabled = !actionable;
    cleanup.classList.toggle('is-actionable', actionable);
  }

  function setBusy(value) {
    busy = value;
    for (const node of dialog.querySelectorAll('button')) node.disabled = value;
    syncCleanupState();
  }

  function askConfirmation(text, action, { onCancel, danger = false } = {}) {
    confirmation.classList.toggle('is-danger', danger);
    confirmation.replaceChildren(previewElement('p', '', text)); confirmation.hidden = false;
    const controls = previewElement('div', 'component-library-actions');
    confirmation.append(controls);
    button(controls, '取消', () => { confirmation.hidden = true; onCancel?.(); }, 'secondary component-library-btn-sm');
    button(controls, '确认', async () => {
      setBusy(true);
      try { await action(); confirmation.hidden = true; }
      catch (error) { status.textContent = error.message; }
      finally { setBusy(false); }
    }, 'primary component-library-btn-sm');
  }

  upload.addEventListener('change', () => {
    const file = upload.files[0]; upload.value = '';
    if (file && selected) { dialog.close(); onUpdate(selected, file); }
  });

  backupUpload.addEventListener('change', async () => {
    const file = backupUpload.files[0]; backupUpload.value = '';
    if (!file || busy) return;
    setBusy(true); status.textContent = '正在检查备份…';
    try {
      await cancelBackup();
      const preview = await request('inspect-backup', { file, signal: requests.signal });
      pendingBackup = preview.id;
      if (closed) { await cancelBackup(); return; }
      status.textContent = '';
      askConfirmation(`备份包含 ${preview.packages} 个素材包、${preview.scenes} 份已保存或已发布布局，共 ${formatBytes(preview.bytes)}。将恢复为副本，当前场景和直播保持原样。${preview.warnings.join('')}`, async () => {
        const result = await request('restore-backup', { id: pendingBackup, signal: requests.signal }); pendingBackup = null;
        if (onRestored) {
          try { await onRestored(); } catch (error) { result.refreshError = error.message; }
        }
        await refresh(); await onChanged?.();
        status.textContent = `已恢复 ${result.created} 份布局，跳过 ${result.existing} 份已有副本。请从场景列表选择并检查，再保存应用。${result.refreshError ? '场景列表暂未刷新，请重新打开画布。' : ''}`;
      }, { onCancel: () => { void cancelBackup(); } });
    } catch (error) { if (!closed) status.textContent = error.message; }
    finally { setBusy(false); }
  });

  async function cancelBackup() {
    if (!pendingBackup) return;
    const id = pendingBackup; pendingBackup = null;
    try { await request('cancel', { id }); } catch (error) { if (!closed) status.textContent = error.message; }
  }

  async function refresh() {
    const [packages, usage] = await Promise.allSettled([
      request('list', { signal: requests.signal }), request('inventory', { signal: requests.signal }),
    ]);
    if (closed) return;

    const bytesByPack = new Map(usage.status === 'fulfilled'
      ? usage.value.entries.map(entry => [entry.id, entry.bytes]) : []);

    if (packages.status === 'fulfilled') {
      list.replaceChildren();
      const hasPackages = packages.value.length > 0;
      listFrame.classList.toggle('has-packages', hasPackages);
      list.classList.toggle('has-packages', hasPackages);
      count.textContent = `${packages.value.length} 个素材包`;
      const totalStyles = packages.value.reduce((sum, pack) => sum + pack.styles.length, 0);
      styleSummary.textContent = totalStyles ? `共 ${totalStyles} 个样式` : '';
      for (const pack of packages.value) {
        const row = previewElement('li', 'component-library-package');
        const iconWrap = previewElement('div', 'component-library-package-icon');
        iconWrap.append(libraryIcon(packageIconName(pack.importTarget)));
        const title = previewElement('div', 'component-library-package-title');
        const nameRow = previewElement('div', 'component-library-package-name-row');
        const nameHeading = previewElement('h3', '', pack.name);
        nameHeading.title = pack.name;
        nameRow.append(nameHeading);
        if (pack.version) {
          nameRow.append(previewElement('span', 'component-library-version',
            pack.version.startsWith('v') ? pack.version : `v${pack.version}`));
        }
        const sub = previewElement('div', 'component-library-package-sub');
        sub.append(previewElement('span', '', `${categoryName(pack.importTarget)} · ${pack.styles.length} 个样式`));
        if (bytesByPack.has(pack.id)) {
          sub.append(previewElement('span', 'component-library-package-size', formatBytes(bytesByPack.get(pack.id))));
        }
        title.append(nameRow, sub);
        const controls = previewElement('div', 'component-library-actions');
        if (pack.packageId && !pack.packageId.startsWith('backup.')) {
          button(controls, '更新素材包', () => { selected = pack; upload.click(); }, 'secondary component-library-btn-sm');
        }
        button(controls, '移除整包', () => askConfirmation(`从样式库移除「${pack.name}」的全部样式？已有场景继续保留原效果。`, async () => {
          await request('remove-pack', { id: pack.id, signal: requests.signal });
          await refresh(); await onChanged?.(); status.textContent = `已移除「${pack.name}」。`;
        }, { danger: true }), 'danger component-library-btn-sm');
        row.append(iconWrap, title, controls); list.append(row);
      }
      if (!packages.value.length) {
        const empty = previewElement('li', 'component-library-empty');
        const emptyIcon = previewElement('div', 'component-library-empty-icon');
        emptyIcon.append(libraryIcon('box'));
        const copy = previewElement('div', 'component-library-empty-copy');
        copy.append(
          previewElement('p', 'component-library-empty-title', '还没有导入素材'),
          previewElement('p', 'component-library-empty-hint', '在对应组件中点击「添加样式」，导入后会显示在这里。'),
        );
        empty.append(emptyIcon, copy);
        list.append(empty);
      }
      window.requestAnimationFrame(syncPackagesScrollEdge);
    } else {
      listFrame.classList.remove('has-packages');
      list.classList.remove('has-packages');
      list.replaceChildren();
      styleSummary.textContent = '';
      syncPackagesScrollEdge();
      status.textContent = packages.reason.message;
    }

    if (usage.status === 'fulfilled') {
      inventory = usage.value;
      const installed = inventory.entries.filter(entry => entry.state === 'installed').reduce((sum, entry) => sum + entry.bytes, 0);
      const referenced = inventory.entries.filter(entry => entry.state === 'referenced').reduce((sum, entry) => sum + entry.bytes, 0);
      const reclaimable = inventory.reclaimableBytes;
      const pending = inventory.pendingBytes;
      total.textContent = formatBytes(inventory.totalBytes);
      totalLabel.textContent = '本机总占用';
      metricRows.installed.hidden = installed <= 0;
      metricRows.reclaimable.classList.toggle('is-reclaimable', reclaimable > 0);
      const byKey = { installed, referenced, reclaimable, pending };
      for (const [key, bytes] of Object.entries(byKey)) {
        metricValues[key].textContent = formatBytes(bytes);
        barSegments[key].style.width = segmentPercent(bytes, inventory.totalBytes);
      }
      const notes = [];
      if (inventory.unregisteredBytes) notes.push(`待核对文件 ${formatBytes(inventory.unregisteredBytes)}。`);
      if (!inventory.integrity.backupCurrent && (inventory.entries.length > 0 || inventory.totalBytes > 0)) {
        notes.push('恢复副本暂未保存成功，已暂停文件清理。');
      }
      if (inventory.integrity.recovery) notes.push('索引曾从恢复副本还原，请核对最近的样式设置。');
      storageNote.textContent = notes.join('');
      syncCleanupState();
    } else {
      inventory = null;
      total.textContent = '—';
      totalLabel.textContent = '暂时无法读取';
      metricRows.installed.hidden = true;
      metricRows.reclaimable.classList.remove('is-reclaimable');
      for (const key of Object.keys(barSegments)) {
        barSegments[key].style.width = '0%';
        metricValues[key].textContent = '—';
      }
      storageNote.textContent = `暂不能清理：${usage.reason.message}`;
      syncCleanupState();
    }
  }

  body.append(packagesSection, lower);
  dialog.append(header, body, confirmation, status, upload, backupUpload);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { closed = true; requests.abort(); void cancelBackup(); dialog.remove(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  dialog.focus({ preventScroll: true });
  void refresh();
  return { dispose() { if (!busy) dialog.close(); } };
}
