'use strict';

let initialized = false;
let refreshConfig = null;
const AUTOSAVE_DELAY_MS = 700;

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
  const enabledInput = document.getElementById('xiaomiAiEnabled');
  const saveState = document.getElementById('xiaomiAiSaveState');
  const testButton = document.getElementById('xiaomiAiTestBtn');
  const fetchModelsButton = document.getElementById('xiaomiAiFetchModelsBtn');
  const modelInput = document.getElementById('xiaomiAiModel');
  const modelOptions = document.getElementById('xiaomiAiModelOptions');
  const modelMenu = document.getElementById('xiaomiAiModelMenu');
  const modelFetchState = document.getElementById('xiaomiAiModelFetchState');
  let autosaveTimer = null;
  let saving = false;
  let pendingSave = false;
  let dirty = false;
  let configLoaded = false;
  const editedFieldIds = new Set();

  refreshConfig = async () => {
    try {
      const [config, status] = await Promise.all([readApi('/api/ai/config'), readApi('/api/ai/status')]);
      renderConfig(config, editedFieldIds);
      renderStatus(status);
      if (!configLoaded) {
        configLoaded = true;
        if (dirty && form.checkValidity()) {
          clearTimeout(autosaveTimer);
          setState(saveState, '等待自动保存…');
          autosaveTimer = setTimeout(() => void saveConfig(), AUTOSAVE_DELAY_MS);
        }
      }
    } catch (error) {
      setState(saveState, error.message || '无法读取 AI 配置', 'warn');
    }
  };

  const saveConfig = async () => {
    if (!dirty || !configLoaded || !form.checkValidity()) return;
    if (saving) {
      pendingSave = true;
      return;
    }
    saving = true;
    dirty = false;
    const submittedConfig = collectConfig();
    let saved = false;
    setState(saveState, '正在自动保存…');
    try {
      const config = await readApi('/api/ai/config', { method: 'PUT', body: JSON.stringify(submittedConfig) });
      renderConfigSummary(config);
      editedFieldIds.clear();
      setState(saveState, '已自动保存，后续新弹幕立即生效。', 'good');
      saved = true;
    } catch (error) {
      dirty = true;
      setState(saveState, error.message || '保存 AI 配置失败', 'warn');
    } finally {
      saving = false;
      if (saved && (pendingSave || dirty)) {
        pendingSave = false;
        if (form.checkValidity()) void saveConfig();
      }
    }
  };

  const scheduleSave = (immediate = false) => {
    dirty = true;
    clearTimeout(autosaveTimer);
    if (!form.checkValidity()) {
      setState(saveState, '请先完成或修正当前输入，随后会自动保存。', 'warn');
      return;
    }
    setState(saveState, immediate ? '正在自动保存…' : '等待自动保存…');
    if (immediate) void saveConfig();
    else autosaveTimer = setTimeout(() => void saveConfig(), AUTOSAVE_DELAY_MS);
  };

  form.addEventListener('input', (event) => {
    if (event.target.matches('input[type="checkbox"]')) return;
    if (event.target.id) editedFieldIds.add(event.target.id);
    scheduleSave();
  });

  form.addEventListener('change', (event) => {
    if (event.target.matches('input[type="checkbox"], input[type="number"]')) {
      if (event.target.id) editedFieldIds.add(event.target.id);
      scheduleSave(true);
    }
  });

  enabledInput.addEventListener('change', () => {
    editedFieldIds.add(enabledInput.id);
    scheduleSave(true);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    scheduleSave(true);
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

  fetchModelsButton.addEventListener('click', async () => {
    fetchModelsButton.disabled = true;
    fetchModelsButton.textContent = '获取中…';
    setState(modelFetchState, '正在从 DeepSeek 官方获取模型…');
    try {
      const apiKey = document.getElementById('xiaomiAiDeepSeekKey').value.trim();
      const result = await readApi('/api/ai/models', { method: 'POST', body: JSON.stringify({ apiKey }) });
      const models = Array.isArray(result.models) ? result.models : [];
      const options = models.map((model) => {
        const option = document.createElement('option');
        option.value = model;
        return option;
      });
      const menuItems = models.map((model) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'xiaomi-ai-model-option';
        item.setAttribute('role', 'option');
        item.textContent = model;
        item.addEventListener('click', () => {
          modelInput.value = model;
          editedFieldIds.add(modelInput.id);
          closeModelMenu();
          scheduleSave();
        });
        return item;
      });
      modelOptions.replaceChildren(...options);
      modelMenu.replaceChildren(...menuItems);
      setState(modelFetchState, `已获取 ${options.length} 个官方模型；可选择或直接输入。`, options.length ? 'good' : 'warn');
      modelMenu.hidden = menuItems.length === 0;
      modelInput.setAttribute('aria-expanded', String(menuItems.length > 0));
      fetchModelsButton.setAttribute('aria-expanded', String(menuItems.length > 0));
    } catch (error) {
      setState(modelFetchState, error.message || '无法获取 DeepSeek 模型列表。', 'warn');
    } finally {
      fetchModelsButton.disabled = false;
      fetchModelsButton.textContent = '获取模型';
    }
  });

  modelInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModelMenu();
  });

  function closeModelMenu() {
    modelMenu.hidden = true;
    modelInput.setAttribute('aria-expanded', 'false');
    fetchModelsButton.setAttribute('aria-expanded', 'false');
  }

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

function renderConfig(config, preservedFieldIds = new Set()) {
  for (const [key, [id, kind]] of Object.entries(FIELD_MAP)) {
    const element = document.getElementById(id);
    if (!element || config[key] === undefined || preservedFieldIds.has(id)) continue;
    if (kind === 'checked') element.checked = config[key] === true;
    else element.value = String(config[key]);
  }
  renderConfigSummary(config);
}

function renderConfigSummary(config) {
  renderSecretHint('xiaomiAiDeepSeekKeyHint', config.hasDeepSeekApiKey);
  renderSecretHint('xiaomiAiQWeatherKeyHint', config.hasQWeatherApiKey);
  renderSecretHint('xiaomiAiAmapKeyHint', config.hasAmapApiKey);
  document.getElementById('xiaomiAiConfigState').textContent = config.hasDeepSeekApiKey && config.deepseekResponsesUrl ? '可运行' : '等待配置';
  document.getElementById('xiaomiAiModelState').textContent = config.model || 'deepseek-v4-flash';
}

function renderStatus(status) {
  document.getElementById('xiaomiAiQueueState').textContent = String(status.queued || 0);
  if (status.lastError) document.getElementById('xiaomiAiSaveState').textContent = `最近错误：${status.lastError}`;
}

function renderSecretHint(id, saved) {
  const element = document.getElementById(id);
  element.textContent = saved ? '已加密保存；留空表示保留' : '尚未保存';
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
