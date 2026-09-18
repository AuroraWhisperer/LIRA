import { initDailyBotTakeover } from './danmaku-daily-bot-takeover.js';

const REASONS = {
  pending: '待处理旧数据', importing: '正在导入旧数据', disabled: '已关闭', running: '云端运行中',
  'streamer-disabled': '账号已停用', 'monitor-disabled': '已开启，总监听已关闭',
  'room-not-set': '已开启，等待配置直播间', 'waiting-login': '已开启，等待云端登录',
  'monitor-disconnected': '已开启，监听未连接',
};
const ERRORS = {
  DAILY_BOT_UNSUPPORTED: '服务器不支持云端签到与抽签，请更新服务器。',
  DAILY_BOT_REVISION_CONFLICT: '另一台设备已修改设置，正在重新读取。',
  DAILY_BOT_LEGACY_PRESENT: '本机仍有旧累计或自定义词库，请选择保留或明确重新开始。',
  DAILY_BOT_SOURCE_CHANGED: '旧数据已变化或与暂存来源不一致。请确认旧端停写，取消未完成导入后重新核对。',
  DAILY_BOT_COMMITTED_SOURCE_CHANGED: '导入已提交，但发现旧数据继续变化。请保留两端数据并人工核对，不能再次叠加导入。',
  DAILY_BOT_IMPORT_INVALID: '旧数据或词库预检未通过，请修正后重新准备。',
  DAILY_BOT_IMPORT_CONFLICT: '导入内容与已保存的摘要不一致，请核对来源。',
  DAILY_BOT_IMPORT_TOO_LARGE: '旧数据超过本次导入上限，需单独核对。',
  DAILY_BOT_TAKEOVER_CONFLICT: '云端已作出接管决定，请刷新核对。',
  DAILY_BOT_BUSY: '上一项操作仍在完成，请稍后重试。',
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
      toggles[kind].disabled = !owner || !bridge || busy || stale || !saved || saved.takeover.state !== 'ready';
      const status = documentRef.getElementById(`dailyBot${kind}Status`);
      status.textContent = saved ? `${stale ? '状态未知' : REASONS[saved[kind].reason]} · 最后确认 ${new Date(saved.observedAt).toLocaleTimeString('zh-CN')}` : '尚未确认云端状态';
    }
    refreshButton.disabled = !owner || !bridge || busy;
    takeover.render(saved, busy || stale || !owner);
  }
  async function invoke(action, payload = {}) {
    if (busy || !owner || !bridge || disposed) return;
    const requested = generation; busy = true; render();
    if (action === 'prepare') overall.textContent = '正在读取停写后的旧数据快照，请保持旧端关闭。';
    if (action === 'apply') overall.textContent = '正在上传、预检并导入旧数据，请保持旧端关闭。';
    let reload = false;
    try {
      const response = await bridge.invoke({ action, ...(action === 'open' ? {} : { contextId }), payload });
      if (disposed || generation !== requested) return;
      if (response?.ok !== true) throw Object.assign(new Error(response?.error), { code: response?.error });
      contextId = response.contextId;
      if (response.data) { saved = response.data; stale = false; }
      takeover.result(action, response);
      overall.textContent = response.imported || saved?.takeover.decision === 'imported'
        ? '旧累计已导入。词库曾被修改或替换时，接管当天签文可能与旧端不同；请手动开启云端开关。'
        : saved?.takeover.decision === 'fresh-start' ? '云端重新开始，旧累计尚未合并；原库保留待核对。'
          : '云端独立运行，关闭客户端后继续接收命令。';
      return response;
    } catch (error) {
      if (disposed || generation !== requested) return;
      stale = true;
      if (['DAILY_BOT_SOURCE_CHANGED', 'DAILY_BOT_COMMITTED_SOURCE_CHANGED'].includes(error.code)) takeover.reset();
      overall.textContent = action === 'update' && payload.enabled === false
        ? '关闭尚未同步，服务器可能仍在回复。请刷新核对。'
        : ERRORS[error.code] || '状态读取或保存失败，请检查连接并重试。';
      if (error.code === 'DAILY_BOT_REVISION_CONFLICT') { toast(overall.textContent); reload = true; }
    } finally {
      if (!disposed && generation === requested) { busy = false; render(); }
    }
    if (reload) await invoke('open');
  }
  const takeover = initDailyBotTakeover({ documentRef, invoke });
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
    takeover.reset(); render();
    overall.textContent = bridge ? '连接云端账号后可设置' : '请升级桌面客户端';
    if (owner) void refresh();
  }
  refreshButton.addEventListener('click', refresh);
  const offline = () => {
    stale = true;
    overall.textContent = '连接已中断，云端状态未知；服务器可能仍在回复。恢复连接后请核对。';
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
