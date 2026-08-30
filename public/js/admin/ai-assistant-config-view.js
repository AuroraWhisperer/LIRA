'use strict';

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
  systemPrompt: ['xiaomiAiSystemPrompt', 'value'],
});

export async function readApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body
      ? { 'Content-Type': 'application/json', ...(options.headers || {}) }
      : options.headers,
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error || '请求失败');
    error.code = payload.code || `HTTP_${response.status}`;
    throw error;
  }
  return payload.data || {};
}

export function collectConfig() {
  const config = {};
  for (const [key, [id, kind]] of Object.entries(FIELD_MAP)) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (
      element.disabled &&
      ['deepseekResponsesUrl', 'modelApiProtocol'].includes(key)
    )
      continue;
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

export function renderConfig(config, preservedFieldIds = new Set()) {
  for (const [key, [id, kind, hasKeyField]] of Object.entries(FIELD_MAP)) {
    const element = document.getElementById(id);
    if (!element || preservedFieldIds.has(id)) continue;
    if (kind === 'checked') {
      if (config[key] !== undefined) element.checked = config[key] === true;
    } else if (kind === 'secret') {
      // Never put a mask into the actual input value: users may append to it by
      // accident, and callers such as the model picker could submit the mask.
      element.value = '';
      element.type = 'password';
    } else if (config[key] !== undefined) {
      element.value = String(config[key]);
    }
  }
  renderConfigSummary(config);
}

export function renderConfigSummary(config) {
  renderSecretHint('xiaomiAiDeepSeekKeyHint', config.hasDeepSeekApiKey);
  renderSecretHint('xiaomiAiQWeatherKeyHint', config.hasQWeatherApiKey);
  renderSecretHint('xiaomiAiAmapKeyHint', config.hasAmapApiKey);
  document.getElementById('xiaomiAiConfigState').textContent =
    config.hasDeepSeekApiKey && config.deepseekResponsesUrl && config.trigger
      ? '可运行'
      : '等待配置';
  document.getElementById('xiaomiAiModelState').textContent =
    config.model || '未配置';
  renderProviderSelection(config);
  renderModelCapabilities(config.modelEndpoint);
}

export function renderProviderSelection(value, options = {}) {
  const config = value && typeof value === 'object' ? value : null;
  const provider = String(config?.modelProvider || value || 'auto');
  const official = ['deepseek', 'openai', 'anthropic', 'gemini'].includes(
    provider,
  );
  const endpointLocked = official || options.keepEndpointLocked === true;
  const endpointInput = document.getElementById('xiaomiAiDeepSeekUrl');
  const protocolInput = document.getElementById('xiaomiAiModelApiProtocol');
  const protocolControl = document.getElementById('xiaomiAiProtocolControl');
  if (endpointInput) {
    endpointInput.disabled = endpointLocked;
    if (official && config?.deepseekResponsesUrl)
      endpointInput.value = config.deepseekResponsesUrl;
  }
  if (protocolInput) {
    protocolInput.disabled = endpointLocked;
    if (official && config?.modelApiProtocol)
      protocolInput.value = config.modelApiProtocol;
  }
  if (protocolControl) protocolControl.hidden = official;

  const labels = {
    auto: ['自动识别', '兼容旧配置；新配置建议明确选择供应商。'],
    deepseek: [
      'DeepSeek 官方',
      '使用官方地址和 Chat Completions，支持思考强度。',
    ],
    openai: ['OpenAI 官方', '固定使用 OpenAI 官方 Responses API。'],
    anthropic: [
      'Claude 官方兼容',
      '使用官方 OpenAI 兼容入口；部分原生能力不可用。',
    ],
    gemini: ['Gemini 官方兼容', '使用官方 OpenAI 兼容入口，支持推理强度。'],
    custom: ['自定义兼容', '填写第三方或其他 OpenAI 兼容服务的地址和协议。'],
  };
  const [badge, note] = labels[provider] || labels.auto;
  setText('xiaomiAiProviderBadge', badge);
  setText('xiaomiAiProviderNote', note);
  setText(
    'xiaomiAiEndpointHelp',
    official
      ? '官方预设地址不可编辑；切换到自定义后可修改。'
      : '接受服务根地址、v1 地址或完整接口地址。',
  );
}

function renderModelCapabilities(endpoint = {}) {
  const protocol = endpoint.protocol || 'unconfigured';
  const webSearchMode = endpoint.webSearchMode || 'unconfigured';
  const reasoningMode = endpoint.reasoningMode || 'unconfigured';
  setText(
    'xiaomiAiProtocolCapability',
    {
      responses: 'Responses API',
      chat_completions: 'Chat Completions',
      unconfigured: '等待配置',
    }[protocol] || '等待配置',
  );
  setText(
    'xiaomiAiWebSearchCapability',
    {
      hosted: '服务端托管',
      local_function: 'LIRA 工具调用',
      unconfigured: '等待配置',
    }[webSearchMode] || '等待配置',
  );
  setText(
    'xiaomiAiReasoningCapability',
    {
      effort: '可设置强度',
      deepseek_effort: 'DeepSeek 强度',
      gemini_effort: 'Gemini 强度',
      provider_managed: '供应商管理',
      unconfigured: '等待配置',
    }[reasoningMode] || '等待配置',
  );

  if (webSearchMode === 'hosted') {
    setText('xiaomiAiWebSearchLabel', '服务端联网搜索');
    setText(
      'xiaomiAiWebSearchHelp',
      '由 Responses API 执行，需要上游支持 web_search。',
    );
  } else if (webSearchMode === 'local_function') {
    setText('xiaomiAiWebSearchLabel', 'LIRA 联网搜索');
    setText('xiaomiAiWebSearchHelp', '由 LIRA 执行，需要模型支持 tool_calls。');
  } else {
    setText('xiaomiAiWebSearchLabel', '联网搜索');
    setText('xiaomiAiWebSearchHelp', '保存地址和协议后显示实际联网方式。');
  }

  const reasoningControl = document.getElementById('xiaomiAiReasoningControl');
  const effortControl = document.getElementById(
    'xiaomiAiReasoningEffortControl',
  );
  const providerManaged = document.getElementById(
    'xiaomiAiProviderManagedReasoning',
  );
  const configurableReasoning = [
    'effort',
    'deepseek_effort',
    'gemini_effort',
  ].includes(reasoningMode);
  if (reasoningControl) reasoningControl.hidden = !configurableReasoning;
  if (effortControl) effortControl.hidden = !configurableReasoning;
  if (providerManaged)
    providerManaged.hidden = reasoningMode !== 'provider_managed';
  if (reasoningMode === 'effort') {
    setText('xiaomiAiReasoningLabel', '模型推理');
    setText(
      'xiaomiAiReasoningHelp',
      '可调推理强度；“服务默认”不覆盖上游设置。',
    );
  } else if (reasoningMode === 'deepseek_effort') {
    setText('xiaomiAiReasoningLabel', 'DeepSeek 思考');
    setText(
      'xiaomiAiReasoningHelp',
      '支持 low、high、max；其他档位自动就近映射。',
    );
  } else if (reasoningMode === 'gemini_effort') {
    setText('xiaomiAiReasoningLabel', 'Gemini 思考');
    setText(
      'xiaomiAiReasoningHelp',
      '支持 minimal 到 high；能否关闭取决于模型。',
    );
  }
  syncReasoningEffortAvailability();
}

export function syncReasoningEffortAvailability() {
  const reasoningInput = document.getElementById('xiaomiAiReasoning');
  const effortInput = document.getElementById('xiaomiAiReasoningEffort');
  const effortControl = document.getElementById(
    'xiaomiAiReasoningEffortControl',
  );
  if (effortInput)
    effortInput.disabled =
      Boolean(effortControl?.hidden) || !reasoningInput?.checked;
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

export function renderStatus(status) {
  document.getElementById('xiaomiAiQueueState').textContent = String(
    status.queued || 0,
  );
  if (status.lastError)
    document.getElementById('xiaomiAiSaveState').textContent =
      `最近错误：${status.lastError}`;
}

function renderSecretHint(id, saved) {
  const element = document.getElementById(id);
  element.textContent = saved ? '已加密保存；清空或输入新值以更新' : '尚未保存';
}

export function setState(element, text, kind = '') {
  element.textContent = text;
  element.className = `hint${kind ? ` ${kind}` : ''}`;
}

export function providerLabel(provider) {
  return (
    { deepseek: '模型服务', qweather: '和风天气', amap: '高德地图' }[
      provider
    ] || 'API'
  );
}

export function providerErrorMessage(provider, error) {
  const messages = {
    DEEPSEEK_URL_MISSING: '请填写服务根地址、/v1 基础地址或完整 API 地址。',
    DEEPSEEK_KEY_MISSING: '请先填写当前模型服务的 API Key。',
    DEEPSEEK_AUTH_FAILED:
      '模型服务拒绝了该 Key，请检查 Key 是否有效及账户权限。',
    DEEPSEEK_INVALID_RESPONSE:
      '模型服务已响应，但没有返回可识别的文本（可能是 API 格式不兼容）。',
    QWEATHER_HOST_MISSING: '请先填写和风天气专属 API Host。',
    QWEATHER_KEY_MISSING: '请先填写和风天气 API Key。',
    QWEATHER_AUTH_FAILED:
      '和风天气拒绝了该 Key，请检查 Key 与专属 Host 是否属于同一项目。',
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
    FORM_INVALID: '请先修正表单中的网址或数值。',
  };
  if (['HTTP_404', 'HTTP_405'].includes(error?.code)) {
    return `${providerLabel(provider)}接口地址不正确，请检查服务根地址、/v1 或完整接口路径。`;
  }
  if (['HTTP_401', 'HTTP_403'].includes(error?.code)) {
    return `${providerLabel(provider)}拒绝了该密钥，请检查密钥类型与权限。`;
  }
  return (
    messages[error?.code] ||
    error?.message ||
    `${providerLabel(provider)}连接测试失败。`
  );
}

export function codedClientError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
