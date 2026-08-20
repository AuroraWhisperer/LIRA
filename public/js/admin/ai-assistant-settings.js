'use strict';

let initialized = false;
let refreshConfig = null;
const AUTOSAVE_DELAY_MS = 700;

const FIELD_MAP = Object.freeze({
  enabled: ['xiaomiAiEnabled', 'checked'],
  trigger: ['xiaomiAiTrigger', 'value'],
  modelProvider: ['xiaomiAiModelProvider', 'value'],
  deepseekResponsesUrl: ['xiaomiAiDeepSeekUrl', 'value'],
  modelApiProtocol: ['xiaomiAiModelApiProtocol', 'value'],
  deepseekApiKey: ['xiaomiAiDeepSeekKey', 'secret', 'hasDeepSeekApiKey'],
  model: ['xiaomiAiModel', 'value'],
  webSearchEnabled: ['xiaomiAiWebSearch', 'checked'],
  reasoningEnabled: ['xiaomiAiReasoning', 'checked'],
  reasoningEffort: ['xiaomiAiReasoningEffort', 'value'],
  qweatherApiHost: ['xiaomiAiQWeatherHost', 'value'],
  qweatherApiKey: ['xiaomiAiQWeatherKey', 'secret', 'hasQWeatherApiKey'],
  amapApiHost: ['xiaomiAiAmapHost', 'value'],
  amapApiKey: ['xiaomiAiAmapKey', 'secret', 'hasAmapApiKey'],
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
  const modelMenu = document.getElementById('xiaomiAiModelMenu');
  const modelFetchState = document.getElementById('xiaomiAiModelFetchState');
  const providerInput = document.getElementById('xiaomiAiModelProvider');
  const reasoningInput = document.getElementById('xiaomiAiReasoning');
  let autosaveTimer = null;
  let saving = false;
  let pendingSave = false;
  let dirty = false;
  let configLoaded = false;
  let savingPromise = null;
  let initialLoadPromise = null;
  let restoreManualEndpointAfterProviderSave = false;
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
    if (!dirty) return true;
    if (!configLoaded) {
      setState(saveState, '配置尚未加载，暂时无法保存；请等待或刷新页面重试。', 'warn');
      return false;
    }
    if (!form.checkValidity()) return false;
    if (saving) {
      pendingSave = true;
      await savingPromise;
      return saveConfig();
    }
    saving = true;
    dirty = false;
    const submittedConfig = collectConfig();
    setState(saveState, '正在保存…');
    savingPromise = (async () => {
      try {
        const config = await readApi('/api/ai/config', { method: 'PUT', body: JSON.stringify(submittedConfig) });
        if (restoreManualEndpointAfterProviderSave) {
          const endpointInput = document.getElementById('xiaomiAiDeepSeekUrl');
          const protocolInput = document.getElementById('xiaomiAiModelApiProtocol');
          if (endpointInput) endpointInput.value = config.deepseekResponsesUrl || '';
          if (protocolInput) protocolInput.value = config.modelApiProtocol || 'auto';
          restoreManualEndpointAfterProviderSave = false;
        }
        renderConfigSummary(config);
        editedFieldIds.clear();
        setState(saveState, '已保存，后续新弹幕立即生效。', 'good');
        return true;
      } catch (error) {
        dirty = true;
        if (restoreManualEndpointAfterProviderSave) {
          restoreManualEndpointAfterProviderSave = false;
          renderProviderSelection(providerInput?.value);
        }
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
    setState(saveState, immediate ? '正在保存…' : '等待自动保存…');
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

  providerInput?.addEventListener('change', () => {
    const endpointInput = document.getElementById('xiaomiAiDeepSeekUrl');
    const official = ['deepseek', 'openai', 'anthropic', 'gemini'].includes(providerInput.value);
    restoreManualEndpointAfterProviderSave = !official && Boolean(endpointInput?.disabled);
    renderProviderSelection(providerInput.value, {
      keepEndpointLocked: restoreManualEndpointAfterProviderSave
    });
  });

  form.addEventListener('input', (event) => {
    if (event.target.matches('input[type="checkbox"]')) return;
    if (event.target.id) editedFieldIds.add(event.target.id);
    scheduleSave();
  });

  form.addEventListener('change', (event) => {
    if (event.target.matches('input[type="checkbox"], input[type="number"], select')) {
      if (event.target.id) editedFieldIds.add(event.target.id);
      if (event.target === reasoningInput) syncReasoningEffortAvailability();
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
      const detail = provider === 'deepseek' && result.reply
        ? `模型 ${result.model} 回复：${result.reply}`
        : '地址与密钥均可用';
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
    setState(modelFetchState, '正在从当前模型服务获取可用模型…');
    try {
      const apiKey = document.getElementById('xiaomiAiDeepSeekKey').value.trim();
      const apiUrl = document.getElementById('xiaomiAiDeepSeekUrl').value.trim();
      const modelProvider = document.getElementById('xiaomiAiModelProvider')?.value || 'auto';
      const modelApiProtocol = document.getElementById('xiaomiAiModelApiProtocol')?.value || 'auto';
      const result = await readApi('/api/ai/models', {
        method: 'POST',
        body: JSON.stringify({ apiKey, apiUrl, modelProvider, modelApiProtocol })
      });
      const models = Array.isArray(result.models) ? result.models : [];
      const menuItems = models.map((model) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'xiaomi-ai-model-option';
        item.setAttribute('role', 'option');
        item.tabIndex = -1;
        item.setAttribute('aria-selected', String(model === modelInput.value));
        item.textContent = model;
        item.addEventListener('click', () => {
          modelInput.value = model;
          editedFieldIds.add(modelInput.id);
          closeModelMenu();
          scheduleSave();
        });
        return item;
      });
      modelMenu.replaceChildren(...menuItems);
      setState(modelFetchState, `已获取 ${menuItems.length} 个可用模型；可选择或直接输入。`, menuItems.length ? 'good' : 'warn');
      modelMenu.hidden = menuItems.length === 0;
      modelInput.setAttribute('aria-expanded', String(menuItems.length > 0));
      fetchModelsButton.setAttribute('aria-expanded', String(menuItems.length > 0));
    } catch (error) {
      setState(modelFetchState, error.message || '无法获取当前服务的模型列表。', 'warn');
    } finally {
      fetchModelsButton.disabled = false;
      fetchModelsButton.textContent = '获取模型';
    }
  });

  modelInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModelMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !modelMenu.children.length) return;
    event.preventDefault();
    const options = [...modelMenu.querySelectorAll('[role="option"]')];
    const selectedIndex = options.findIndex(item => item.getAttribute('aria-selected') === 'true');
    const nextIndex = modelMenu.hidden
      ? (event.key === 'ArrowUp' ? options.length - 1 : (selectedIndex < 0 ? 0 : selectedIndex))
      : event.key === 'ArrowUp'
        ? Math.max(0, selectedIndex < 0 ? options.length - 1 : selectedIndex - 1)
        : Math.min(options.length - 1, selectedIndex < 0 ? 0 : selectedIndex + 1);
    openModelMenu();
    focusModelOption(options[nextIndex]);
  });

  if (typeof modelMenu?.addEventListener === 'function') modelMenu.addEventListener('keydown', (event) => {
    const options = [...modelMenu.querySelectorAll('[role="option"]')];
    const currentIndex = options.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? options.length - 1
          : event.key === 'ArrowUp' ? Math.max(0, currentIndex - 1)
            : Math.min(options.length - 1, currentIndex + 1);
      focusModelOption(options[nextIndex]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      options[currentIndex >= 0 ? currentIndex : 0]?.click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeModelMenu();
      modelInput.focus();
    } else if (event.key === 'Tab') {
      closeModelMenu();
    }
  });

  if (typeof document?.addEventListener === 'function') {
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.xiaomi-ai-model-picker')) closeModelMenu();
    });
  }

  function openModelMenu() {
    if (!modelMenu.children.length) return;
    modelMenu.hidden = false;
    modelInput.setAttribute('aria-expanded', 'true');
    fetchModelsButton.setAttribute('aria-expanded', 'true');
  }

  function focusModelOption(option) {
    if (!option) return;
    option.focus({ preventScroll: true });
    option.scrollIntoView?.({ block: 'nearest' });
  }

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
    if (element.disabled && ['deepseekResponsesUrl', 'modelApiProtocol'].includes(key)) continue;
    if (kind === 'checked') {
      config[key] = element.checked;
    } else if (kind === 'number') {
      config[key] = Number(element.value);
    } else {
      const value = element.value.trim();
      if (value !== '********' && (value || kind !== 'secret')) {
        config[key] = value;
      }
    }
  }
  return config;
}

function renderConfig(config, preservedFieldIds = new Set()) {
  for (const [key, [id, kind, hasKeyField]] of Object.entries(FIELD_MAP)) {
    const element = document.getElementById(id);
    if (!element || preservedFieldIds.has(id)) continue;
    if (kind === 'checked') {
      if (config[key] !== undefined) element.checked = config[key] === true;
    } else if (kind === 'secret') {
      element.value = config[hasKeyField] === true ? '********' : '';
      element.type = 'password';
    } else if (config[key] !== undefined) {
      element.value = String(config[key]);
    }
  }
  renderConfigSummary(config);
}

function renderConfigSummary(config) {
  renderSecretHint('xiaomiAiDeepSeekKeyHint', config.hasDeepSeekApiKey);
  renderSecretHint('xiaomiAiQWeatherKeyHint', config.hasQWeatherApiKey);
  renderSecretHint('xiaomiAiAmapKeyHint', config.hasAmapApiKey);
  document.getElementById('xiaomiAiConfigState').textContent = config.hasDeepSeekApiKey && config.deepseekResponsesUrl && config.trigger ? '可运行' : '等待配置';
  document.getElementById('xiaomiAiModelState').textContent = config.model || '未配置';
  renderProviderSelection(config);
  renderModelCapabilities(config.modelEndpoint);
}

function renderProviderSelection(value, options = {}) {
  const config = value && typeof value === 'object' ? value : null;
  const provider = String(config?.modelProvider || value || 'auto');
  const official = ['deepseek', 'openai', 'anthropic', 'gemini'].includes(provider);
  const endpointLocked = official || options.keepEndpointLocked === true;
  const endpointInput = document.getElementById('xiaomiAiDeepSeekUrl');
  const protocolInput = document.getElementById('xiaomiAiModelApiProtocol');
  const protocolControl = document.getElementById('xiaomiAiProtocolControl');
  if (endpointInput) {
    endpointInput.disabled = endpointLocked;
    if (official && config?.deepseekResponsesUrl) endpointInput.value = config.deepseekResponsesUrl;
  }
  if (protocolInput) {
    protocolInput.disabled = endpointLocked;
    if (official && config?.modelApiProtocol) protocolInput.value = config.modelApiProtocol;
  }
  if (protocolControl) protocolControl.hidden = official;

  const labels = {
    auto: ['自动识别', '保留旧配置的地址识别规则；新配置建议明确选择供应商。'],
    deepseek: ['DeepSeek 官方', '固定使用 DeepSeek 官方地址和 Chat Completions，支持思考强度。'],
    openai: ['OpenAI 官方', '固定使用 OpenAI 官方 Responses API。'],
    anthropic: ['Claude 官方兼容', '使用 Anthropic 官方 OpenAI 兼容入口；部分 Claude 原生能力不可用。'],
    gemini: ['Gemini 官方兼容', '使用 Google 官方 OpenAI 兼容入口，支持模型相关的推理强度。'],
    custom: ['自定义兼容', '填写第三方或其他 OpenAI 兼容服务的地址和协议。']
  };
  const [badge, note] = labels[provider] || labels.auto;
  setText('xiaomiAiProviderBadge', badge);
  setText('xiaomiAiProviderNote', note);
  setText('xiaomiAiEndpointHelp', official
    ? '官方预设地址由 LIRA 固定，切换到自定义供应商后可编辑。'
    : '可填写服务根地址、/v1 基础地址，或完整的 /responses、/chat/completions 地址。');
}

function renderModelCapabilities(endpoint = {}) {
  const protocol = endpoint.protocol || 'unconfigured';
  const webSearchMode = endpoint.webSearchMode || 'unconfigured';
  const reasoningMode = endpoint.reasoningMode || 'unconfigured';
  setText('xiaomiAiProtocolCapability', {
    responses: 'Responses API',
    chat_completions: 'Chat Completions',
    unconfigured: '等待配置'
  }[protocol] || '等待配置');
  setText('xiaomiAiWebSearchCapability', {
    hosted: '服务端托管',
    local_function: 'LIRA 工具调用',
    unconfigured: '等待配置'
  }[webSearchMode] || '等待配置');
  setText('xiaomiAiReasoningCapability', {
    effort: '可设置强度',
    deepseek_effort: 'DeepSeek 强度',
    gemini_effort: 'Gemini 强度',
    provider_managed: '供应商管理',
    unconfigured: '等待配置'
  }[reasoningMode] || '等待配置');

  if (webSearchMode === 'hosted') {
    setText('xiaomiAiWebSearchLabel', '启用服务端 Web Search');
    setText('xiaomiAiWebSearchHelp', '由 Responses API 服务执行，需要上游支持 web_search。');
  } else if (webSearchMode === 'local_function') {
    setText('xiaomiAiWebSearchLabel', '启用 LIRA Web Search');
    setText('xiaomiAiWebSearchHelp', 'LIRA 执行搜索，当前模型必须支持 Chat Completions tool_calls。');
  } else {
    setText('xiaomiAiWebSearchLabel', '启用 Web Search');
    setText('xiaomiAiWebSearchHelp', '保存模型服务地址和协议后显示实际联网方式。');
  }

  const reasoningControl = document.getElementById('xiaomiAiReasoningControl');
  const effortControl = document.getElementById('xiaomiAiReasoningEffortControl');
  const providerManaged = document.getElementById('xiaomiAiProviderManagedReasoning');
  const configurableReasoning = ['effort', 'deepseek_effort', 'gemini_effort'].includes(reasoningMode);
  if (reasoningControl) reasoningControl.hidden = !configurableReasoning;
  if (effortControl) effortControl.hidden = !configurableReasoning;
  if (providerManaged) providerManaged.hidden = reasoningMode !== 'provider_managed';
  if (reasoningMode === 'effort') {
    setText('xiaomiAiReasoningLabel', '启用模型推理');
    setText('xiaomiAiReasoningHelp', 'Responses API 可按强度控制；“服务默认”不覆盖上游设置。');
  } else if (reasoningMode === 'deepseek_effort') {
    setText('xiaomiAiReasoningLabel', '启用 DeepSeek 思考');
    setText('xiaomiAiReasoningHelp', 'DeepSeek 官方支持 low、high、max；其他档位会映射到最接近的官方强度。');
  } else if (reasoningMode === 'gemini_effort') {
    setText('xiaomiAiReasoningLabel', '启用 Gemini 思考');
    setText('xiaomiAiReasoningHelp', 'Gemini 支持 minimal 到 high；能否关闭思考取决于所选模型。');
  }
  syncReasoningEffortAvailability();
}

function syncReasoningEffortAvailability() {
  const reasoningInput = document.getElementById('xiaomiAiReasoning');
  const effortInput = document.getElementById('xiaomiAiReasoningEffort');
  const effortControl = document.getElementById('xiaomiAiReasoningEffortControl');
  if (effortInput) effortInput.disabled = Boolean(effortControl?.hidden) || !reasoningInput?.checked;
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function renderStatus(status) {
  document.getElementById('xiaomiAiQueueState').textContent = String(status.queued || 0);
  if (status.lastError) document.getElementById('xiaomiAiSaveState').textContent = `最近错误：${status.lastError}`;
}

function renderSecretHint(id, saved) {
  const element = document.getElementById(id);
  element.textContent = saved ? '已加密保存；清空或输入新值以更新' : '尚未保存';
}

function setState(element, text, kind = '') {
  element.textContent = text;
  element.className = `hint${kind ? ` ${kind}` : ''}`;
}

function providerLabel(provider) {
  return { deepseek: '模型服务', qweather: '和风天气', amap: '高德地图' }[provider] || 'API';
}

function providerErrorMessage(provider, error) {
  const messages = {
    DEEPSEEK_URL_MISSING: '请填写服务根地址、/v1 基础地址或完整 API 地址。',
    DEEPSEEK_KEY_MISSING: '请先填写当前模型服务的 API Key。',
    DEEPSEEK_AUTH_FAILED: '模型服务拒绝了该 Key，请检查 Key 是否有效及账户权限。',
    DEEPSEEK_INVALID_RESPONSE: '模型服务已响应，但没有返回可识别的文本（可能是 API 格式不兼容）。',
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
    return `${providerLabel(provider)}接口地址不正确，请检查服务根地址、/v1 或完整接口路径。`;
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
window.AdminApp.aiAssistantSettings = { init, refresh };
