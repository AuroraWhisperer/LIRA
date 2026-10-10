import { previewElement, previewToolbarIcon } from './component-preview-surface.js';
import { loadComponentStyleCss, requestComponentStyles } from './component-style-api.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';

const size = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const categoryName = type => SCENE_EXTRA_COMPONENTS[type]?.title
  || ({ suite: '套装', clock: '时钟', danmaku: '弹幕姬', queue: '点歌板', browser: '浏览器源', 'text-box': '文本框', overtime: '加班机' })[type] || type;

export function openComponentLibraryManager({ request = requestComponentStyles, onUpdate, onChanged }) {
  loadComponentStyleCss();
  const dialog = previewElement('dialog', 'component-style-dialog component-library-manager');
  dialog.setAttribute('aria-label', '素材管理');
  const requests = new AbortController();
  const header = previewElement('header', 'component-library-heading');
  const count = previewElement('span', 'hint');
  header.append(previewElement('h2', '', '已导入素材'), count);
  const body = previewElement('div', 'component-library-body');
  const packages = previewElement('section', 'component-library-section');
  const list = previewElement('ul', 'component-library-packages');
  list.append(previewElement('li', 'component-library-empty hint', '正在读取素材…'));
  packages.append(list);
  const storageSection = previewElement('section', 'component-library-section');
  const storageHeading = previewElement('div', 'component-library-section-heading');
  const total = previewElement('span', 'component-library-total', '正在计算…');
  const storageTitle = previewElement('div', 'component-library-storage-title');
  storageTitle.append(previewElement('h2', '', '存储空间'), total);
  storageHeading.append(storageTitle);
  const storage = previewElement('p', 'hint component-library-storage-note');
  const metrics = previewElement('dl', 'component-library-metrics');
  const values = ['场景保留', '可清理', '暂存'].map(label => {
    const item = previewElement('div');
    const value = previewElement('dd', '', '—');
    item.append(previewElement('dt', '', label), value); metrics.append(item);
    return value;
  });
  storageSection.append(storageHeading, metrics,
    previewElement('p', 'hint', '移除素材包后，仍被场景使用的文件会继续保留。'), storage);
  const backup = previewElement('section', 'component-library-section');
  const actions = previewElement('div', 'component-library-actions');
  backup.append(previewElement('h2', '', '备份与恢复'),
    previewElement('p', 'hint', '备份本机素材、已保存参数及当前账号的场景布局。请先保存修改，未保存草稿不会导出。'), actions);
  const status = previewElement('p', 'hint component-library-status'); status.setAttribute('role', 'status');
  const confirmation = previewElement('section', 'component-library-confirmation'); confirmation.hidden = true;
  confirmation.setAttribute('aria-label', '确认操作');
  const upload = previewElement('input'); upload.type = 'file'; upload.accept = '.zip'; upload.hidden = true;
  const backupUpload = previewElement('input'); backupUpload.type = 'file'; backupUpload.accept = '.zip'; backupUpload.hidden = true;
  let selected; let busy = false; let closed = false; let inventory; let pendingBackup;
  const button = (host, text, action, className = 'secondary') => {
    const node = previewElement('button', className, text); node.type = 'button';
    node.disabled = busy;
    node.addEventListener('click', event => { if (!busy && !closed) action(event); }); host.append(node); return node;
  };
  const close = button(header, '', () => dialog.close(), 'secondary component-library-close');
  close.setAttribute('aria-label', '关闭'); close.title = '关闭';
  close.append(previewToolbarIcon('close'));
  const cleanup = button(storageHeading, '清理未使用文件', () => askConfirmation(
    `将清理 ${size(inventory.reclaimableBytes)} 已从样式库移除且未被场景使用的素材。需要恢复时请重新导入原安装包。`, async () => {
      const result = await request('cleanup', { ids: inventory.entries.filter(entry => entry.state === 'reclaimable').map(entry => entry.id), signal: requests.signal });
      await refresh();
      status.textContent = result.failed.length ? `已释放 ${size(result.freedBytes)}，部分文件仍被占用，请稍后重试。` : `已释放 ${size(result.freedBytes)}。`;
    })); cleanup.disabled = true;
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
  });
  button(actions, '恢复备份', () => { if (!busy) backupUpload.click(); });

  function setBusy(value) {
    busy = value;
    for (const node of dialog.querySelectorAll('button')) node.disabled = value;
    cleanup.disabled = busy || !inventory?.reclaimableBytes || !inventory.integrity.backupCurrent;
  }

  function askConfirmation(text, action, onCancel) {
    confirmation.replaceChildren(previewElement('p', '', text)); confirmation.hidden = false;
    const controls = previewElement('div', 'component-library-actions');
    confirmation.append(controls);
    button(controls, '确认', async () => {
      setBusy(true);
      try { await action(); confirmation.hidden = true; }
      catch (error) { status.textContent = error.message; }
      finally { setBusy(false); }
    }, 'primary');
    button(controls, '取消', () => { confirmation.hidden = true; onCancel?.(); });
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
      askConfirmation(`备份包含 ${preview.packages} 个素材包、${preview.scenes} 份已保存或已发布布局，共 ${size(preview.bytes)}。将恢复为副本，当前场景和直播保持原样。${preview.warnings.join('')}`, async () => {
        const result = await request('restore-backup', { id: pendingBackup, signal: requests.signal }); pendingBackup = null;
        const { refreshComponentPreviewPresets } = await import('./component-preview-canvas-controller.js');
        try { await refreshComponentPreviewPresets(); } catch (error) { result.refreshError = error.message; }
        await refresh(); await onChanged?.();
        status.textContent = `已恢复 ${result.created} 份布局，跳过 ${result.existing} 份已有副本。请从场景列表选择并检查，再保存应用。${result.refreshError ? '场景列表暂未刷新，请重新打开画布。' : ''}`;
      }, () => { void cancelBackup(); });
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
    if (packages.status === 'fulfilled') {
      list.replaceChildren();
      count.textContent = `${packages.value.length} 个素材包`;
      for (const pack of packages.value) {
        const row = previewElement('li', 'component-library-package');
        const title = previewElement('div', 'component-library-package-title');
        title.append(previewElement('h3', '', pack.name), previewElement('p', 'hint',
          `${categoryName(pack.importTarget)} · ${pack.version ? `版本 ${pack.version} · ` : ''}${pack.styles.length} 个样式`));
        const controls = previewElement('div', 'component-library-actions');
        if (pack.packageId && !pack.packageId.startsWith('backup.')) button(controls, '更新素材包', () => { selected = pack; upload.click(); });
        button(controls, '移除整包', () => askConfirmation(`从样式库移除「${pack.name}」的全部样式？已有场景继续保留原效果。`, async () => {
          await request('remove-pack', { id: pack.id, signal: requests.signal });
          await refresh(); await onChanged?.(); status.textContent = `已移除「${pack.name}」。`;
        }), 'danger');
        row.append(title, controls); list.append(row);
      }
      if (!packages.value.length) {
        const empty = previewElement('li', 'component-library-empty');
        empty.append(previewElement('p', '', '还没有导入素材'), previewElement('p', 'hint', '在对应组件中点击「添加样式」，导入后会显示在这里。'));
        list.append(empty);
      }
    } else { list.replaceChildren(); status.textContent = packages.reason.message; }
    if (usage.status === 'fulfilled') {
      inventory = usage.value;
      const retained = inventory.entries.filter(entry => entry.state === 'referenced').reduce((sum, entry) => sum + entry.bytes, 0);
      total.textContent = `共占用 ${size(inventory.totalBytes)}`;
      [retained, inventory.reclaimableBytes, inventory.pendingBytes].forEach((bytes, index) => { values[index].textContent = size(bytes); });
      storage.textContent = inventory.unregisteredBytes ? `待核对文件 ${size(inventory.unregisteredBytes)}。` : '';
      if (!inventory.integrity.backupCurrent) storage.textContent += '恢复副本暂未保存成功，已暂停文件清理。';
      if (inventory.integrity.recovery) storage.textContent += '索引曾从恢复副本还原，请核对最近的样式设置。';
      cleanup.disabled = busy || !inventory.reclaimableBytes || !inventory.integrity.backupCurrent;
    } else { inventory = null; cleanup.disabled = true; total.textContent = '暂时无法读取'; storage.textContent = `暂不能清理：${usage.reason.message}`; }
  }

  body.append(packages, storageSection, backup);
  dialog.append(header, body, confirmation, status, upload, backupUpload);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { closed = true; requests.abort(); void cancelBackup(); dialog.remove(); }, { once: true });
  document.body.append(dialog); dialog.showModal(); void refresh();
  return { dispose() { if (!busy) dialog.close(); } };
}
