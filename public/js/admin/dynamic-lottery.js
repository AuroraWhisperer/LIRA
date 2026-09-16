'use strict';

import { initLotteryWorkflow } from './dynamic-lottery-workflow.js';

const ERROR_MESSAGES = {
  LOTTERY_IDENTITY_UNAVAILABLE: '请先完成 LIRA 账号授权，再登录抽奖账号。',
  LOTTERY_SESSION_CHANGED: '账号或授权已变化，请刷新状态后重试。',
  LOTTERY_SESSION_DISPOSED: '软件正在退出，请重新打开后操作。',
  LOTTERY_AUTH_BUSY: '账号操作正在进行，请稍后重试。',
  LOTTERY_AUTH_ENCRYPTION_UNAVAILABLE:
    '系统加密存储不可用，无法保存登录。请重启软件后重试。',
  LOTTERY_AUTH_RESTORE_FAILED: '未能恢复抽奖登录，请退出此账号后重新登录。',
};

export function initDynamicLottery({
  root = document.getElementById('otherDynamicLotteryFeature'),
  api = window.dynamicLotteryAuth,
  license = window.liraLicense,
} = {}) {
  if (!root) return { dispose() {} };
  const workflow = initLotteryWorkflow(root);
  const status = root.querySelector('[data-lottery-auth-status]');
  const message = root.querySelector('[data-lottery-auth-message]');
  const loginButton = root.querySelector('[data-lottery-login]');
  const logoutButton = root.querySelector('[data-lottery-logout]');
  const refreshButton = root.querySelector('[data-lottery-auth-refresh]');
  const accountToggle = root.querySelector('[data-lottery-account-toggle]');
  const accountPanel = root.querySelector('[data-lottery-account-panel]');
  let busy = false;
  let disposed = false;
  let generation = 0;
  let state = { loggedIn: false, uid: '', warning: '' };
  const available = ['getState', 'login', 'logout'].every(
    (name) => typeof api?.[name] === 'function',
  );

  function render() {
    status.textContent = state.loggedIn
      ? `已登录 · UID ${state.uid}`
      : '未登录抽奖账号';
    status.setAttribute('data-connected', String(state.loggedIn));
    loginButton.hidden = state.loggedIn;
    loginButton.disabled = !available || busy || state.loggedIn;
    logoutButton.disabled =
      !available || busy || (!state.loggedIn && !state.warning);
    refreshButton.disabled = !available || busy;
    root.setAttribute('aria-busy', String(busy));
    workflow.setAuth({ available, busy, loggedIn: state.loggedIn });
  }

  async function perform(action) {
    if (!available || busy || disposed) return;
    const request = ++generation;
    busy = true;
    message.textContent =
      action === 'login'
        ? '请在独立窗口登录动态作者账号；完成后窗口会自动关闭。'
        : '';
    render();
    try {
      const response = await api[action]();
      if (disposed || request !== generation) return;
      if (!response?.ok) {
        state = { loggedIn: false, uid: '', warning: '' };
        message.textContent =
          ERROR_MESSAGES[response?.error] || '操作未完成，请刷新状态后重试。';
      } else {
        state = response.state;
        message.textContent =
          ERROR_MESSAGES[state.warning] ||
          (action === 'login' && !state.loggedIn
            ? '登录尚未完成，可再次打开登录窗口。'
            : action === 'logout'
              ? '已退出抽奖账号，直播账号不受影响。'
              : '');
      }
    } catch {
      if (disposed || request !== generation) return;
      message.textContent = '无法读取抽奖账号，请刷新状态后重试。';
    } finally {
      if (!disposed && request === generation) {
        busy = false;
        render();
      }
    }
  }

  const onLogin = () => perform('login');
  const onLogout = () => perform('logout');
  const onRefresh = () => perform('getState');
  const onToggleAccount = () => {
    accountPanel.hidden = !accountPanel.hidden;
    accountToggle.setAttribute('aria-expanded', String(!accountPanel.hidden));
  };
  loginButton.addEventListener('click', onLogin);
  logoutButton.addEventListener('click', onLogout);
  refreshButton.addEventListener('click', onRefresh);
  accountToggle.addEventListener('click', onToggleAccount);
  const unsubscribe = license?.onStateChanged?.(() => {
    generation += 1;
    busy = false;
    state = { loggedIn: false, uid: '', warning: '' };
    workflow.reset();
    render();
    void perform('getState');
  });
  render();
  if (available) void perform('getState');
  else
    message.textContent =
      '请在 LIRA 桌面版中登录抽奖账号，浏览器页面不提供账号登录。';

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      unsubscribe?.();
      workflow.dispose();
      loginButton.removeEventListener('click', onLogin);
      logoutButton.removeEventListener('click', onLogout);
      refreshButton.removeEventListener('click', onRefresh);
      accountToggle.removeEventListener('click', onToggleAccount);
    },
  };
}
