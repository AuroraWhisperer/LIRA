import { createDailyLibraryEditor } from './danmaku-daily-library.js';

const REASONS = {
  pending: '',
  importing: '暂时不可用',
  disabled: '',
  running: '',
  'streamer-disabled': '账号已停用',
  'monitor-disabled': '已开启，总监听已关闭',
  'room-not-set': '已开启，等待配置直播间',
  'waiting-login': '已开启，等待云端登录',
  'monitor-disconnected': '已开启，监听未连接',
};
const ERRORS = {
  DAILY_BOT_UNSUPPORTED: '当前服务暂不支持云端签到和抽签，请联系管理员。',
  DAILY_BOT_REVISION_CONFLICT: '另一台设备改了设置，正在重新读取。',
  DAILY_BOT_BUSY: '上一项操作还没完成，请稍后重试。',
};

export function initDanmakuDailyBots({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  bridge = windowRef?.dailyBots,
  license = windowRef?.liraLicense,
  toast = () => {},
} = {}) {
  const refreshButton = documentRef.getElementById('dailyBotRefresh');
  const fortuneMode = documentRef.getElementById('dailyBotFortuneDrawMode');
  const fortuneModeHint = documentRef.getElementById('dailyBotFortuneDrawModeHint');
  const toggles = Object.fromEntries(
    ['checkin', 'fortune'].map((kind) => [
      kind,
      documentRef.getElementById(kind === 'checkin' ? 'danmakuCheckinToggle' : 'danmakuFortuneToggle'),
    ]),
  );
  if (!refreshButton || Object.values(toggles).some((element) => !element)) return;
  let owner = null,
    notice = '',
    generation = 0,
    contextId = null,
    saved = null,
    busy = false,
    stale = true,
    disposed = false;
  const libraries = createDailyLibraryEditor({ documentRef, windowRef, request: invoke });
  function render() {
    libraries?.availability({ enabled: Boolean(owner && contextId && bridge && !stale), busy });
    let sharedStatus = notice;
    if (!sharedStatus) {
      if (!bridge) sharedStatus = '请升级桌面客户端后设置。';
      else if (owner === null) sharedStatus = '正在读取账号信息…';
      else if (!owner) sharedStatus = '请先连接 LIRA 账号，再刷新云端状态。';
      else if (!saved) sharedStatus = busy ? '正在读取云端设置…' : '尚未确认云端状态，请刷新核对。';
      else if (stale) sharedStatus = '云端状态待刷新';
    }
    for (const kind of ['checkin', 'fortune']) {
      toggles[kind].checked = saved?.[kind].enabled === true;
      toggles[kind].disabled = !owner || !bridge || busy || stale || !saved || saved.takeover.state === 'importing';
      const status = documentRef.getElementById(`dailyBot${kind}Status`);
      status.ariaBusy = String(Boolean(bridge && !notice && (owner === null || (busy && !saved))));
      status.textContent = sharedStatus || REASONS[saved[kind].reason];
    }
    if (fortuneMode) {
      const supported = ['daily', 'random'].includes(saved?.fortune.drawMode);
      fortuneMode.value = saved?.fortune.drawMode || 'daily';
      fortuneMode.disabled = toggles.fortune.disabled || !supported;
      fortuneModeHint.textContent = stale || !saved ? '尚未确认云端设置，请刷新状态。'
        : !supported ? '当前云端版本暂不支持修改抽签方式，请联系管理员更新服务。'
          : busy ? '正在与云端同步…' : '切换后自动保存';
    }
    refreshButton.disabled = !owner || !bridge || busy;
  }
  async function invoke(action, payload = {}) {
    if (busy || !owner || !bridge || disposed) return;
    const requested = generation;
    busy = true;
    render();
    let reload = false;
    try {
      const response = await bridge.invoke({ action, ...(action === 'open' ? {} : { contextId }), payload });
      if (disposed || generation !== requested) return;
      if (response?.ok !== true) throw Object.assign(new Error(response?.error), { code: response?.error });
      if (contextId && contextId !== response.contextId) libraries?.reset();
      contextId = response.contextId;
      if (response.data) {
        saved = response.data;
        stale = false;
      }
      notice = '';
      return response;
    } catch (error) {
      if (disposed || generation !== requested) return;
      if (action.startsWith('library-')) {
        if (error.code === 'DAILY_BOT_ACCOUNT_CHANGED' || error.code === 'LICENSE_NOT_AUTHORIZED') {
          contextId = null;
          stale = true;
          libraries?.reset();
          notice = '账号授权已变化，请刷新云端状态后重新打开词库。';
        }
        return { ok: false, error: error.code };
      }
      stale = true;
      const message =
        action === 'update' && Object.hasOwn(payload, 'drawMode')
          ? ERRORS[error.code] || '抽签方式尚未保存，请刷新确认后重试。'
          : action === 'update' && payload.enabled === false
          ? '关闭尚未同步，机器人可能还在回复。请刷新确认。'
          : ERRORS[error.code] || '状态读取或保存失败，请检查连接并重试。';
      notice = message;
      if (action === 'update') toast(message, { type: 'error' });
      reload = error.code === 'DAILY_BOT_REVISION_CONFLICT';
    } finally {
      if (!disposed && generation === requested) {
        busy = false;
        render();
      }
    }
    if (reload) await invoke('open');
  }
  const refresh = () => invoke('open');
  for (const kind of ['checkin', 'fortune'])
    toggles[kind].addEventListener('change', () => {
      const enabled = toggles[kind].checked;
      void invoke('update', { kind, enabled, expectedRevision: saved[kind].revision });
    });
  fortuneMode?.addEventListener('change', () => {
    if (fortuneMode.disabled || !saved) return;
    void invoke('update', {
      kind: 'fortune', enabled: saved.fortune.enabled,
      expectedRevision: saved.fortune.revision, drawMode: fortuneMode.value,
    });
  });
  function account(snapshot) {
    const streamer = snapshot?.streamer;
    const next =
      snapshot?.state === 'authorized' && streamer?.accountName
        ? JSON.stringify([streamer.accountName, streamer.songPageUrl])
        : '';
    if (next === owner || disposed) return;
    owner = next;
    notice = '';
    generation++;
    contextId = null;
    saved = null;
    libraries?.reset();
    busy = false;
    stale = true;
    render();
    if (owner) void refresh();
  }
  refreshButton.addEventListener('click', refresh);
  const offline = () => {
    stale = true;
    notice = '连接中断，暂时无法确认云端状态。机器人可能还在回复，请在恢复连接后刷新。';
    render();
  };
  windowRef.addEventListener('offline', offline);
  windowRef.addEventListener('online', refresh);
  const unsubscribe = license?.onStateChanged?.(account);
  const initial = generation;
  Promise.resolve(license?.getState?.())
    .then((snapshot) => {
      if (initial === generation) account(snapshot);
    })
    .catch(() => {
      if (!disposed && initial === generation) {
        notice = '账号信息读取失败，请重新连接后刷新。';
        render();
      }
    });
  windowRef.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      generation++;
      unsubscribe?.();
      windowRef.removeEventListener('online', refresh);
      windowRef.removeEventListener('offline', offline);
    },
    { once: true },
  );
  render();
  return { refresh };
}
