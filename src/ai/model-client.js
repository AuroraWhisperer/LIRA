'use strict';

const crypto = require('node:crypto');
const { addAbortListener } = require('node:events');
const { fetchJson, createPublicError, throwIfAborted } = require('./http-client');
const { describeModelEndpoint, resolveModelEndpoint, resolveModelsEndpoint } = require('./model-endpoint');
const { applyModelProviderPreset, usesSubscription } = require('./config');
const { getModelReasoning } = require('./model-reasoning');
const { createDoubaoClient } = require('./doubao-client');
const { buildResponsesBody, buildChatBody, normalizeResponse, normalizeChatResponse,
  toAssistantHistoryMessage } = require('./model-protocol');

function createModelClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logEvent = options.logEvent;
  const chatHistory = new Map();
  const modelCatalogs = new Map();
  const doubao = options.doubao || createDoubaoClient();
  const chatgpt = options.chatgpt;

  async function createResponse(request) {
    throwIfAborted(request.signal);
    const config = applyModelProviderPreset(request.config || {});
    if (config.modelProvider === 'doubao') return doubao.createResponse(request);
    if (usesSubscription(config)) {
      if (!chatgpt) throw createPublicError('CHATGPT_UNAVAILABLE', '请从 LIRA 桌面客户端连接 ChatGPT 订阅。');
      return chatgpt.createResponse(request);
    }
    if (!config.deepseekResponsesUrl || !config.deepseekApiKey) {
      throw createPublicError('AI_NOT_CONFIGURED', '模型服务尚未配置。');
    }
    config.modelReasoning = getReasoningProfile(config);
    const endpoint = resolveModelEndpoint(config.deepseekResponsesUrl, config.modelApiProtocol);
    if (endpoint.protocol === 'chat_completions') {
      return createChatResponse(request, config, endpoint);
    }
    return sendModelRequest({
      url: endpoint.url,
      config,
      purpose: request.purpose,
      protocol: 'responses',
      body: buildResponsesBody(request, config, endpoint),
      normalize: normalizeResponse,
      signal: request.signal,
    });
  }

  async function createChatResponse(request, config, endpoint) {
    const credential = hashApiKey(config.deepseekApiKey);
    const historyKey = id => JSON.stringify([endpoint.url, config.model, credential, String(id)]);
    const previousKey = request.previousResponseId && historyKey(request.previousResponseId);
    const previous = chatHistory.get(previousKey);
    const body = buildChatBody(request, config, endpoint, previous?.messages);
    const thinkingWithTools = endpoint.officialDeepSeek && body.thinking?.type === 'enabled' && Boolean(body.tools);
    // A DeepSeek tool chain belongs to this generation, including when its follow-up fails.
    if (previous?.thinkingWithTools) forgetChatHistory(previousKey);

    const { rawMessage, ...result } = await sendModelRequest({
      url: endpoint.url,
      config,
      purpose: request.purpose,
      protocol: 'chat_completions',
      body,
      normalize: normalizeChatResponse,
      signal: request.signal,
    });
    if (previous && !previous.thinkingWithTools) forgetChatHistory(previousKey);
    const id = result.id || `chat_${crypto.randomUUID()}`;
    const thinkingToolChain = thinkingWithTools || previous?.thinkingWithTools;
    if (!thinkingToolChain || result.functionCalls.length) {
      const assistant = toAssistantHistoryMessage(rawMessage, thinkingWithTools || config.modelProvider === 'kimi');
      if (assistant) {
        rememberChatHistory(historyKey(id), { messages: [...body.messages, assistant], thinkingWithTools }, request.signal);
      }
    }
    return { ...result, id };
  }

  async function sendModelRequest({ url, config, purpose, protocol, body, normalize, signal }) {
    throwIfAborted(signal);
    const requestId = crypto.randomUUID();
    const secrets = [config.deepseekApiKey];
    const provider = describeModelEndpoint(
      config.deepseekResponsesUrl,
      config.modelApiProtocol,
      config.modelProvider,
    ).provider;
    const startedAt = Date.now();
    let responseStatus = 0;
    throwIfAborted(signal);
    try {
      const payload = await fetchJson(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.deepseekApiKey}`,
        },
        body: JSON.stringify(body),
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
        signal,
        onResponse: (response) => {
          throwIfAborted(signal);
          responseStatus = response.status;
        },
      });
      throwIfAborted(signal);
      const result = normalize(payload);
      if (!result.text && !result.functionCalls.length) {
        if (result.finishReason === 'length' || result.finishReason === 'max_output_tokens') {
          throw createPublicError('DEEPSEEK_OUTPUT_TRUNCATED', '模型输出达到长度上限，未生成完整回复。');
        }
        throw createPublicError('DEEPSEEK_INVALID_RESPONSE', '模型服务返回了空响应。');
      }
      throwIfAborted(signal);
      await safeLog(
        {
          type: 'request_succeeded',
          requestId,
          purpose: purpose || 'model_request',
          provider,
          model: config.model,
          protocol,
          status: responseStatus,
          durationMs: Math.max(0, Date.now() - startedAt),
          inputTokens: Number(result.usage?.inputTokens) || 0,
          outputTokens: Number(result.usage?.outputTokens) || 0,
          functionCallCount: Array.isArray(result.functionCalls) ? result.functionCalls.length : 0,
          finishReason: String(result.finishReason || ''),
        },
        secrets,
      );
      return result;
    } catch (error) {
      if (error?.code === 'AI_SHUTDOWN' || error?.code === 'AI_DISABLED') throw error;
      await safeLog(
        {
          type: 'request_failed',
          requestId,
          purpose: purpose || 'model_request',
          provider,
          model: config.model,
          protocol,
          status: responseStatus,
          durationMs: Math.max(0, Date.now() - startedAt),
          error: {
            name: String(error?.name || 'Error'),
            code: String(error?.code || ''),
            message: String(error?.message || error),
            stack: String(error?.stack || ''),
          },
        },
        secrets,
      );
      throw error;
    }
  }

  async function safeLog(event, secrets) {
    if (typeof logEvent !== 'function') return;
    try {
      await logEvent(event, { secrets });
    } catch {}
  }

  function forgetChatHistory(key) {
    chatHistory.get(key)?.abortListener?.[Symbol.dispose]();
    chatHistory.delete(key);
  }

  function rememberChatHistory(key, history, signal) {
    forgetChatHistory(key);
    if (history.thinkingWithTools && signal) {
      if (signal.aborted) return;
      history.abortListener = addAbortListener(signal, () => forgetChatHistory(key));
    }
    chatHistory.set(key, history);
    if (chatHistory.size > 100) forgetChatHistory(chatHistory.keys().next().value);
  }

  function modelCatalogKey(config) {
    return JSON.stringify([config.modelProvider || 'auto',
      resolveModelsEndpoint(config.deepseekResponsesUrl, config.modelApiProtocol),
      hashApiKey(config.deepseekApiKey)]);
  }

  function getReasoningProfile(input) {
    const config = applyModelProviderPreset(input);
    if (usesSubscription(config)) return chatgpt?.getModelReasoning?.(config) || getModelReasoning(config);
    const catalog = config.deepseekResponsesUrl && config.deepseekApiKey
      ? modelCatalogs.get(modelCatalogKey(config)) : null;
    return catalog && Object.hasOwn(catalog, config.model) ? catalog[config.model] : getModelReasoning(config);
  }

  async function listModels(request = {}) {
    if (request.modelProvider === 'doubao') return { models: ['doubao'] };
    if (usesSubscription(request)) {
      if (!chatgpt) throw createPublicError('CHATGPT_UNAVAILABLE', '请从 LIRA 桌面客户端连接 ChatGPT 订阅。');
      return chatgpt.listModels(request);
    }
    const apiKey = String(request.apiKey || '').trim();
    const providerConfig = applyModelProviderPreset({
      modelProvider: request.modelProvider,
      deepseekResponsesUrl: request.responsesUrl,
      modelApiProtocol: request.modelApiProtocol,
    });
    const responsesUrl = String(providerConfig.deepseekResponsesUrl || '').trim();
    if (!responsesUrl) throw createPublicError('DEEPSEEK_URL_MISSING', '请先填写 API 请求地址。');
    if (!apiKey) throw createPublicError('AI_NOT_CONFIGURED', '请先填写当前模型服务的 API Key。');
    const payload = await fetchJson(resolveModelsEndpoint(responsesUrl, providerConfig.modelApiProtocol), {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: request.requestTimeoutMs,
      fetchImpl,
      signal: request.signal,
    });
    const catalog = (Array.isArray(payload?.data) ? payload.data : [])
      .filter(item => typeof item?.id === 'string' && item.id.length >= 1 && item.id.length <= 80);
    const models = [...new Set(catalog.map(item => item.id))].sort((left, right) => left.localeCompare(right));
    const modelNames = Object.fromEntries(catalog
      .map(item => [item.id, item.display_name || item.name])
      .filter(([, name]) => typeof name === 'string' && name.trim()));
    const modelReasoning = Object.fromEntries(catalog
      .map(item => [item.id, getModelReasoning({ ...providerConfig, model: item.id }, item)])
      .filter(([, profile]) => profile));
    modelCatalogs.set(modelCatalogKey({ ...providerConfig, deepseekApiKey: apiKey }), modelReasoning);
    if (modelCatalogs.size > 20) modelCatalogs.delete(modelCatalogs.keys().next().value);
    return { models, ...(Object.keys(modelNames).length ? { modelNames } : {}),
      ...(Object.keys(modelReasoning).length ? { modelReasoning } : {}) };
  }

  async function testConnection(config = {}, options = {}) {
    config = applyModelProviderPreset(config);
    if (config.modelProvider === 'doubao') return doubao.testConnection(config, options);
    if (usesSubscription(config)) {
      const response = await createResponse({ config, input: '请简短回复：连接成功。', tools: [], signal: options.signal, purpose: 'connection_test' });
      return { provider: 'openai', model: config.model, reply: response.text.slice(0, 200), endpointAdapted: false };
    }
    if (!config.deepseekResponsesUrl) {
      throw createPublicError('DEEPSEEK_URL_MISSING', '请先填写模型服务 API 地址。');
    }
    if (!config.deepseekApiKey) {
      throw createPublicError('DEEPSEEK_KEY_MISSING', '请先填写当前模型服务的 API Key。');
    }
    let responseText;
    const testEndpoint = resolveModelEndpoint(config.deepseekResponsesUrl, config.modelApiProtocol);
    try {
      const response = await createResponse({
        config,
        instructions: testEndpoint.protocol === 'chat_completions' ? '' : '请简短回复用户。',
        input: '你好',
        tools: [],
        maxOutputTokens: 128,
        purpose: 'connection_test',
        signal: options.signal,
      });
      responseText = response.text;
    } catch (error) {
      if (isAuthenticationError(error)) {
        throw createPublicError('DEEPSEEK_AUTH_FAILED', '模型服务拒绝了该 API Key。');
      }
      throw error;
    }
    responseText = String(responseText || '').trim();
    if (!responseText) {
      throw createPublicError('DEEPSEEK_INVALID_RESPONSE', '模型服务返回了空响应。');
    }
    return {
      provider: describeModelEndpoint(config.deepseekResponsesUrl, config.modelApiProtocol, config.modelProvider).provider,
      model: config.model,
      reply: responseText.slice(0, 200),
      endpointAdapted: testEndpoint.adapted,
    };
  }

  return {
    createResponse, listModels, testConnection,
    getModelReasoning: getReasoningProfile,
    getAccountStatus: () => doubao.getStatus(),
    getSubscriptionStatus: () => chatgpt?.getStatus(),
    getSessionRevision: (config) => usesSubscription(config) ? chatgpt?.getSessionRevision() : doubao.getSessionRevision(),
    isReady(config) {
      if (usesSubscription(config)) return chatgpt?.getStatus().ready === true;
      if (config.modelProvider !== 'doubao') return true;
      const status = doubao.getStatus();
      return status.available && status.loggedIn && !status.needsVerification;
    },
  };
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function isAuthenticationError(error) {
  return /(?:^|_)(?:401|403|AUTH|AUTHENTICATION|UNAUTHORIZED|INVALID_API_KEY)(?:$|_)/i.test(String(error?.code || ''));
}

module.exports = { createModelClient };
