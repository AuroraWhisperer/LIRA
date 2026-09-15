import { toast } from '../../shared/toast.js';

const KEYS = ['giftAutoThanksEnabled', 'giftStatsQueryEnabled'];
const ERRORS = {
  BILIBILI_LOGIN_REQUIRED: '请先登录 B 站，再同步到服务器。',
  BILIBILI_CREDENTIALS_INVALID: 'B 站登录已失效，请重新登录并同步。',
  BILIBILI_CREDENTIALS_UNAVAILABLE: 'B 站登录已失效，请重新登录并同步。',
  BILIBILI_ACCOUNT_MISMATCH: 'B 站登录已失效，请重新登录并同步。',
  BILIBILI_ACCOUNT_CHECK_FAILED: 'B 站登录验证超时，请稍后再试。',
  CLOUD_SETTINGS_CHANGED: '账号或房间已变化，请确认后重试。',
  DEVICE_SESSION_INVALID: '设备授权已失效，请重新登录 LIRA。',
  LICENSE_NOT_AUTHORIZED: '尚未连接服务器，请恢复连接后重试。',
};

export function initGiftInteractionControls({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  bridge = windowRef?.liraLicense,
  notify = toast,
} = {}) {
  const panel = documentRef?.getElementById('giftInteractionControls');
  if (!panel || !bridge?.getGiftInteractionState || !bridge?.setGiftInteraction) return () => {};
  const inputs = KEYS.map((key) => documentRef.getElementById(key));
  const status = documentRef.getElementById('giftInteractionStatus');
  const retry = documentRef.getElementById('giftInteractionRefresh');
  let state = { values: {}, status: 'unconfirmed' };
  let saving = false;
  let disposed = false;
  let eventVersion = 0;
  panel.hidden = false;

  function render(snapshot) {
    if (disposed) return;
    state = snapshot;
    for (let index = 0; index < KEYS.length; index += 1) {
      inputs[index].checked = state.values?.[KEYS[index]] === true;
      inputs[index].disabled = saving || state.status === 'pending';
    }
    status.textContent = state.status === 'pending' || saving ? '正在同步，等待服务器确认…'
      : state.status === 'confirmed' ? '已同步到服务器'
        : ERRORS[state.error] || '状态未确认，请刷新核对。';
    retry.hidden = state.status === 'confirmed';
    retry.disabled = saving || state.status === 'pending';
  }

  async function refresh() {
    const version = eventVersion;
    try {
      const snapshot = await bridge.getGiftInteractionState();
      if (version === eventVersion) render(snapshot);
    } catch {
      if (version === eventVersion) render({ ...state, status: 'unconfirmed' });
    }
  }

  async function change(index) {
    const enabled = inputs[index].checked;
    if (saving) { render(state); return; }
    saving = true;
    render(state);
    const version = eventVersion;
    let result;
    try {
      result = await bridge.setGiftInteraction(KEYS[index], enabled);
    } catch {
      result = { ...state, ok: false, status: 'unconfirmed' };
    }
    saving = false;
    if (disposed) return;
    // Events can overtake the invoke reply after an account or cloud change.
    if (version !== eventVersion && state.status !== 'pending' && (
      state.status !== result.status ||
      (state.error || null) !== (result.error || null) ||
      KEYS.some((key) => (state.values?.[key] === true) !== (result.values?.[key] === true))
    )) {
      render(state);
      return;
    }
    render(result);
    if (result.ok && result.status === 'confirmed' && result.values?.[KEYS[index]] === enabled) {
      notify(enabled ? '已开启，服务器会持续运行。' : '已关闭并同步到服务器。');
    } else {
      const message = !enabled && result.status !== 'confirmed'
        ? '关闭还没同步，服务器可能仍在运行。'
        : ERRORS[result.error] || '设置尚未确认，请刷新核对后重试。';
      status.textContent = message;
      notify(message);
    }
  }

  const handlers = inputs.map((input, index) => {
    const handler = () => { void change(index); };
    input.addEventListener('change', handler);
    return handler;
  });
  const unsubscribe = bridge.onGiftInteractionStateChanged?.((snapshot) => {
    eventVersion += 1;
    render(snapshot);
  });
  retry.addEventListener('click', refresh);
  windowRef.addEventListener('online', refresh);
  windowRef.addEventListener('beforeunload', dispose, { once: true });
  render(state);
  void refresh();

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    inputs.forEach((input, index) => input.removeEventListener('change', handlers[index]));
    retry.removeEventListener('click', refresh);
    windowRef.removeEventListener('online', refresh);
    windowRef.removeEventListener('beforeunload', dispose);
  }
  return dispose;
}
