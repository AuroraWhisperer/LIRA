'use strict';
import { isSubscriptionSelected, renderSubscriptionStatus } from './ai-assistant-subscription.js';

const FIELD_MAP = Object.freeze({
  enabled: ['xiaomiAiEnabled', 'checked'],
  autoReplyEnabled: ['xiaomiAiAutoReplyEnabled', 'checked'],
  autoReplyProbabilityPercent: ['xiaomiAiAutoReplyProbability', 'number'],
  trigger: ['xiaomiAiTrigger', 'value'],
  modelProvider: ['xiaomiAiModelProvider', 'value'],
  modelAuthMode: ['xiaomiAiModelAuthMode', 'value'],
  deepseekResponsesUrl: ['xiaomiAiDeepSeekUrl', 'value'],
  modelApiProtocol: ['xiaomiAiModelApiProtocol', 'value'],
  deepseekApiKey: ['xiaomiAiDeepSeekKey', 'secret', 'hasDeepSeekApiKey'],
  model: ['xiaomiAiModel', 'value'],
  webSearchEnabled: ['xiaomiAiWebSearch', 'checked'],
  functionCallingEnabled: ['xiaomiAiFunctionCalling', 'checked'],
  reasoningEnabled: ['xiaomiAiReasoning', 'checked'],
  reasoningEffort: ['xiaomiAiReasoningEffort', 'value'],
  qweatherApiHost: ['xiaomiAiQWeatherHost', 'value'],
  qweatherApiKey: ['xiaomiAiQWeatherKey', 'secret', 'hasQWeatherApiKey'],
  amapApiHost: ['xiaomiAiAmapHost', 'value'],
  amapApiKey: ['xiaomiAiAmapKey', 'secret', 'hasAmapApiKey'],
  generationConcurrency: ['xiaomiAiConcurrency', 'number'],
  userCooldownSeconds: ['xiaomiAiUserCooldown', 'number'],
  roomLimitPerMinute: ['xiaomiAiRoomLimit', 'number'],
  contextTtlSeconds: ['xiaomiAiContextMinutes', 'minutes'],
  systemPrompt: ['xiaomiAiSystemPrompt', 'value'],
  personaId: ['xiaomiAiPersona', 'value'],
  weatherEnabled: ['xiaomiAiWeatherEnabled', 'checked'],
  placesEnabled: ['xiaomiAiPlacesEnabled', 'checked'],
  routesEnabled: ['xiaomiAiRoutesEnabled', 'checked'],
});
let doubaoStatus = null;
const secretPlaceholders = new Map();
let modelConfig = {};
let modelCatalog = {};
let selectedReasoningEffort = 'auto';

export async function readApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
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
    if (key === 'reasoningEffort' && (document.getElementById('xiaomiAiReasoningEffortControl')?.hidden || !element.value)) continue;
    if (key === 'systemPrompt' && document.getElementById('xiaomiAiPersona')?.value !== 'custom') continue;
    if (element.disabled && ['deepseekResponsesUrl', 'deepseekApiKey', 'model', 'modelApiProtocol', 'qweatherApiHost', 'qweatherApiKey', 'amapApiHost', 'amapApiKey'].includes(key)) continue;
    if (kind === 'checked') {
      config[key] = element.checked;
    } else if (kind === 'number') {
      config[key] = Number(element.value);
    } else if (kind === 'minutes') {
      config[key] = Math.round(Number(element.value) * 60);
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
  config = { modelAuthMode: 'api', ...config };
  if (!preservedFieldIds.has('xiaomiAiReasoningEffort')) selectedReasoningEffort = config.reasoningEffort || 'auto';
  for (const [key, [id, kind]] of Object.entries(FIELD_MAP)) {
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
      element.value = String(kind === 'minutes' ? config[key] / 60 : config[key]);
    }
  }
  renderConfigSummary(config);
}

export function renderConfigSummary(config, savedConfig = {}) {
  modelConfig = config;
  renderToolSettings();
  for (const [key, [id, kind, savedFlag]] of Object.entries(FIELD_MAP)) {
    if (kind === 'secret') renderSecretHint(id, config[savedFlag], config[`${key}Preview`], Object.hasOwn(savedConfig, key));
  }
  document.getElementById('xiaomiAiConfigState').textContent =
    config.hasDeepSeekApiKey && config.deepseekResponsesUrl && config.trigger ? '可运行' : '等待配置';
  document.getElementById('xiaomiAiModelState').textContent = config.model || '未配置';
  renderProviderSelection(config);
  renderModelSelection();
  if (config.modelProvider === 'doubao') {
    document.getElementById('xiaomiAiModelState').textContent = '豆包';
    renderDoubaoStatus(doubaoStatus);
  }
  renderSubscriptionStatus();
}

export function renderToolSettings() {
  const functionsEnabled = Boolean(document.getElementById('xiaomiAiFunctionCalling')?.checked);
  const localTools = document.getElementById('xiaomiAiLocalTools');
  if (localTools) localTools.hidden = !functionsEnabled;
  const weather = document.getElementById('xiaomiAiWeatherCredentials');
  const map = document.getElementById('xiaomiAiMapCredentials');
  if (weather) weather.hidden = !document.getElementById('xiaomiAiWeatherEnabled')?.checked;
  if (map) map.hidden = !(document.getElementById('xiaomiAiPlacesEnabled')?.checked || document.getElementById('xiaomiAiRoutesEnabled')?.checked);
  for (const [prefix, active] of [['QWeather', functionsEnabled && !weather?.hidden], ['Amap', functionsEnabled && !map?.hidden]]) {
    for (const suffix of ['Host', 'Key']) {
      const input = document.getElementById(`xiaomiAi${prefix}${suffix}`);
      if (input) input.disabled = !active;
    }
  }
}

export function renderProviderSelection(value, options = {}) {
  const config = value && typeof value === 'object' ? value : null;
  const provider = String(config?.modelProvider || value || 'auto');
  const accountMode = provider === 'doubao';
  const official = ['deepseek', 'kimi', 'openai', 'anthropic', 'gemini'].includes(provider);
  const authMode = document.getElementById('xiaomiAiModelAuthMode');
  if (authMode && provider !== 'openai') authMode.value = 'api';
  const authControl = document.getElementById('xiaomiAiAuthModeControl');
  if (authControl) authControl.hidden = provider !== 'openai';
  const subscription = isSubscriptionSelected();
  const endpointLocked = official || accountMode || options.keepEndpointLocked === true;
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
  if (protocolControl) protocolControl.hidden = official || accountMode;
  for (const id of ['xiaomiAiEndpointControl', 'xiaomiAiKeyControl', 'xiaomiAiModelControl', 'xiaomiAiCapabilitiesControl', 'xiaomiAiToolsControl']) {
    const element = document.getElementById(id);
    if (element) element.hidden = accountMode || (subscription && ['xiaomiAiEndpointControl', 'xiaomiAiKeyControl'].includes(id));
  }
  for (const id of ['xiaomiAiDeepSeekKey', 'xiaomiAiModel', 'xiaomiAiFetchModelsBtn']) {
    const element = document.getElementById(id);
    if (element) element.disabled = accountMode || (subscription && id === 'xiaomiAiDeepSeekKey');
  }
  const accountControl = document.getElementById('xiaomiAiDoubaoAccount');
  if (accountControl) accountControl.hidden = !accountMode;

  const labels = {
    auto: ['自动识别', '保留原有设置；首次设置时建议选择你使用的 AI 平台。'],
    deepseek: ['DeepSeek 官方', '地址会自动填好，可以调整思考强度。'],
    kimi: ['Kimi 官方', '使用 Moonshot 开放平台 API，可获取账号可用的 Kimi 模型。'],
    openai: ['OpenAI 官方', '使用 OpenAI 官方服务，地址会自动填好。'],
    anthropic: ['Claude 官方兼容', '使用 Claude 官方兼容服务，部分功能不可用。'],
    gemini: ['Gemini 官方兼容', '使用 Gemini 官方兼容服务，可以调整思考强度。'],
    doubao: ['个人账号·实验性', '使用豆包个人账号文字对话；服务可能要求人工验证，不保证无人值守。'],
    custom: ['自定义兼容', '按所用平台的说明填写地址，连接方式不确定时保持自动。'],
  };
  const [badge, note] = labels[provider] || labels.auto;
  setText('xiaomiAiProviderBadge', badge);
  setText('xiaomiAiProviderNote', note);
  setText(
    'xiaomiAiEndpointHelp',
    official ? '官方预设地址不可编辑；切换到自定义后可修改。' : '可填写服务根地址、v1 地址或完整接口地址。',
  );
  renderProviderAccess(provider, subscription);
  renderSubscriptionStatus();
}

function renderProviderAccess(provider, subscription) {
  const links = {
    deepseek: ['https://platform.deepseek.com/api_keys', '', '使用开放平台 API Key；网页登录不会自动连接 LIRA。'],
    kimi: ['https://platform.moonshot.cn/console/api-keys', 'https://www.kimi.com/en/help/kimi-code/membership-guide', '使用 Moonshot 开放平台密钥。Kimi 会员 / Kimi Code 订阅不用于这里的弹幕自动回复。'],
    openai: ['https://platform.openai.com/api-keys', 'https://learn.chatgpt.com/docs/sign-in-with-chatgpt', '可选择 API 或 ChatGPT 订阅；订阅接入是否可用以官方授权结果为准。'],
    anthropic: ['https://platform.claude.com/settings/keys', 'https://code.claude.com/docs/en/legal-and-compliance', 'Claude 订阅未开放此类应用内授权；这里使用 Claude API Key。'],
    gemini: ['https://aistudio.google.com/apikey', 'https://ai.google.dev/gemini-api/docs/billing', '这里使用 Google AI Studio 的 API Key，按 API 项目权限与额度调用。'],
  };
  const panel = document.getElementById('xiaomiAiProviderAccess');
  if (!panel) return;
  const entry = links[provider];
  panel.hidden = !entry || subscription;
  if (!entry) return;
  setText('xiaomiAiProviderAccessNote', entry[2]);
  document.getElementById('xiaomiAiApiConsole').href = entry[0];
  const info = document.getElementById('xiaomiAiSubscriptionInfo');
  info.hidden = !entry[1];
  info.href = entry[1];
}

export function renderModelCatalog(catalog = {}, { preserveConfig = true } = {}) {
  modelCatalog = catalog;
  if (!preserveConfig && modelConfig.modelEndpoint) {
    modelConfig = { ...modelConfig, modelEndpoint: { ...modelConfig.modelEndpoint } };
    delete modelConfig.modelEndpoint.reasoningEfforts;
    delete modelConfig.modelEndpoint.defaultReasoningEffort;
  }
  renderModelSelection();
}

export function renderModelSelection() {
  const provider = document.getElementById('xiaomiAiModelProvider')?.value || 'auto';
  const authMode = document.getElementById('xiaomiAiModelAuthMode')?.value || 'api';
  const model = document.getElementById('xiaomiAiModel')?.value || '';
  const endpointUrl = document.getElementById('xiaomiAiDeepSeekUrl')?.value.trim() || '';
  const protocol = document.getElementById('xiaomiAiModelApiProtocol')?.value || 'auto';
  const keyInput = document.getElementById('xiaomiAiDeepSeekKey');
  const hasKeyDraft = !keyInput?.disabled && keyInput?.value.trim() && keyInput.value !== '********';
  const sameService = !hasKeyDraft && provider === modelConfig.modelProvider && authMode === (modelConfig.modelAuthMode || 'api')
    && endpointUrl === (modelConfig.deepseekResponsesUrl || '') && protocol === (modelConfig.modelApiProtocol || 'auto');
  const endpoint = sameService ? modelConfig.modelEndpoint || {} : {};
  const reasoning = modelCatalog.models?.includes(model)
    ? modelCatalog.modelReasoning?.[model]
    : sameService && model === modelConfig.model
      ? { efforts: endpoint.reasoningEfforts || [], defaultEffort: endpoint.defaultReasoningEffort }
      : null;
  const effortInput = document.getElementById('xiaomiAiReasoningEffort');
  const efforts = reasoning?.efforts || [];
  if (effortInput) {
    const value = efforts.includes(selectedReasoningEffort) ? selectedReasoningEffort : reasoning?.defaultEffort;
    const options = efforts.map(effort => {
      const option = document.createElement('option');
      option.value = effort;
      option.textContent = effort === reasoning.defaultEffort ? `${effort}（默认）` : effort;
      return option;
    });
    if (efforts.length && !reasoning.defaultEffort) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.disabled = true;
      placeholder.textContent = '请选择强度';
      options.unshift(placeholder);
    }
    effortInput.replaceChildren(...options);
    effortInput.value = value || '';
  }
  renderModelCapabilities(endpoint, efforts);
}

export function selectReasoningEffort() {
  selectedReasoningEffort = document.getElementById('xiaomiAiReasoningEffort')?.value || 'auto';
}

function renderModelCapabilities(endpoint = {}, efforts = []) {
  const hasEfforts = efforts.length > 0;
  const webSearchMode = endpoint.webSearchMode || 'unconfigured';
  const reasoningMode = endpoint.reasoningMode || 'unconfigured';

  if (webSearchMode === 'hosted') {
    setText('xiaomiAiWebSearchLabel', 'AI 平台联网搜索');
    setText('xiaomiAiWebSearchHelp', '使用平台原生搜索，需模型支持。');
  } else if (webSearchMode === 'local_function') {
    setText('xiaomiAiWebSearchLabel', 'LIRA 联网搜索');
    setText('xiaomiAiWebSearchHelp', '需模型支持工具调用，并开启「可选工具 → 允许模型调用工具」。');
  } else {
    setText('xiaomiAiWebSearchLabel', '联网搜索');
    setText('xiaomiAiWebSearchHelp', '保存模型服务后确定搜索方式。');
  }

  const reasoningControl = document.getElementById('xiaomiAiReasoningControl');
  const effortControl = document.getElementById('xiaomiAiReasoningEffortControl');
  const providerManaged = document.getElementById('xiaomiAiProviderManagedReasoning');
  const configurableReasoning = ['effort', 'deepseek_effort', 'gemini_effort', 'kimi_thinking'].includes(reasoningMode);
  if (reasoningControl) reasoningControl.hidden = !configurableReasoning;
  if (effortControl) effortControl.hidden = !configurableReasoning || !hasEfforts;
  if (providerManaged) providerManaged.hidden = reasoningMode !== 'provider_managed' && (configurableReasoning || hasEfforts);
  setText('xiaomiAiProviderManagedReasoning', reasoningMode === 'unconfigured'
    ? '尚未配置模型服务，深度思考设置暂不可用。'
    : '思考由平台和模型自动控制。');
  setText('xiaomiAiReasoningLabel', '深度思考');
  if (reasoningMode === 'effort') {
    setText('xiaomiAiReasoningHelp', hasEfforts ? '强度与默认档按所选模型的官方定义显示。' : '未获取到该模型的官方强度信息，沿用上游设置。');
  } else if (reasoningMode === 'deepseek_effort') {
    setText('xiaomiAiReasoningHelp', '强度与默认档来自 DeepSeek 官方模型目录或官方文档。');
  } else if (reasoningMode === 'gemini_effort') {
    setText('xiaomiAiReasoningHelp', '只显示所选 Gemini 模型官方支持的强度；部分模型始终思考。');
  } else if (reasoningMode === 'kimi_thinking') {
    setText('xiaomiAiReasoningHelp', '按所选 Kimi 模型的官方定义显示；部分模型始终思考。');
  }
  if (isSubscriptionSelected()) setText('xiaomiAiReasoningHelp', hasEfforts
    ? '强度与默认档来自当前账号的官方模型目录；部分模型始终思考。'
    : '请获取当前账号的模型目录；未确认思考强度时沿用上游设置。');
  if (hasEfforts && !efforts.includes('none') && reasoningMode !== 'deepseek_effort') {
    setText('xiaomiAiReasoningHelp', '该模型始终思考；开启时使用所选强度，关闭此选项时使用模型官方支持的最低强度。');
  }
  syncReasoningEffortAvailability();
}

export function syncReasoningEffortAvailability() {
  const reasoningInput = document.getElementById('xiaomiAiReasoning');
  const effortInput = document.getElementById('xiaomiAiReasoningEffort');
  const effortControl = document.getElementById('xiaomiAiReasoningEffortControl');
  if (effortInput) effortInput.disabled = Boolean(effortControl?.hidden) || !reasoningInput?.checked;
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

export function renderStatus(status) {
  document.getElementById('xiaomiAiQueueState').textContent = String(status.queued || 0);
  if (status.lastError) document.getElementById('xiaomiAiSaveState').textContent = `最近错误：${status.lastError}`;
  if (status.doubao) renderDoubaoStatus(status.doubao);
  if (status.chatgpt) renderSubscriptionStatus(status.chatgpt);
}

export function renderDoubaoStatus(status) {
  doubaoStatus = status;
  if (document.getElementById('xiaomiAiModelProvider')?.value !== 'doubao') return;
  let message = '正在读取豆包登录状态…';
  if (status) {
    message = !status.available ? '请从 LIRA 桌面客户端使用豆包账号登录。' :
      status.needsVerification ? '需要人工验证，豆包请求已暂停。' :
        status.loggedIn ? (status.encryptionAvailable ? '已登录豆包。' : '已登录；系统加密不可用，登录仅在本次运行中有效。') : '尚未登录豆包。';
  }
  setText('xiaomiAiDoubaoState', message);
  setText('xiaomiAiDoubaoLogin', status?.needsVerification ? '打开豆包完成验证' : status?.loggedIn ? '打开豆包窗口' : '扫码登录豆包');
  setText('xiaomiAiConfigState', status?.needsVerification ? '等待验证' : status?.loggedIn && document.getElementById('xiaomiAiTrigger')?.value ? '可运行' : '等待配置');
  setText('xiaomiAiModelState', '豆包');
  const logout = document.getElementById('xiaomiAiDoubaoLogout');
  if (logout) logout.hidden = !status?.loggedIn;
}

function renderSecretHint(id, saved, preview, clearValue) {
  const input = document.getElementById(id);
  if (!secretPlaceholders.has(id)) secretPlaceholders.set(id, input.placeholder);
  input.placeholder = saved ? preview || '********' : secretPlaceholders.get(id);
  if (clearValue) input.value = '';
  document.getElementById(`${id}Hint`).textContent = saved ? '已加密保存；输入新密钥可替换，留空保留现有密钥' : '尚未保存';
}

export function setState(element, text, kind = '') {
  element.textContent = text;
  element.className = `hint${kind ? ` ${kind}` : ''}`;
}

export function providerLabel(provider) {
  return { deepseek: '模型服务', qweather: '和风天气', amap: '高德地图' }[provider] || 'API';
}

export function providerErrorMessage(provider, error) {
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
    FORM_INVALID: '请先修正表单中的网址或数值。',
  };
  if (['HTTP_404', 'HTTP_405'].includes(error?.code)) {
    return `${providerLabel(provider)}接口地址不正确，请检查服务根地址、/v1 或完整接口路径。`;
  }
  if (['HTTP_401', 'HTTP_403'].includes(error?.code)) {
    return `${providerLabel(provider)}拒绝了该密钥，请检查密钥类型与权限。`;
  }
  return messages[error?.code] || error?.message || `${providerLabel(provider)}连接测试失败。`;
}

export function codedClientError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
