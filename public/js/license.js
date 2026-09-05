'use strict';

(function initLicensePage() {
  const api = window.liraLicense;
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
  const retryButton = document.getElementById('licenseRetryBtn');
  const maximizeButton = document.getElementById('licenseMaximizeBtn');
  const status = document.getElementById('licenseStatus');
  const initializationHeading = document.getElementById(
    'giftCatalogInitializationHeading',
  );
  const initializationPhase = document.getElementById(
    'giftCatalogInitializationPhase',
  );
  const initializationPercent = document.getElementById(
    'giftCatalogInitializationPercent',
  );
  const initializationCount = document.getElementById(
    'giftCatalogInitializationCount',
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
  let busy = false;
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
    ACCOUNT_NAME_ALREADY_EXISTS: '此用户名已被使用，请更换或联系管理员。',
    PASSWORD_TOO_SHORT: '密码至少 8 个字符。',
    PASSWORD_TOO_LONG: '密码不能超过 64 个字符。',
    PASSWORD_CONTROL_CHARACTERS:
      '密码不能包含换行、控制字符或不可见格式字符。',
    PASSWORD_COMPLEXITY:
      '密码需包含大写字母、小写字母、数字、特殊符号、中文等无大小写字母中的至少三类。',
    PASSWORD_BCRYPT_TRUNCATED:
      '密码的 UTF-8 编码不能超过 72 字节，请缩短密码。',
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
    // Keep legacy passwords eligible; the server owns new-password policy.
    if (password.length < 6) return messages.PASSWORD_TOO_SHORT;
    if (password.length > 128) return messages.PASSWORD_TOO_LONG;
    if (!activationCode) return '请输入激活密钥。';
    return '';
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
    if (state === 'authorized') {
      showGiftCatalogInitialization();
      loadGiftCatalogState();
      return;
    }
    loginCard.hidden = false;
    initializationCard.hidden = true;
    const isAuthorizing = state === 'authorizing' || busy;
    submitButton.disabled = isAuthorizing;
    retryButton.hidden = !(state === 'needs_connection' || state === 'blocked');
    retryButton.disabled = isAuthorizing;
    if (state === 'checking') setStatus('正在检查本机设备授权…', 'loading');
    else if (state === 'authorizing')
      setStatus('正在绑定设备并验证授权，请稍候…', 'loading');
    else if (state === 'needs_connection')
      setStatus(connectionErrorMessage(snapshot.error), 'error');
    else if (state === 'blocked')
      setStatus(errorMessage(snapshot.error), 'error');
    else if (snapshot.error) setStatus(errorMessage(snapshot.error), 'error');
  }

  function showGiftCatalogInitialization() {
    loginCard.hidden = true;
    initializationCard.hidden = false;
  }

  function renderGiftCatalogState(snapshot = {}) {
    showGiftCatalogInitialization();
    const catalogStatus =
      snapshot?.ok === false && snapshot?.status !== 'ready'
        ? 'error'
        : String(snapshot.status || 'required');
    const phase = String(snapshot.phase || 'idle');
    const total = safeCount(snapshot.total);
    const completed = Math.min(safeCount(snapshot.completed), total);
    const failed = Math.min(safeCount(snapshot.failed), completed);
    const percent = Math.min(100, safeCount(snapshot.percent));
    initializationProgress.value = percent;
    initializationPercent.textContent = `${percent}%`;
    initializationCount.textContent = total
      ? `${completed} / ${total} 张`
      : '等待目录';
    initializationRetryButton.hidden = catalogStatus !== 'error';
    initializationRetryButton.disabled = catalogStatus !== 'error';
    initializationCard.setAttribute(
      'aria-busy',
      catalogStatus === 'ready' || catalogStatus === 'error' ? 'false' : 'true',
    );

    if (catalogStatus === 'error') {
      initializationHeading.textContent = '礼物图片准备未完成';
      initializationPhase.textContent = '无法获取礼物目录';
      setInitializationStatus(catalogErrorMessage(snapshot.error), 'error');
      return;
    }
    if (catalogStatus === 'ready') {
      initializationHeading.textContent = '礼物图片准备完成';
      initializationPhase.textContent = '正在进入 LIRA';
      setInitializationStatus(
        failed > 0
          ? `${failed} 张图片暂不可用，后续启动会继续补齐。`
          : '全部礼物图片已准备好。',
        'good',
      );
      return;
    }

    initializationHeading.textContent = '正在准备礼物图片';
    if (phase === 'images') {
      initializationPhase.textContent = '正在下载礼物图片';
      const giftName = String(snapshot.currentGiftName || '').trim();
      setInitializationStatus(
        giftName ? `正在处理：${giftName}` : '正在检查本地图片…',
        'loading',
      );
    } else {
      initializationPhase.textContent = '正在获取礼物目录';
      setInitializationStatus('正在连接服务器…', 'loading');
    }
  }

  function setInitializationStatus(message, tone) {
    initializationStatus.textContent = message;
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
      return '礼物目录暂时无法下载，请检查网络后重试。';
    return '礼物图片初始化失败，请重试。';
  }

  function safeCount(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function finishBusy() {
    busy = false;
    submitButton.disabled = false;
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
    if (busy || !api?.retry) return;
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
    if (!api?.retryGiftCatalog) return;
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
    }
  }

  form?.addEventListener('submit', activate);
  passwordToggle?.addEventListener('click', () =>
    setPasswordVisible(passwordInput.type === 'password'),
  );
  retryButton?.addEventListener('click', retry);
  initializationRetryButton?.addEventListener('click', retryGiftCatalog);
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
  loadState();
})();
