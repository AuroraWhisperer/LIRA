const REASONS = {
  pending: '已关闭', importing: '暂时不可用', disabled: '已关闭', running: '云端运行中',
  'streamer-disabled': '账号已停用', 'monitor-disabled': '已开启，总监听已关闭',
  'room-not-set': '已开启，等待配置直播间', 'waiting-login': '已开启，等待云端登录',
  'monitor-disconnected': '已开启，监听未连接',
};
const ERRORS = {
  DAILY_BOT_UNSUPPORTED: '服务器不支持云端签到和抽签，请先更新服务器。',
  DAILY_BOT_REVISION_CONFLICT: '另一台设备改了设置，正在重新读取。',
  DAILY_BOT_BUSY: '上一项操作还没完成，请稍后重试。',
};

export function initDanmakuDailyBots({ documentRef = globalThis.document, windowRef = globalThis.window,
  bridge = windowRef?.dailyBots, license = windowRef?.liraLicense, toast = () => {} } = {}) {
  const refreshButton = documentRef.getElementById('dailyBotRefresh');
  const overall = documentRef.getElementById('dailyBotStatus');
  const toggles = Object.fromEntries(['checkin', 'fortune'].map((kind) => [kind,
    documentRef.getElementById(kind === 'checkin' ? 'danmakuCheckinToggle' : 'danmakuFortuneToggle')]));
  if (!refreshButton || !overall || Object.values(toggles).some((element) => !element)) return;
  let owner = '', generation = 0, contextId = null, saved = null, busy = false, stale = true, disposed = false;
  function render() {
    for (const kind of ['checkin', 'fortune']) {
      toggles[kind].checked = saved?.[kind].enabled === true;
      toggles[kind].disabled = !owner || !bridge || busy || stale || !saved || saved.takeover.state === 'importing';
      const status = documentRef.getElementById(`dailyBot${kind}Status`);
      status.textContent = saved ? `${stale ? '状态未知' : REASONS[saved[kind].reason]} · 最后确认 ${new Date(saved.observedAt).toLocaleTimeString('zh-CN')}` : '尚未确认云端状态';
    }
    refreshButton.disabled = !owner || !bridge || busy;
  }
  async function invoke(action, payload = {}) {
    if (busy || !owner || !bridge || disposed) return;
    const requested = generation; busy = true; render();
    let reload = false;
    try {
      const response = await bridge.invoke({ action, ...(action === 'open' ? {} : { contextId }), payload });
      if (disposed || generation !== requested) return;
      if (response?.ok !== true) throw Object.assign(new Error(response?.error), { code: response?.error });
      contextId = response.contextId;
      if (response.data) { saved = response.data; stale = false; }
      overall.textContent = '开启后在云端运行，关闭客户端也不影响。';
      return response;
    } catch (error) {
      if (disposed || generation !== requested) return;
      stale = true;
      overall.textContent = action === 'update' && payload.enabled === false
        ? '关闭尚未同步，机器人可能还在回复。请刷新确认。'
        : ERRORS[error.code] || '状态读取或保存失败，请检查连接并重试。';
      if (error.code === 'DAILY_BOT_REVISION_CONFLICT') { toast(overall.textContent); reload = true; }
    } finally {
      if (!disposed && generation === requested) { busy = false; render(); }
    }
    if (reload) await invoke('open');
  }
  const refresh = () => invoke('open');
  for (const kind of ['checkin', 'fortune']) toggles[kind].addEventListener('change', () => {
    const enabled = toggles[kind].checked;
    void invoke('update', { kind, enabled, expectedRevision: saved[kind].revision });
  });
  function account(snapshot) {
    const streamer = snapshot?.streamer;
    const next = snapshot?.state === 'authorized' && streamer?.accountName && streamer?.songPageUrl
      ? JSON.stringify([streamer.accountName, streamer.songPageUrl]) : '';
    if (next === owner || disposed) return;
    owner = next; generation++; contextId = null; saved = null; busy = false; stale = true;
    render();
    overall.textContent = bridge ? '连接云端账号后可设置' : '请升级桌面客户端';
    if (owner) void refresh();
  }
  refreshButton.addEventListener('click', refresh);
  const offline = () => {
    stale = true;
    overall.textContent = '连接中断，暂时无法确认云端状态。机器人可能还在回复，请在恢复连接后刷新。';
    render();
  };
  windowRef.addEventListener('offline', offline);
  windowRef.addEventListener('online', refresh);
  const unsubscribe = license?.onStateChanged?.(account);
  const initial = generation;
  Promise.resolve(license?.getProfile?.()).then((snapshot) => {
    if (initial === generation) account(snapshot);
  }).catch(() => { if (initial === generation) overall.textContent = '账号信息读取失败，请重新连接后刷新。'; });
  windowRef.addEventListener('pagehide', () => {
    disposed = true; generation++; unsubscribe?.(); windowRef.removeEventListener('online', refresh);
    windowRef.removeEventListener('offline', offline);
  }, { once: true });
  render();
  return { refresh };
}
