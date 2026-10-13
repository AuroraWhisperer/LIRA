const ERROR_MESSAGES = {
  LICENSE_NOT_AUTHORIZED: '请先登录 LIRA 账号。',
  GUARD_EXPIRY_UNSUPPORTED: '服务器尚未支持此功能，请更新服务器。',
  GUARD_EXPIRY_OWNER_MISMATCH: '登录的账号不是当前直播间房主，请使用主播本人的账号。',
  GUARD_EXPIRY_ROOM_REQUIRED: '请先填写右侧直播间号并保存设置，再登录主播账号。',
  GUARD_EXPIRY_SOURCE_CHANGED: '账号或直播间已变更，请重试。',
  BILIBILI_CREDENTIALS_INVALID: 'B 站登录已失效，请重新登录。',
  TOO_MANY_GUARD_EXPIRY_REQUESTS: '操作过于频繁，请稍后重试。',
};

export function initGuardExpirySettings({ documentRef, windowRef }) {
  const source = documentRef.getElementById('guardExpirySource');
  if (!source) return { refresh: async () => {}, updateRoomProfile() {} };
  const status = documentRef.getElementById('guardExpiryAccountStatus');
  const profile = documentRef.getElementById('guardExpiryAccountProfile');
  const avatar = documentRef.getElementById('guardExpiryAccountAvatar');
  const name = documentRef.getElementById('guardExpiryAccountName');
  const uid = documentRef.getElementById('guardExpiryAccountUid');
  const message = documentRef.getElementById('guardExpiryAccountMessage');
  const login = documentRef.getElementById('guardExpiryLoginBtn');
  const logout = documentRef.getElementById('guardExpiryLogoutBtn');
  const retry = documentRef.getElementById('guardExpiryRetryBtn');
  const bridge = windowRef.guardExpiryAuth;
  let account = null;
  let roomProfile = null;
  let busy = false;

  function render() {
    const separate = account?.source === 'separate';
    const showProfile = separate && account.loggedIn;
    const avatarSource = showProfile && roomProfile?.uid === account.uid ? roomProfile.avatarSource : '';
    source.value = account?.source || 'shared';
    source.disabled = busy || !account;
    login.hidden = !separate || account.loggedIn;
    logout.hidden = !separate || !account.loggedIn;
    login.disabled = logout.disabled = retry.disabled = busy;
    profile.hidden = !showProfile;
    name.textContent = showProfile ? account.displayName || 'B 站账号' : '';
    name.title = name.textContent;
    uid.textContent = showProfile ? `UID: ${account.uid}` : '';
    avatar.hidden = !avatarSource;
    avatar.alt = avatarSource ? `${name.textContent}的头像` : '';
    if (avatarSource) avatar.src = avatarSource;
    else avatar.removeAttribute('src');
    status.textContent = !account ? '状态未知' : account.loggedIn ? (separate ? '主播账号已登录' : '已复用上方账号') : '未登录';
    status.className = account?.loggedIn ? 'pill good' : 'pill warn';
  }

  async function run(operation, pendingMessage) {
    if (busy || !bridge) return;
    busy = true;
    render();
    message.textContent = pendingMessage;
    retry.hidden = true;
    try {
      const result = await operation();
      if (!result?.ok) throw Object.assign(new Error(), { code: result?.error });
      if (result.account) account = result.account;
      message.textContent = result.cancelled ? '已取消登录。' : '';
    } catch (error) {
      message.textContent = ERROR_MESSAGES[error.code] || '无法完成操作，请检查连接后重试。';
      retry.hidden = false;
    } finally {
      busy = false;
      render();
    }
  }

  const refresh = () => run(() => bridge.getState(), '正在读取同步账号…');
  avatar.addEventListener('error', () => {
    avatar.hidden = true;
    avatar.alt = '';
    avatar.removeAttribute('src');
  });
  source.addEventListener('change', () => {
    const selected = source.value;
    void run(() => bridge.setSource(selected), '正在保存账号来源…');
  });
  login.addEventListener('click', () => void run(() => bridge.login(), '请在弹出的窗口中登录主播账号…'));
  logout.addEventListener('click', () => void run(() => bridge.logout(), '正在退出主播账号…'));
  retry.addEventListener('click', refresh);
  windowRef.addEventListener('focus', refresh);
  if (bridge) void refresh();
  else {
    render();
    message.textContent = '请从桌面客户端设置同步账号。此项为可选。';
  }
  return { refresh, updateRoomProfile(profile) { roomProfile = profile; render(); } };
}
