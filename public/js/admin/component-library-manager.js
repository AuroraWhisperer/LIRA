import { previewElement } from './component-preview-surface.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';

const size = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const categoryName = type => SCENE_EXTRA_COMPONENTS[type]?.title
  || ({ suite: '套装', clock: '时钟', danmaku: '弹幕姬', queue: '点歌板', browser: '浏览器源', 'text-box': '文本框', overtime: '加班机' })[type] || type;

export function openComponentLibraryManager({ request, onUpdate, onChanged }) {
  const dialog = previewElement('dialog', 'component-style-dialog component-library-manager');
  dialog.setAttribute('aria-label', '管理样式库');
  const requests = new AbortController();
  const list = previewElement('div', 'component-library-packages');
  const storage = previewElement('p', 'hint');
  const status = previewElement('p', 'hint'); status.setAttribute('role', 'status');
  const confirmation = previewElement('section'); confirmation.hidden = true;
  const actions = previewElement('div', 'component-style-suite-actions');
  const upload = previewElement('input'); upload.type = 'file'; upload.accept = '.zip'; upload.hidden = true;
  const backupUpload = previewElement('input'); backupUpload.type = 'file'; backupUpload.accept = '.zip'; backupUpload.hidden = true;
  let selected; let busy = false; let closed = false; let inventory; let pendingBackup;
  const button = (host, text, action, className = 'secondary') => {
    const node = previewElement('button', className, text); node.type = 'button';
    node.disabled = busy;
    node.addEventListener('click', event => { if (!busy && !closed) action(event); }); host.append(node); return node;
  };
  button(actions, '关闭', () => dialog.close());
  const cleanup = button(actions, '清理未使用文件', () => askConfirmation(
    `将清理 ${size(inventory.reclaimableBytes)} 已从样式库移除且未被场景使用的素材。需要恢复时请重新导入原安装包。`, async () => {
      const result = await request('cleanup', { ids: inventory.entries.filter(entry => entry.state === 'reclaimable').map(entry => entry.id), signal: requests.signal });
      await refresh();
      status.textContent = result.failed.length ? `已释放 ${size(result.freedBytes)}，部分文件仍被占用，请稍后重试。` : `已释放 ${size(result.freedBytes)}。`;
    }), 'danger'); cleanup.disabled = true;
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
    button(confirmation, '确认', async () => {
      setBusy(true);
      try { await action(); confirmation.hidden = true; }
      catch (error) { status.textContent = error.message; }
      finally { setBusy(false); }
    }, 'primary');
    button(confirmation, '取消', () => { confirmation.hidden = true; onCancel?.(); });
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
      for (const pack of packages.value) {
        const row = previewElement('section', 'component-style-suite');
        const heading = previewElement('header', 'component-style-suite-header');
        const title = previewElement('div', 'component-style-suite-title');
        title.append(previewElement('h4', '', pack.name), previewElement('p', 'hint',
          `${categoryName(pack.importTarget)} · ${pack.version ? `版本 ${pack.version} · ` : ''}${pack.styles.length} 个样式`));
        const controls = previewElement('div', 'component-style-suite-actions');
        if (pack.packageId && !pack.packageId.startsWith('backup.')) button(controls, '更新素材包', () => { selected = pack; upload.click(); });
        button(controls, '移除整包', () => askConfirmation(`从样式库移除「${pack.name}」的全部样式？已有场景继续保留原效果。`, async () => {
          await request('remove-pack', { id: pack.id, signal: requests.signal });
          await refresh(); await onChanged?.(); status.textContent = `已移除「${pack.name}」。`;
        }), 'danger');
        heading.append(title, controls); row.append(heading); list.append(row);
      }
      if (!packages.value.length) list.append(previewElement('p', 'hint', '还没有导入的样式。'));
    } else status.textContent = packages.reason.message;
    if (usage.status === 'fulfilled') {
      inventory = usage.value;
      const retained = inventory.entries.filter(entry => entry.state === 'referenced').reduce((sum, entry) => sum + entry.bytes, 0);
      storage.textContent = `占用 ${size(inventory.totalBytes)} · 旧场景保留 ${size(retained)} · 可清理 ${size(inventory.reclaimableBytes)} · 暂存 ${size(inventory.pendingBytes)}`;
      if (inventory.unregisteredBytes) storage.textContent += ` · 待核对文件 ${size(inventory.unregisteredBytes)}`;
      if (!inventory.integrity.backupCurrent) storage.textContent += '。恢复副本暂未保存成功，已暂停文件清理。';
      if (inventory.integrity.recovery) storage.textContent += '。索引曾从恢复副本还原，请核对最近的样式设置。';
      cleanup.disabled = busy || !inventory.reclaimableBytes || !inventory.integrity.backupCurrent;
    } else { inventory = null; cleanup.disabled = true; storage.textContent = `暂不能清理：${usage.reason.message}`; }
  }

  dialog.append(previewElement('h2', '', '管理样式库'), list, storage,
    previewElement('p', 'hint', '备份包含本机样式素材、已保存参数及当前账号的保存和发布布局。请先保存修改；未保存草稿不会导出。'),
    actions, confirmation, status, upload, backupUpload);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { closed = true; requests.abort(); void cancelBackup(); dialog.remove(); }, { once: true });
  document.body.append(dialog); dialog.showModal(); void refresh();
  return { dispose() { if (!busy) dialog.close(); } };
}
