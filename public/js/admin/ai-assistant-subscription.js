'use strict';

let lastStatus = null;

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
  document.getElementById('xiaomiAiConfigState').textContent = status?.ready && document.getElementById('xiaomiAiTrigger')?.value
    && document.getElementById('xiaomiAiModel')?.value ? '可运行' : '等待配置';
}

export function createSubscriptionControls({ readApi, flushPendingSave, onAccountChange }) {
  let refreshing = false;
  let identity = '';
  function accept(status) {
    const nextIdentity = JSON.stringify([status.activeId, status.ready]);
    if (identity !== nextIdentity) { identity = nextIdentity; onAccountChange(); }
    renderSubscriptionStatus(status);
  }
  async function refresh() {
    if (!isSubscriptionSelected() || refreshing) return;
    refreshing = true;
    try { accept(await readApi('/api/ai/chatgpt/status')); }
    catch { document.getElementById('xiaomiAiChatGptState').textContent = '无法读取 ChatGPT 登录状态，请稍后重试。'; }
    finally { refreshing = false; }
  }
  async function operate(operation, body = {}) {
    try {
      if (!['cancel', 'logout'].includes(operation) && !(await flushPendingSave())) return;
      accept(await readApi(`/api/ai/chatgpt/${operation}`, { method: 'POST', body: JSON.stringify(body) }));
    } catch (error) {
      renderSubscriptionStatus({ ...lastStatus, lastError: error.message || 'ChatGPT 账号操作失败。' });
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
  return { refresh };
}
