'use strict';

let lastStatus = null;
let accountOperationPending = false;

export function isSubscriptionSelected() {
  return document.getElementById('xiaomiAiModelProvider')?.value === 'openai'
    && document.getElementById('xiaomiAiModelAuthMode')?.value === 'subscription';
}

export function renderSubscriptionStatus(status = lastStatus) {
  lastStatus = status;
  const selected = isSubscriptionSelected();
  const panel = document.getElementById('xiaomiAiChatGptAccount');
  if (!panel) return;
  panel.hidden = !selected;
  if (!selected) return;
  const text = !status ? '正在读取 ChatGPT 登录状态…'
    : status.lastError || (!status.available ? '请在支持系统加密的 LIRA 桌面客户端登录。'
      : status.pending ? '请在系统浏览器完成 ChatGPT 授权，完成后此处会自动更新。'
        : status.ready ? '正在使用 ChatGPT 订阅。' : status.loggedIn ? '已登录，尚未授权使用订阅。' : '尚未连接 ChatGPT 订阅。');
  document.getElementById('xiaomiAiChatGptState').textContent = text;
  const profiles = document.getElementById('xiaomiAiChatGptProfiles');
  const options = (status?.profiles || []).map(profile => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.label}${profile.loggedIn ? '' : '（需登录）'}`;
    return option;
  });
  profiles.replaceChildren(...options);
  profiles.value = status?.activeId || '';
  document.getElementById('xiaomiAiChatGptProfileControl').hidden = !options.length;
  profiles.disabled = Boolean(status?.pending);
  document.getElementById('xiaomiAiChatGptLogin').disabled = !status?.available || Boolean(status?.pending);
  document.getElementById('xiaomiAiChatGptAdd').hidden = !options.length;
  document.getElementById('xiaomiAiChatGptAdd').disabled = !status?.available || Boolean(status?.pending);
  document.getElementById('xiaomiAiChatGptCancel').hidden = !status?.pending;
  document.getElementById('xiaomiAiChatGptLogout').hidden = !status?.loggedIn;
  document.getElementById('xiaomiAiChatGptLogout').disabled =
    accountOperationPending || !status?.available || !status?.loggedIn || !status.activeId;
  document.getElementById('xiaomiAiConfigState').textContent = status?.ready && document.getElementById('xiaomiAiTrigger')?.value
    && document.getElementById('xiaomiAiModel')?.value ? '可运行' : '等待配置';
}

export function createSubscriptionControls({ readApi, flushPendingSave, onAccountChange }) {
  let refreshing = false;
  let identity = '';
  let statusRevision = 0;
  let acceptedRevision = 0;
  const logoutButton = document.getElementById('xiaomiAiChatGptLogout');
  function beginStatusRead() {
    return accountOperationPending ? null : ++statusRevision;
  }
  function accept(status, revision) {
    if (revision === null || revision < acceptedRevision) return;
    acceptedRevision = revision;
    const nextIdentity = JSON.stringify([status.activeId, status.ready]);
    if (identity && identity !== nextIdentity && isSubscriptionSelected()) onAccountChange();
    identity = nextIdentity;
    renderSubscriptionStatus(status);
  }
  async function refresh() {
    if (!isSubscriptionSelected() || refreshing || accountOperationPending) return;
    refreshing = true;
    const revision = beginStatusRead();
    try {
      const status = await readApi('/api/ai/chatgpt/status');
      accept(status, revision);
    } catch {
      if (revision === statusRevision) document.getElementById('xiaomiAiChatGptState').textContent = '无法读取 ChatGPT 登录状态，请稍后重试。';
    }
    finally { refreshing = false; }
  }
  async function operate(operation, body = {}) {
    if (operation === 'logout') {
      if (accountOperationPending || !lastStatus?.available || !lastStatus.loggedIn || !lastStatus.activeId) return;
      body = { profileId: lastStatus.activeId };
    }
    const revision = ++statusRevision;
    // A read already in flight predates this account operation.
    acceptedRevision = revision;
    accountOperationPending = true;
    logoutButton.disabled = true;
    try {
      if (!['cancel', 'logout'].includes(operation) && !(await flushPendingSave())) {
        if (revision === statusRevision) renderSubscriptionStatus();
        return;
      }
      if (revision !== statusRevision) return;
      accept(await readApi(`/api/ai/chatgpt/${operation}`, { method: 'POST', body: JSON.stringify(body) }), revision);
    } catch (error) {
      if (revision !== statusRevision) return;
      // A transport error can arrive after the session changed. Only a fresh status can identify the target.
      renderSubscriptionStatus({ lastError: '无法确认当前 ChatGPT 账号，正在重新读取。' });
      try {
        const status = await readApi('/api/ai/chatgpt/status');
        accept({ ...status, lastError: status.lastError || error.message }, revision);
      } catch {
        if (revision === statusRevision) renderSubscriptionStatus({ lastError: '无法确认当前 ChatGPT 账号，请稍后重试。' });
      }
    } finally {
      if (revision === statusRevision) {
        accountOperationPending = false;
        renderSubscriptionStatus();
      }
    }
  }
  for (const [id, operation, body] of [
    ['xiaomiAiChatGptLogin', 'login', {}], ['xiaomiAiChatGptAdd', 'login', { newAccount: true }],
    ['xiaomiAiChatGptCancel', 'cancel', {}], ['xiaomiAiChatGptLogout', 'logout', {}],
  ]) {
    const button = document.getElementById(id);
    button?.addEventListener('click', async () => {
      button.disabled = true;
      try { await operate(operation, body); }
      finally { button.disabled = false; renderSubscriptionStatus(); }
    });
  }
  document.getElementById('xiaomiAiChatGptProfiles')?.addEventListener('change', event => {
    void operate('select', { profileId: event.target.value });
  });
  return { refresh, beginStatusRead, accept };
}
