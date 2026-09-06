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
  const profileEl = documentRef.getElementById('bilibiliAuthProfile');
  const avatarEl = documentRef.getElementById('bilibiliAuthAvatar');
  const nameEl = documentRef.getElementById('bilibiliAuthName');
  const uidEl = documentRef.getElementById('bilibiliAuthUid');
  const loginBtn = documentRef.getElementById('bilibiliLoginBtn');
  const logoutBtn = documentRef.getElementById('bilibiliLogoutBtn');
  let refreshRequest = 0;

  function clearProfile() {
    profileEl.hidden = true;
    avatarEl.hidden = true;
    avatarEl.alt = '';
    avatarEl.removeAttribute('src');
    nameEl.textContent = '';
    nameEl.removeAttribute('title');
    uidEl.textContent = '';
  }

  function renderProfile(profile, fallbackUid) {
    const uid = Number(profile?.uid) || Number(fallbackUid) || 0;
    const name = String(profile?.name || '').trim();
    const avatarSource = bilibiliAvatarSource(
      profile?.avatarUrl,
      windowRef.__API_TOKEN__,
    );

    profileEl.hidden = !uid && !name && !avatarSource;
    uidEl.textContent = uid ? `UID: ${uid}` : '';
    nameEl.textContent = name;
    if (name) nameEl.title = name;
    else nameEl.removeAttribute('title');

    avatarEl.hidden = !avatarSource;
    avatarEl.alt = avatarSource
      ? name
        ? `${name}的头像`
        : 'Bilibili 账号头像'
      : '';
    if (avatarSource) avatarEl.src = avatarSource;
    else avatarEl.removeAttribute('src');
  }

  avatarEl.addEventListener('error', () => {
    avatarEl.hidden = true;
    avatarEl.alt = '';
    avatarEl.removeAttribute('src');
  });

  const isDesktop = Boolean(windowRef.bilibiliAuth);
  if (!isDesktop) {
    statusEl.textContent = 'Web 模式（不可用）';
    statusEl.className = 'pill';
    loginBtn.disabled = true;
    loginBtn.title = 'Bilibili 扫码登录仅在桌面版中可用';
    return;
  }

  async function refreshAuthState() {
    const requestId = ++refreshRequest;
    try {
      const state = await windowRef.bilibiliAuth.getAuthState();
      if (requestId !== refreshRequest) return;
      if (state?.loggedIn) {
        statusEl.textContent = '本机已登录';
        statusEl.className = 'pill good';
        renderProfile(null, state.uid);
        loginBtn.style.display = 'none';
        logoutBtn.style.display = '';
        void refreshProfile(requestId, state.uid);
      } else {
        statusEl.textContent = '本机未登录';
        statusEl.className = 'pill warn';
        clearProfile();
        loginBtn.style.display = '';
        logoutBtn.style.display = 'none';
      }
    } catch (error) {
      void error;
      if (requestId !== refreshRequest) return;
      statusEl.textContent = '状态未知';
      statusEl.className = 'pill';
      clearProfile();
    }
  }

  async function refreshProfile(requestId, uid) {
    if (typeof windowRef.bilibiliAuth.getProfile !== 'function') return;
    try {
      const profile = await windowRef.bilibiliAuth.getProfile();
      if (requestId !== refreshRequest) return;
      renderProfile(profile, uid);
    } catch (error) {
      void error;
      // Keep the authenticated UID visible when Bilibili profile lookup fails.
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
          toast(
            'Bilibili 登录成功；凭据只属于当前 LIRA 账号。云端凭据保存成功且直播间已配置并启用后，才开始接收弹幕和礼物。',
          );
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
      message:
        '退出后会同步当前 LIRA 账号的 Bilibili 退出状态；同步成功后停止该账号的云端监听。离线时不会回退为匿名采集。',
      icon: '→',
      confirmLabel: '确认退出',
    });
    if (!confirmed) return;

    logoutBtn.disabled = true;
    logoutBtn.textContent = '退出中…';
    try {
      await windowRef.bilibiliAuth.logout();
      await refreshAuthState();
      documentRef.dispatchEvent(
        new CustomEvent('app:bilibili-auth-changed'),
      );
      toast(
        'Bilibili 已退出；当前 LIRA 账号的云端状态需在同步成功后生效，不会回退为匿名采集。',
      );
    } catch (error) {
      toast('退出失败：' + (error.message || String(error)));
    } finally {
      logoutBtn.disabled = false;
      logoutBtn.textContent = '退出登录';
    }
  });

  void refreshAuthState();
}

export function bilibiliAvatarSource(value, token = '') {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.hdslb.com')) {
      return '';
    }
    const query = new URLSearchParams({ url: url.toString() });
    const apiToken = String(token || '').trim();
    if (apiToken) query.set('token', apiToken);
    return `/api/bilibili/avatar?${query.toString()}`;
  } catch (_) {
    return '';
  }
}
