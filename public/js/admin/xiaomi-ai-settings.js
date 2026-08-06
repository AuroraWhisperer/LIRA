'use strict';

let initialized = false;
let refreshConfig = null;

const FIELD_MAP = Object.freeze({
  enabled: ['xiaomiAiEnabled', 'checked'],
  trigger: ['xiaomiAiTrigger', 'value'],
  deepseekResponsesUrl: ['xiaomiAiDeepSeekUrl', 'value'],
  model: ['xiaomiAiModel', 'value'],
  webSearchEnabled: ['xiaomiAiWebSearch', 'checked'],
  reasoningEnabled: ['xiaomiAiReasoning', 'checked'],
  qweatherApiHost: ['xiaomiAiQWeatherHost', 'value'],
  amapApiHost: ['xiaomiAiAmapHost', 'value'],
  replyMaxChars: ['xiaomiAiReplyMaxChars', 'number'],
  generationConcurrency: ['xiaomiAiConcurrency', 'number'],
  sendIntervalMs: ['xiaomiAiSendInterval', 'number'],
  userCooldownSeconds: ['xiaomiAiUserCooldown', 'number'],
  roomLimitPerMinute: ['xiaomiAiRoomLimit', 'number'],
  systemPrompt: ['xiaomiAiSystemPrompt', 'value']
});

function init() {
  if (initialized) return;
  const form = document.getElementById('xiaomiAiForm');
  if (!form) return;
  initialized = true;
  const toast = window.AdminApp?.utils?.toast || (() => {});
  const saveState = document.getElementById('xiaomiAiSaveState');
  const saveButton = document.getElementById('xiaomiAiSaveBtn');
  const testButton = document.getElementById('xiaomiAiTestBtn');

  refreshConfig = async () => {
    try {
      const [config, status] = await Promise.all([readApi('/api/ai/config'), readApi('/api/ai/status')]);
      renderConfig(config);
      renderStatus(status);
    } catch (error) {
      setState(saveState, error.message || '无法读取 AI 配置', 'warn');
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    saveButton.disabled = true;
    setState(saveState, '正在保存…');
    try {
      const config = await readApi('/api/ai/config', { method: 'PUT', body: JSON.stringify(collectConfig()) });
      clearSecretInputs();
      renderConfig(config);
      setState(saveState, 'AI 配置已保存，后续新弹幕立即生效。', 'good');
      toast('小米 AI 配置已保存');
    } catch (error) {
      setState(saveState, error.message || '保存 AI 配置失败', 'warn');
    } finally {
      saveButton.disabled = false;
    }
  });

  testButton.addEventListener('click', async () => {
    testButton.disabled = true;
    setState(saveState, '正在测试 DeepSeek 连接…');
    try {
      const result = await readApi('/api/ai/test', { method: 'POST', body: '{}' });
      setState(saveState, `连接正常：${result.model || '已配置模型'}`, 'good');
    } catch (error) {
      setState(saveState, error.message || 'DeepSeek 连接测试失败', 'warn');
    } finally {
      testButton.disabled = false;
    }
  });

  void refreshConfig();
}

async function readApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || '请求失败');
  return payload.data || {};
}

function collectConfig() {
  const config = {};
  for (const [key, [id, kind]] of Object.entries(FIELD_MAP)) {
    const element = document.getElementById(id);
    config[key] = kind === 'checked' ? element.checked : (kind === 'number' ? Number(element.value) : element.value.trim());
  }
  config.deepseekApiKey = document.getElementById('xiaomiAiDeepSeekKey').value.trim();
  config.qweatherApiKey = document.getElementById('xiaomiAiQWeatherKey').value.trim();
  config.amapApiKey = document.getElementById('xiaomiAiAmapKey').value.trim();
  return config;
}

function renderConfig(config) {
  for (const [key, [id, kind]] of Object.entries(FIELD_MAP)) {
    const element = document.getElementById(id);
    if (!element || config[key] === undefined) continue;
    if (kind === 'checked') element.checked = config[key] === true;
    else element.value = String(config[key]);
  }
  renderSecretHint('xiaomiAiDeepSeekKeyHint', config.hasDeepSeekApiKey);
  renderSecretHint('xiaomiAiQWeatherKeyHint', config.hasQWeatherApiKey);
  renderSecretHint('xiaomiAiAmapKeyHint', config.hasAmapApiKey);
  document.getElementById('xiaomiAiConfigState').textContent = config.hasDeepSeekApiKey && config.deepseekResponsesUrl ? '可运行' : '等待配置';
  document.getElementById('xiaomiAiModelState').textContent = config.model || 'ds-v4-flash';
}

function renderStatus(status) {
  document.getElementById('xiaomiAiQueueState').textContent = String(status.queued || 0);
  if (status.lastError) document.getElementById('xiaomiAiSaveState').textContent = `最近错误：${status.lastError}`;
}

function renderSecretHint(id, saved) {
  const element = document.getElementById(id);
  element.textContent = saved ? '已加密保存；留空表示保留' : '尚未保存';
}

function clearSecretInputs() {
  for (const id of ['xiaomiAiDeepSeekKey', 'xiaomiAiQWeatherKey', 'xiaomiAiAmapKey']) {
    document.getElementById(id).value = '';
  }
}

function setState(element, text, kind = '') {
  element.textContent = text;
  element.className = `hint${kind ? ` ${kind}` : ''}`;
}

function refresh() {
  return refreshConfig ? refreshConfig() : Promise.resolve();
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.xiaomiAiSettings = { init, refresh };
