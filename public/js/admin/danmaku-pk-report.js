export function initDanmakuPkReport({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  bridge = windowRef?.liraLicense,
  toast = () => {},
} = {}) {
  const toggle = documentRef.getElementById('danmakuPkReportToggle');
  const status = documentRef.getElementById('danmakuPkReportStatus');
  const refresh = documentRef.getElementById('danmakuPkReportRefreshBtn');
  if (!toggle || !status || !refresh) return;
  const available = Boolean(bridge?.getPkReportSettings && bridge?.updatePkReportSettings);
  let owner = '',
    generation = 0,
    enabled = false,
    loaded = false,
    pending = false,
    disposed = false;
  function controls() {
    toggle.checked = enabled;
    toggle.disabled = !loaded || pending || !available;
    refresh.disabled = !owner || pending || !available;
  }
  function confirmed(result) {
    if (result?.ok !== true || typeof result.enabled !== 'boolean') {
      throw new Error('PK 播报设置未确认，请检查服务器连接和版本后重试。');
    }
    return result.enabled;
  }
  async function sync(value) {
    const writing = typeof value === 'boolean';
    if (!owner || !available || disposed || pending || (writing && !loaded)) {
      controls();
      return;
    }
    const requested = generation;
    pending = true;
    controls();
    status.textContent = '正在同步 PK 播报设置…';
    try {
      const result = writing
        ? await bridge.updatePkReportSettings({ enabled: value })
        : await bridge.getPkReportSettings();
      if (disposed || generation !== requested) return;
      enabled = confirmed(result);
      loaded = true;
      status.textContent = enabled ? '已开启，服务器将在 PK 开始时播报' : 'PK 对手信息播报已关闭';
      if (writing) toast(enabled ? 'PK 对手信息播报已开启' : 'PK 对手信息播报已关闭');
    } catch {
      if (disposed || generation !== requested) return;
      status.textContent =
        writing && value === false
          ? '关闭尚未同步，服务器可能仍在播报；请刷新核对。'
          : 'PK 播报功能暂不可用，请检查连接或升级服务器后刷新。';
    } finally {
      if (!disposed && generation === requested) {
        pending = false;
        controls();
      }
    }
  }
  const reload = () => {
    void sync();
  };
  function account(snapshot) {
    if (disposed) return;
    const name = snapshot?.streamer?.accountName,
      url = snapshot?.streamer?.songPageUrl;
    const next = snapshot?.state === 'authorized' && name && url ? JSON.stringify([name, url]) : '';
    if (next === owner) {
      if (!owner) status.textContent = available ? '连接已授权账号后可设置 PK 播报' : '请升级桌面客户端后设置 PK 播报';
      return;
    }
    owner = next;
    generation++;
    enabled = false;
    loaded = false;
    pending = false;
    controls();
    status.textContent = available ? '连接已授权账号后可设置 PK 播报' : '请升级桌面客户端后设置 PK 播报';
    reload();
  }
  toggle.addEventListener('change', () => {
    void sync(toggle.checked);
  });
  refresh.addEventListener('click', reload);
  windowRef.addEventListener('online', reload);
  const unsubscribe = bridge?.onStateChanged?.(account);
  const initial = generation;
  Promise.resolve(bridge?.getProfile?.())
    .then((snapshot) => {
      if (generation === initial) account(snapshot);
    })
    .catch(() => {
      if (!disposed && generation === initial) status.textContent = '账号信息读取失败，请重新连接账号。';
    });
  windowRef.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      generation++;
      unsubscribe?.();
      windowRef.removeEventListener('online', reload);
    },
    { once: true },
  );
  controls();
}
