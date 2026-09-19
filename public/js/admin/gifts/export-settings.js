export function createGiftExportSettings() {
  const get = (id) => document.getElementById(id);
  const fields = get('giftExportSettingsFields');
  const status = get('giftExportSettingsStatus');
  const reload = get('giftExportSettingsReload');
  let loaded = false;
  let busy = false;

  async function update(options) {
    if (busy) return;
    busy = true;
    fields.disabled = true;
    reload.hidden = true;
    status.dataset.state = '';
    status.textContent = options ? '正在保存…' : '正在加载导出设置…';
    try {
      if (!window.giftExport?.settings) throw new Error('请在 LIRA 桌面客户端中设置图片导出。');
      const result = await window.giftExport.settings(options);
      if (!result.ok) throw new Error(result.error);
      get('giftExportMode').value = result.data.mode;
      get('giftExportBackground').value = result.data.background;
      get('giftExportSettingsDirectory').textContent = result.data.directory;
      loaded = true;
      status.textContent = options ? '设置已保存，下次导出时生效。' : '';
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.message;
      reload.hidden = !window.giftExport?.settings;
    } finally {
      busy = false;
      fields.disabled = !loaded;
    }
  }

  get('giftExportMode').addEventListener('change', (event) => update({ mode: event.target.value }));
  get('giftExportBackground').addEventListener('change', (event) => update({ background: event.target.value }));
  get('giftExportChoose').addEventListener('click', () => update({ directoryAction: 'choose' }));
  get('giftExportDefault').addEventListener('click', () => update({ directoryAction: 'default' }));
  reload.addEventListener('click', () => update());
  return { open: () => loaded ? Promise.resolve() : update() };
}
