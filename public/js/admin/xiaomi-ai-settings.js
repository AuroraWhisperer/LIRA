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
  const providerTestButtons = [
    ['deepseek', document.getElementById('xiaomiAiTestBtn')],
    ['qweather', document.getElementById('xiaomiAiQWeatherTestBtn')],
    ['amap', document.getElementById('xiaomiAiAmapTestBtn')]
  ];
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
  let savingPromise = null;
  let initialLoadPromise = null;
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
    if (!dirty || !configLoaded || !form.checkValidity()) return !dirty;
    if (saving) {
      pendingSave = true;
      await savingPromise;
      return saveConfig();
    }
    saving = true;
    dirty = false;
    const submittedConfig = collectConfig();
    setState(saveState, '正在自动保存…');
    savingPromise = (async () => {
      try {
        const config = await readApi('/api/ai/config', { method: 'PUT', body: JSON.stringify(submittedConfig) });
        renderConfigSummary(config);
        editedFieldIds.clear();
        setState(saveState, '已自动保存，后续新弹幕立即生效。', 'good');
        return true;
      } catch (error) {
        dirty = true;
        setState(saveState, error.message || '保存 AI 配置失败', 'warn');
        return false;
      } finally {
        saving = false;
      }
    })();
    const saved = await savingPromise;
    savingPromise = null;
    if (saved && (pendingSave || dirty)) {
      pendingSave = false;
      return saveConfig();
    }
    return saved;
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

  const flushPendingSave = async () => {
    clearTimeout(autosaveTimer);
    while (savingPromise || saving || dirty || pendingSave) {
      if (savingPromise) {
        if (!await savingPromise) return false;
        await Promise.resolve();
        continue;
      }
      if (dirty || pendingSave) {
        pendingSave = false;
        if (!await saveConfig()) return false;
        continue;
      }
      await Promise.resolve();
    }
    return true;
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

  for (const [provider, button] of providerTestButtons) {
    button.addEventListener('click', () => void runProviderTest(provider, button));
  }

  async function runProviderTest(provider, button) {
    const label = providerLabel(provider);
    button.disabled = true;
    setState(saveState, `正在准备 ${label} 连接测试…`);
    try {
      await initialLoadPromise;
      if (!form.reportValidity()) throw codedClientError('FORM_INVALID', '请先修正表单中的网址或数值。');
      if (!await flushPendingSave()) throw codedClientError('SAVE_FAILED', '配置保存失败，未运行连接测试。');
      setState(saveState, `正在测试 ${label} 连接…`);
      const result = await readApi(`/api/ai/test/${provider}`, { method: 'POST', body: '{}' });
      const detail = result.endpointAdapted
        ? `官方 Host 与密钥可用（测试时临时使用 /chat/completions，配置未修改）`
        : provider === 'deepseek' && result.model ? `模型 ${result.model}` : '地址与密钥均可用';
      setState(saveState, `${label} 连接正常。`, 'good');
      showProviderToast({ provider, good: true, title: `${label} 测试通过`, message: detail });
    } catch (error) {
      const message = providerErrorMessage(provider, error);
      setState(saveState, message, 'warn');
      showProviderToast({ provider, good: false, title: `${label} 测试未通过`, message });
    } finally {
      button.disabled = false;
    }
  }

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

  initialLoadPromise = refreshConfig();
}

async function readApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error || '请求失败');
    error.code = payload.code || `HTTP_${response.status}`;
    throw error;
  }
  return payload.data || {};
}

function collectConfig() {
  const config = {};
  for (const [key, [id, kind]] of Object.entries(FIELD_MAP)) {
    const element = document.getElementById(id);
    if (!element) continue;
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

function providerLabel(provider) {
  return { deepseek: 'DeepSeek', qweather: '和风天气', amap: '高德地图' }[provider] || 'API';
}

function providerErrorMessage(provider, error) {
  const messages = {
    DEEPSEEK_URL_MISSING: '请先填写完整的 Responses API 地址。',
    DEEPSEEK_KEY_MISSING: '请先填写 DeepSeek API Key。',
    DEEPSEEK_AUTH_FAILED: 'DeepSeek 拒绝了该 Key，请检查 Key 是否有效及账户权限。',
    DEEPSEEK_INVALID_RESPONSE: 'DeepSeek 已响应，但没有返回可识别的文本。',
    QWEATHER_HOST_MISSING: '请先填写和风天气专属 API Host。',
    QWEATHER_KEY_MISSING: '请先填写和风天气 API Key。',
    QWEATHER_AUTH_FAILED: '和风天气拒绝了该 Key，请检查 Key 与专属 Host 是否属于同一项目。',
    QWEATHER_INVALID_RESPONSE: '和风天气已响应，但返回格式不正确。',
    QWEATHER_REJECTED: '和风天气返回业务错误，请到控制台检查服务状态。',
    AMAP_HOST_MISSING: '请先填写高德 Web 服务 API Host。',
    AMAP_KEY_MISSING: '请先填写高德 Web 服务 Key。',
    AMAP_AUTH_FAILED: '高德拒绝了该 Key，请确认它是 Web 服务类型并已启用。',
    AMAP_INVALID_RESPONSE: '高德已响应，但没有返回有效的地点数据。',
    AMAP_REJECTED: '高德返回业务错误，请到控制台检查配额和服务状态。',
    UPSTREAM_TIMEOUT: `${providerLabel(provider)}连接超时，请稍后重试。`,
    UPSTREAM_UNAVAILABLE: `无法连接${providerLabel(provider)}，请检查网络或 Host。`,
    UPSTREAM_INVALID_RESPONSE: `${providerLabel(provider)}返回了无法识别的数据。`,
    SAVE_FAILED: '配置保存失败，未运行连接测试。',
    FORM_INVALID: '请先修正表单中的网址或数值。'
  };
  if (['HTTP_404', 'HTTP_405'].includes(error?.code)) {
    return `${providerLabel(provider)}接口地址不正确，请检查 Host 或完整接口路径。`;
  }
  if (['HTTP_401', 'HTTP_403'].includes(error?.code)) {
    return `${providerLabel(provider)}拒绝了该密钥，请检查密钥类型与权限。`;
  }
  return messages[error?.code] || error?.message || `${providerLabel(provider)}连接测试失败。`;
}

function showProviderToast({ provider, good, title, message }) {
  window.AdminApp?.utils?.showStackedToast?.({
    key: `xiaomi-ai-test:${provider}:${good ? 'good' : 'warn'}:${message}`,
    title,
    message,
    className: `xiaomi-ai-test-toast xiaomi-ai-test-toast-${good ? 'good' : 'warn'}`,
    duration: good ? 3600 : 5200
  });
}

function codedClientError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function refresh() {
  return refreshConfig ? refreshConfig() : Promise.resolve();
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.xiaomiAiSettings = { init, refresh };
