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
    auto: ['自动识别', '保留原有设置；首次设置时建议选择你使用的 AI 平台。'],
    deepseek: [
      'DeepSeek 官方',
      '地址会自动填好，可以调整思考强度。',
    ],
    openai: ['OpenAI 官方', '使用 OpenAI 官方服务，地址会自动填好。'],
    anthropic: [
      'Claude 官方兼容',
      '使用 Claude 官方兼容服务，部分功能不可用。',
    ],
    gemini: ['Gemini 官方兼容', '使用 Gemini 官方兼容服务，可以调整思考强度。'],
    custom: ['自定义兼容', '按所用平台的说明填写地址，连接方式不确定时保持自动。'],
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
      hosted: 'AI 平台搜索',
      local_function: 'LIRA 搜索',
      unconfigured: '等待配置',
    }[webSearchMode] || '等待配置',
  );
  setText(
    'xiaomiAiReasoningCapability',
    {
      effort: '可设置强度',
      deepseek_effort: 'DeepSeek 强度',
      gemini_effort: 'Gemini 强度',
      provider_managed: '由平台决定',
      unconfigured: '等待配置',
    }[reasoningMode] || '等待配置',
  );

  if (webSearchMode === 'hosted') {
    setText('xiaomiAiWebSearchLabel', 'AI 平台联网搜索');
    setText(
      'xiaomiAiWebSearchHelp',
      '使用 AI 平台提供的搜索功能，需要所选平台支持。',
    );
  } else if (webSearchMode === 'local_function') {
    setText('xiaomiAiWebSearchLabel', 'LIRA 联网搜索');
    setText('xiaomiAiWebSearchHelp', '由 LIRA 帮助搜索，需要所选模型支持。');
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
    setText('xiaomiAiReasoningLabel', '深度思考');
    setText(
      'xiaomiAiReasoningHelp',
      '可以调整思考强度；选择「服务默认」时，使用平台的默认设置。',
    );
  } else if (reasoningMode === 'deepseek_effort') {
    setText('xiaomiAiReasoningLabel', 'DeepSeek 思考');
    setText(
      'xiaomiAiReasoningHelp',
      '支持「低」「高」「最高」；其他等级会调整为最接近的可用等级。',
    );
  } else if (reasoningMode === 'gemini_effort') {
    setText('xiaomiAiReasoningLabel', 'Gemini 思考');
    setText(
      'xiaomiAiReasoningHelp',
      '支持「最低」到「高」；能否关闭深度思考取决于所选模型。',
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
