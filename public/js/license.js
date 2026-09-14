'use strict';

(function initLicensePage() {
  const api = window.liraLicense;
  const canActivate = typeof api?.activate === 'function';
  const loginCard = document.getElementById('licenseLoginCard');
  const initializationCard = document.getElementById(
    'giftCatalogInitializationCard',
  );
  const form = document.getElementById('licenseForm');
  const accountInput = document.getElementById('licenseAccountName');
  const passwordInput = document.getElementById('licensePassword');
  const passwordToggle = document.getElementById('licensePasswordToggle');
  const passwordIcon = document.getElementById('licensePasswordIcon');
  const codeInput = document.getElementById('licenseActivationCode');
  const submitButton = document.getElementById('licenseSubmitBtn');
  const loginModeButton = document.getElementById('licenseLoginMode');
  const registerModeButton = document.getElementById('licenseRegisterMode');
  const retryButton = document.getElementById('licenseRetryBtn');
  const maximizeButton = document.getElementById('licenseMaximizeBtn');
  const status = document.getElementById('licenseStatus');
  const initializationHeading = document.getElementById(
    'giftCatalogInitializationHeading',
  );
  const initializationPercent = document.getElementById(
    'giftCatalogInitializationPercent',
  );
  const initializationProgress = document.getElementById(
    'giftCatalogInitializationProgress',
  );
  const initializationStatus = document.getElementById(
    'giftCatalogInitializationStatus',
  );
  const initializationRetryButton = document.getElementById(
    'giftCatalogInitializationRetryBtn',
  );
  const initializationBackButton = document.getElementById(
    'giftCatalogInitializationBackBtn',
  );
  let busy = false;
  let registration = true;
  let licenseState = 'needs_activation';
  let showSavedAuthorizationNotice = true;
  let returnedToLogin = false;
  let initializationBusy = false;
  let unsubscribe = () => {};
  let unsubscribeGiftCatalog = () => {};
  let unsubscribeWindowMaximized = () => {};

  const messages = {
    ACTIVATION_CODE_INVALID: '激活密钥无效，请检查后重试。',
    ACTIVATION_CODE_NOT_USABLE: '此激活密钥已使用或已撤销。',
    ACTIVATION_CODE_EXPIRED: '此激活密钥已过期，请联系管理员重新生成。',
    ACCOUNT_NAME_LENGTH: '用户名长度应为 2–32 个字符。',
    ACCOUNT_NAME_INVALID:
      '用户名只能使用小写字母、数字和中划线，且不能以中划线开头或结尾。',
    ACCOUNT_NAME_RESERVED: '此用户名为系统保留名称，请更换。',
    ACCOUNT_NAME_ALREADY_EXISTS:
      '此用户名已被使用；已有账号请选择“登录已有账号”。',
    PASSWORD_TOO_SHORT: '密码至少 8 个字符。',
    PASSWORD_TOO_LONG: '密码不能超过 64 个字符。',
    PASSWORD_CONTROL_CHARACTERS: '密码不能包含换行、控制字符或不可见格式字符。',
    PASSWORD_COMPLEXITY: '密码不符合要求，请查看密码旁的说明。',
    PASSWORD_BCRYPT_TRUNCATED:
      '密码的 UTF-8 编码不能超过 72 字节，请缩短密码。',
    PASSWORD_WEAK: '密码过于常见或接近用户名，请更换。',
    ACCOUNT_NAME_MISMATCH: '此激活码不属于该主播账号。',
    ACCOUNT_NAME_MUST_MATCH_SUBDOMAIN: '用户名与已分配主播空间不一致。',
    INVALID_CREDENTIALS: '用户名或密码错误。',
    ACTIVATION_PROOF_INVALID: '当前设备激活证明失败，请重试。',
    FINGERPRINT_UNAVAILABLE: '无法读取足够的设备标识，暂时无法完成绑定。',
    DEVICE_KEY_UNAVAILABLE: '本机安全存储暂时不可用，请重启 LIRA 后重试。',
    NETWORK_UNAVAILABLE: '无法连接授权服务器，请检查网络后重试。',
    REQUEST_TIMEOUT: '连接授权服务器超时，请重试。',
    BUILD_ID_REQUIRED: '当前客户端版本缺少构建标识。',
    BUILD_NOT_ALLOWED: '当前客户端版本不可使用，请更新 LIRA。',
    INTEGRITY_NOT_VERIFIED: '当前客户端完整性检查未通过。',
    DEVICE_REVOKED: '当前设备授权已被管理员撤销。',
    LICENSE_REVOKED: '当前授权已被撤销。',
    STREAMER_DISABLED: '当前主播账号已停用。',
    DEVICE_FINGERPRINT_MISMATCH: '当前电脑与已绑定设备不一致，请联系管理员。',
    SIGNATURE_INVALID: '本机设备密钥验证失败。',
    DEVICE_NOT_FOUND: '本机设备登记不存在，需要重新激活。',
    DEVICE_IDENTITY_AMBIGUOUS:
      '检测到多条相同电脑的历史记录，请联系管理员核对后重试。',
    PAIRING_CODE_ADMIN_ONLY: '请联系管理员下发新的短效登录码。',
    DEVICE_TOKEN_INVALID: '当前授权会话无效，请重新验证。',
    DEVICE_AUTH_EPOCH_CHANGED: '当前设备授权状态已变更，请重新验证。',
    DEVICE_SESSION_NOT_FOUND: '当前设备会话已失效，请重新验证。',
    DEVICE_SESSION_INVALID: '当前设备会话已被替换，请重新验证。',
    SESSION_SUPERSEDED:
      '当前设备已由另一个 LIRA 进程登录。如需使用本窗口，请先关闭另一进程后重试。',
    SESSION_REVOKED: '当前设备会话已被管理员终止。',
    LICENSE_TOKEN_MISMATCH: '当前授权与设备不匹配，请联系管理员。',
    CHALLENGE_EXPIRED: '验证请求已过期，请重试。',
    CHALLENGE_NOT_FOUND: '验证请求已失效，请重试连接。',
    CHALLENGE_ALREADY_USED: '验证请求已被使用，请重试连接。',
    CHALLENGE_MISMATCH: '验证请求不匹配，请重试连接。',
    CHALLENGE_PROTOCOL_MISMATCH:
      '当前客户端授权协议与服务器不兼容，请更新 LIRA。',
    TOO_MANY_PAIRING_CODE_REQUESTS: '新设备授权码生成过于频繁，请稍后再试。',
    TOO_MANY_ACTIVE_PAIRING_CODES:
      '当前已有多张仍有效的新设备授权码，请先使用、撤销或等待过期。',
    PAIRING_CODE_NOT_FOUND: '找不到这张新设备授权码。',
    PAIRING_CODE_ALREADY_CONSUMED:
      '这张新设备授权码已使用或已撤销，不能再次操作。',
    ACTIVATION_INPUT_INVALID: '请完整填写三个字段。',
  };

  function setStatus(message, tone = '') {
    status.textContent = message || '';
    status.className = `license-status${tone ? ` ${tone}` : ''}`;
  }

  function errorMessage(code) {
    const value = String(code || '');
    if (/^HTTP_(429|5\d\d)$/.test(value))
      return '授权服务器暂时不可用，请稍后重试。';
    return messages[value] || '激活失败，请检查信息后重试。';
  }

  function connectionErrorMessage(code) {
    const value = String(code || '');
    if (messages[value] || /^HTTP_(429|5\d\d)$/.test(value))
      return errorMessage(value);
    return messages.NETWORK_UNAVAILABLE;
  }

  function validate() {
    const accountName = accountInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const activationCode = codeInput.value.trim();
    accountInput.value = accountName;
    if (!accountName) return '请输入用户名。';
    if (accountName.length < 2 || accountName.length > 32)
      return messages.ACCOUNT_NAME_LENGTH;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(accountName))
      return messages.ACCOUNT_NAME_INVALID;
    if (!password) return '请输入密码。';
    if (!activationCode)
      return registration ? '请输入注册激活码。' : '请输入短效登录码。';
    return '';
  }

  function setAccountMode(isRegistration) {
    if (busy) return;
    registration = isRegistration;
    loginModeButton?.setAttribute('aria-pressed', String(!registration));
    registerModeButton?.setAttribute('aria-pressed', String(registration));
    for (const [id, value] of [
      ['licenseHeading', registration ? '注册 LIRA' : '登录 LIRA'],
      [
        'licenseModeDescription',
        registration
          ? '创建账号并授权这台电脑'
          : '重装或使用新电脑，请向管理员获取短效登录码',
      ],
      ['licenseCodeLabel', registration ? '注册激活码' : '短效登录码'],
      [
        'licenseCodeHelp',
        registration
          ? '由管理员下发的一次性注册码，用户名不可重复'
          : '由管理员下发，仅限本账号使用一次；同机重装保留原授权记录',
      ],
      ['licenseSubmitLabel', registration ? '注册并进入' : '登录并进入'],
    ]) {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    }
    passwordInput.setAttribute(
      'autocomplete',
      registration ? 'new-password' : 'current-password',
    );
    passwordInput.value = '';
    codeInput.value = '';
    setPasswordVisible(false);
    setStatus('');
  }

  function setPasswordVisible(visible) {
    const label = visible ? '隐藏密码' : '显示密码';
    passwordInput.type = visible ? 'text' : 'password';
    passwordToggle.setAttribute('aria-label', label);
    passwordToggle.setAttribute('aria-pressed', String(visible));
    passwordToggle.title = label;
    passwordIcon.setAttribute(
      'href',
      `/img/shared/password-visibility.svg#${visible ? 'eye-off' : 'eye'}`,
    );
  }

  function render(snapshot = {}) {
    const state = String(snapshot.state || 'needs_activation');
    licenseState = state;
    if (state === 'authorizing' || state === 'authorized')
      showSavedAuthorizationNotice = false;
    if (state !== 'authorized') returnedToLogin = false;
    if (state === 'authorized' && !returnedToLogin) {
      showGiftCatalogInitialization();
      loadGiftCatalogState();
      return;
    }
    loginCard.hidden = false;
    initializationCard.hidden = true;
    const isAuthorizing = state === 'authorizing' || busy;
    submitButton.disabled = isAuthorizing || !canActivate;
    retryButton.hidden = !(
      state === 'needs_connection' ||
      state === 'blocked' ||
      state === 'authorized'
    );
    retryButton.textContent = state === 'authorized' ? '继续准备' : '重试连接';
    retryButton.disabled = isAuthorizing;
    if (state === 'authorized')
      setStatus('本机授权已通过，可继续准备。', 'good');
    else if (state === 'checking') setStatus('正在检查本机设备授权…', 'loading');
    else if (state === 'authorizing')
      setStatus('正在验证账号与本机授权，请稍候…', 'loading');
    else if (state === 'needs_connection')
      setStatus(connectionErrorMessage(snapshot.error), 'error');
    else if (
      state === 'blocked' &&
      snapshot.error === 'DEVICE_REVOKED' &&
      showSavedAuthorizationNotice
    )
      setStatus('本机保留的旧设备授权已撤销，请获取新的短效登录码后重新登录。');
    else if (state === 'blocked')
      setStatus(errorMessage(snapshot.error), 'error');
    else if (snapshot.error) setStatus(errorMessage(snapshot.error), 'error');
  }

  function showGiftCatalogInitialization() {
    loginCard.hidden = true;
    initializationCard.hidden = false;
  }

  function renderGiftCatalogState(snapshot = {}) {
    if (licenseState !== 'authorized' || returnedToLogin) return;
    showGiftCatalogInitialization();
    const catalogStatus =
      snapshot?.ok === false && snapshot?.status !== 'ready'
        ? 'error'
        : String(snapshot.status || 'required');
    const percent = Math.min(100, safeCount(snapshot.percent));
    initializationProgress.value = percent;
    initializationPercent.textContent = `${percent}%`;
    initializationRetryButton.hidden = catalogStatus !== 'error';
    initializationRetryButton.disabled = catalogStatus !== 'error';
    initializationBackButton.hidden = catalogStatus !== 'error';
    initializationCard.setAttribute(
      'aria-busy',
      catalogStatus === 'ready' || catalogStatus === 'error' ? 'false' : 'true',
    );

    if (catalogStatus === 'error') {
      initializationHeading.textContent = '准备未完成';
      setInitializationStatus(catalogErrorMessage(snapshot.error), 'error');
      return;
    }
    if (catalogStatus === 'ready') {
      initializationHeading.textContent = '准备完成，正在进入 LIRA';
      setInitializationStatus('');
      return;
    }

    initializationHeading.textContent = '正在为你准备直播工具';
    setInitializationStatus('');
  }

  function setInitializationStatus(message, tone) {
    initializationStatus.textContent = message;
    initializationStatus.hidden = !message;
    initializationStatus.className = `license-status license-initialization-status${tone ? ` ${tone}` : ''}`;
  }

  function catalogErrorMessage(code) {
    const value = String(code || '');
    if (
      value === 'REMOTE_CATALOG_NOT_READY' ||
      value === 'REMOTE_CATALOG_EMPTY' ||
      value === 'NETWORK_UNAVAILABLE' ||
      value === 'REQUEST_TIMEOUT' ||
      /^HTTP_(429|5\d\d)$/.test(value)
    )
      return '暂时无法完成准备，请检查网络后重试。';
    return '准备失败，请重试或返回登录。';
  }

  function safeCount(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function finishBusy() {
    busy = false;
    submitButton.disabled = !canActivate;
    retryButton.disabled = false;
  }

  async function loadState() {
    if (!api?.getState) return;
    try {
      render(await api.getState());
    } catch (_) {
      setStatus(errorMessage('NETWORK_UNAVAILABLE'), 'error');
    }
  }

  async function loadGiftCatalogState() {
    if (!api?.getGiftCatalogState) {
      renderGiftCatalogState({
        status: 'error',
        phase: 'error',
        error: 'CATALOG_INITIALIZATION_UNAVAILABLE',
      });
      return;
    }
    try {
      renderGiftCatalogState(await api.getGiftCatalogState());
    } catch (_) {
      renderGiftCatalogState({
        status: 'error',
        phase: 'error',
        error: 'NETWORK_UNAVAILABLE',
      });
    }
  }

  async function activate(event) {
    event.preventDefault();
    if (busy) return;
    const validationError = validate();
    if (validationError) {
      setStatus(validationError, 'error');
      return;
    }
    busy = true;
    render({ state: 'authorizing' });
    try {
      const result = await api?.activate?.({
        accountName: accountInput.value,
        password: passwordInput.value,
        activationCode: codeInput.value,
      });
      if (result?.ok) {
        passwordInput.value = '';
        codeInput.value = '';
        setPasswordVisible(false);
        render(result);
      } else {
        render(result || { state: 'needs_activation' });
      }
    } catch (_) {
      setStatus(errorMessage('NETWORK_UNAVAILABLE'), 'error');
    } finally {
      finishBusy();
    }
  }

  async function retry() {
    if (busy) return;
    if (licenseState === 'authorized') return retryGiftCatalog();
    if (!api?.retry) return;
    showSavedAuthorizationNotice = false;
    busy = true;
    render({ state: 'checking' });
    try {
      const result = await api.retry();
      render(result);
    } catch (_) {
      setStatus(errorMessage('NETWORK_UNAVAILABLE'), 'error');
    } finally {
      finishBusy();
    }
  }

  async function retryGiftCatalog() {
    if (
      initializationBusy ||
      licenseState !== 'authorized' ||
      !api?.retryGiftCatalog
    )
      return;
    initializationBusy = true;
    returnedToLogin = false;
    initializationRetryButton.disabled = true;
    renderGiftCatalogState({ status: 'running', phase: 'catalog' });
    try {
      renderGiftCatalogState(await api.retryGiftCatalog());
    } catch (_) {
      renderGiftCatalogState({
        status: 'error',
        phase: 'error',
        error: 'NETWORK_UNAVAILABLE',
      });
    } finally {
      initializationBusy = false;
    }
  }

  function returnToLogin() {
    returnedToLogin = true;
    passwordInput.value = '';
    codeInput.value = '';
    setPasswordVisible(false);
    render({ state: licenseState });
  }

  form?.addEventListener('submit', activate);
  loginModeButton?.addEventListener('click', () => setAccountMode(false));
  registerModeButton?.addEventListener('click', () => setAccountMode(true));
  passwordToggle?.addEventListener('click', () =>
    setPasswordVisible(passwordInput.type === 'password'),
  );
  retryButton?.addEventListener('click', retry);
  initializationRetryButton?.addEventListener('click', retryGiftCatalog);
  initializationBackButton?.addEventListener('click', returnToLogin);
  document
    .getElementById('licenseMinimizeBtn')
    ?.addEventListener('click', () =>
      window.songAssistantDesktop?.minimizeWindow?.(),
    );
  maximizeButton?.addEventListener('click', () =>
    window.songAssistantDesktop?.maximizeWindow?.(),
  );
  document
    .getElementById('licenseCloseBtn')
    ?.addEventListener('click', () =>
      window.songAssistantDesktop?.closeWindow?.(),
    );
  if (maximizeButton && window.songAssistantDesktop?.onWindowMaximized) {
    unsubscribeWindowMaximized = window.songAssistantDesktop.onWindowMaximized(
      (isMaximized) => {
        maximizeButton.dataset.maximized = String(isMaximized);
        maximizeButton.title = isMaximized ? '还原' : '最大化';
        maximizeButton.setAttribute('aria-label', maximizeButton.title);
      },
    );
  }
  if (api?.onStateChanged)
    unsubscribe = api.onStateChanged((snapshot) => {
      render(snapshot);
    });
  if (api?.onGiftCatalogStateChanged)
    unsubscribeGiftCatalog = api.onGiftCatalogStateChanged(
      renderGiftCatalogState,
    );
  window.addEventListener('pagehide', () => {
    unsubscribeWindowMaximized();
    unsubscribeGiftCatalog();
    unsubscribe();
  });
  // The page CSP blocks native submission even if this script cannot initialize.
  if (form && submitButton) {
    submitButton.disabled = !canActivate;
    setStatus(canActivate ? '' : '激活功能未就绪，请重启 LIRA 后重试。');
  }
  loadState();
})();
