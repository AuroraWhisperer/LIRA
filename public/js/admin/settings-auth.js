'use strict';

/**
 * Bind the desktop Bilibili authentication controls.
 *
 * The browser and preload objects are passed in so this module remains a
 * focused UI adapter and does not reach through the Admin compatibility bag.
 */
export function initBilibiliAuth({
  documentRef,
  windowRef,
  toast,
  logoutConfirm,
}) {
  const statusEl = documentRef.getElementById('bilibiliAuthStatus');
  const uidEl = documentRef.getElementById('bilibiliAuthUid');
  const loginBtn = documentRef.getElementById('bilibiliLoginBtn');
  const logoutBtn = documentRef.getElementById('bilibiliLogoutBtn');

  const isDesktop = Boolean(windowRef.bilibiliAuth);
  if (!isDesktop) {
    statusEl.textContent = 'Web 模式（不可用）';
    statusEl.className = 'pill';
    loginBtn.disabled = true;
    loginBtn.title = 'Bilibili 扫码登录仅在桌面版中可用';
    return;
  }

  async function refreshAuthState() {
    try {
      const state = await windowRef.bilibiliAuth.getAuthState();
      if (state?.loggedIn) {
        statusEl.textContent = '已登录';
        statusEl.className = 'pill good';
        uidEl.textContent = state.uid ? `UID: ${state.uid}` : '';
        loginBtn.style.display = 'none';
        logoutBtn.style.display = '';
      } else {
        statusEl.textContent = '未登录';
        statusEl.className = 'pill warn';
        uidEl.textContent = '';
        loginBtn.style.display = '';
        logoutBtn.style.display = 'none';
      }
    } catch (error) {
      void error;
      statusEl.textContent = '状态未知';
      statusEl.className = 'pill';
    }
  }

  loginBtn.addEventListener('click', async () => {
    loginBtn.disabled = true;
    loginBtn.textContent = '⏳ 请在弹出窗口中扫码…';
    try {
      const result = await windowRef.bilibiliAuth.login();
      if (result?.state) {
        await refreshAuthState();
        if (result.state.loggedIn) {
          documentRef.dispatchEvent(
            new CustomEvent('app:bilibili-auth-changed'),
          );
          toast('Bilibili 登录成功！弹幕姬状态已刷新。');
        }
      }
    } catch (error) {
      toast('登录失败：' + (error.message || String(error)));
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = '📱 扫码登录 Bilibili';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    const confirmed = await logoutConfirm({
      title: '退出登录',
      platform: 'Bilibili',
      message: '退出后弹幕连接将回退到匿名模式。建议点击"刷新直播"重连。',
      icon: '→',
      confirmLabel: '确认退出',
    });
    if (!confirmed) return;

    logoutBtn.disabled = true;
    logoutBtn.textContent = '退出中…';
    try {
      await windowRef.bilibiliAuth.logout();
      await refreshAuthState();
      toast('Bilibili 已退出登录。建议点击"刷新直播"重连。');
    } catch (error) {
      toast('退出失败：' + (error.message || String(error)));
    } finally {
      logoutBtn.disabled = false;
      logoutBtn.textContent = '退出登录';
    }
  });

  void refreshAuthState();
}
