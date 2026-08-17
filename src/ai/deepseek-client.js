'use strict';

const crypto = require('node:crypto');
const { fetchJson, createPublicError, throwIfAborted } = require('./http-client');
const { resolveModelEndpoint, resolveModelsEndpoint } = require('./model-endpoint');
const { applyModelProviderPreset } = require('./config');

function createDeepSeekClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logEvent = options.logEvent;
  const chatHistory = new Map();

  async function createResponse(request) {
    throwIfAborted(request.signal);
    const config = applyModelProviderPreset(request.config || {});
    if (!config.deepseekResponsesUrl || !config.deepseekApiKey) {
      throw createPublicError('AI_NOT_CONFIGURED', '模型服务尚未配置。');
    }
    const endpoint = resolveModelEndpoint(config.deepseekResponsesUrl, config.modelApiProtocol);
    const responsesBody = {
      model: config.model,
      instructions: request.instructions,
      input: request.input,
      tools: request.tools || [],
      max_output_tokens: Math.max(64, Number(request.maxOutputTokens) || 256)
    };
    if (request.previousResponseId) responsesBody.previous_response_id = request.previousResponseId;
    if (!config.reasoningEnabled) {
      responsesBody.reasoning = { effort: 'none' };
    } else if (config.reasoningEffort && config.reasoningEffort !== 'auto') {
      const reasoningEffort = endpoint.officialDeepSeek
        ? toDeepSeekReasoningEffort(config.reasoningEffort)
        : config.reasoningEffort;
      if (reasoningEffort) responsesBody.reasoning = { effort: reasoningEffort };
    }

    if (endpoint.protocol === 'chat_completions') {
      return createChatResponse(request, config, endpoint);
    }
    return sendModelRequest({
      url: endpoint.url,
      config,
      purpose: request.purpose,
      protocol: 'responses',
      body: responsesBody,
      normalize: normalizeResponse,
      signal: request.signal
    });
  }

  async function createChatResponse(request, config, endpoint) {
    const previousId = String(request.previousResponseId || '');
    const previousMessages = previousId ? chatHistory.get(previousId) : null;
    const instructions = appendChatCapabilityNotice(request.instructions, request.tools);
    const messages = previousMessages
      ? [...previousMessages, ...toChatInputMessages(request.input)]
      : buildInitialChatMessages(instructions, request.input);
    const body = {
      model: config.model,
      messages,
      max_tokens: Math.max(64, Number(request.maxOutputTokens) || 256),
      stream: false
    };
    if (endpoint.officialDeepSeek) {
      body.thinking = { type: config.reasoningEnabled ? 'enabled' : 'disabled' };
      const reasoningEffort = toDeepSeekReasoningEffort(config.reasoningEffort);
      if (config.reasoningEnabled && reasoningEffort) body.reasoning_effort = reasoningEffort;
    } else if (config.modelProvider === 'gemini') {
      const reasoningEffort = toGeminiReasoningEffort(config.reasoningEffort);
      if (!config.reasoningEnabled) body.reasoning_effort = 'none';
      else if (reasoningEffort) body.reasoning_effort = reasoningEffort;
    }
    const tools = toChatTools(request.tools);
    if (tools.length) body.tools = tools;

    const result = await sendModelRequest({
      url: endpoint.url,
      config,
      purpose: request.purpose,
      protocol: 'chat_completions',
      body,
      normalize: normalizeChatResponse,
      signal: request.signal
    });
    const assistantMessage = toAssistantHistoryMessage(result.rawMessage);
    const responseId = result.id || `chat_${crypto.randomUUID()}`;
    if (assistantMessage) rememberChatHistory(responseId, [...messages, assistantMessage]);
    if (previousId) chatHistory.delete(previousId);
    return { ...result, id: responseId, rawMessage: undefined };
  }

  async function sendModelRequest({ url, config, purpose, protocol, body, normalize, signal }) {
    throwIfAborted(signal);
    const requestId = crypto.randomUUID();
    const secrets = [config.deepseekApiKey];
    await safeLog({
      type: 'request', requestId, purpose: purpose || 'model_request',
      provider: 'deepseek', protocol, method: 'POST', url, model: config.model,
      body: sanitizeRequestBodyForLog(body, protocol)
    }, secrets);
    throwIfAborted(signal);
    try {
      const payload = await fetchJson(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.deepseekApiKey}`
        },
        body: JSON.stringify(body),
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
        signal,
        onResponse: (response) => {
          throwIfAborted(signal);
          return safeLog({
            type: 'response', requestId, purpose: purpose || 'model_request',
            provider: 'deepseek', protocol, status: response.status,
            ok: response.ok, rawText: response.text, payload: response.payload
          }, secrets);
        }
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
      await safeLog({
        type: 'normalized_response', requestId, purpose: purpose || 'model_request',
        provider: 'deepseek', protocol, result
      }, secrets);
      return result;
    } catch (error) {
      if (error?.code === 'AI_SHUTDOWN') throw error;
      await safeLog({
        type: 'error', requestId, purpose: purpose || 'model_request',
        provider: 'deepseek', protocol,
        error: {
          name: String(error?.name || 'Error'),
          code: String(error?.code || ''),
          message: String(error?.message || error),
          stack: String(error?.stack || '')
        }
      }, secrets);
      throw error;
    }
  }

  async function safeLog(event, secrets) {
    if (typeof logEvent !== 'function') return;
    try { await logEvent(event, { secrets }); } catch {}
  }

  function rememberChatHistory(id, messages) {
    chatHistory.set(id, messages);
    if (chatHistory.size <= 100) return;
    chatHistory.delete(chatHistory.keys().next().value);
  }

  async function listModels(request = {}) {
    const apiKey = String(request.apiKey || '').trim();
    const providerConfig = applyModelProviderPreset({
      modelProvider: request.modelProvider,
      deepseekResponsesUrl: request.responsesUrl,
      modelApiProtocol: request.modelApiProtocol
    });
    const responsesUrl = String(providerConfig.deepseekResponsesUrl || '').trim();
    if (!responsesUrl) throw createPublicError('DEEPSEEK_URL_MISSING', '请先填写 API 请求地址。');
    if (!apiKey) throw createPublicError('AI_NOT_CONFIGURED', '请先填写当前模型服务的 API Key。');
    const payload = await fetchJson(resolveModelsEndpoint(responsesUrl, providerConfig.modelApiProtocol), {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: request.requestTimeoutMs,
      fetchImpl,
      signal: request.signal
    });
    const models = Array.from(new Set(
      (Array.isArray(payload?.data) ? payload.data : [])
        .map((item) => item?.id)
        .filter((id) => typeof id === 'string' && id.length >= 1 && id.length <= 80)
    )).sort((left, right) => left.localeCompare(right));
    return { models };
  }

  async function testConnection(config = {}, options = {}) {
    config = applyModelProviderPreset(config);
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
        signal: options.signal
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
      provider: 'deepseek',
      model: config.model,
      reply: responseText.slice(0, 200),
      endpointAdapted: testEndpoint.adapted
    };
  }

  return { createResponse, listModels, testConnection };
}

function normalizeChatResponse(payload) {
  const choice = payload?.choices?.[0] || {};
  const message = choice.message || {};
  const finishReason = String(choice.finish_reason || '');
  const functionCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter((call) => call?.type === 'function' && call.function)
    .map((call) => ({
      callId: String(call.id || ''),
      name: String(call.function.name || ''),
      arguments: parseArguments(call.function.arguments, finishReason)
    }));
  const text = typeof message.content === 'string'
    ? message.content
    : (Array.isArray(message.content)
      ? message.content.map((item) => String(item?.text || '')).join('')
      : '');
  return {
    id: String(payload?.id || ''),
    text,
    functionCalls,
    finishReason,
    usage: {
      inputTokens: Number(payload?.usage?.prompt_tokens) || 0,
      outputTokens: Number(payload?.usage?.completion_tokens) || 0
    },
    rawMessage: message
  };
}

function toDeepSeekReasoningEffort(value) {
  const effort = String(value || 'auto').trim().toLowerCase();
  if (effort === 'auto') return '';
  if (effort === 'low' || effort === 'max') return effort;
  if (['minimal', 'medium', 'high', 'xhigh'].includes(effort)) {
    return effort === 'minimal' ? 'low' : 'high';
  }
  return '';
}

function toGeminiReasoningEffort(value) {
  const effort = String(value || 'auto').trim().toLowerCase();
  if (effort === 'auto') return '';
  if (['minimal', 'low', 'medium', 'high'].includes(effort)) return effort;
  if (effort === 'xhigh' || effort === 'max') return 'high';
  return '';
}

function appendChatCapabilityNotice(instructions, tools) {
  const text = String(instructions || '').trim();
  return text;
}

function buildInitialChatMessages(instructions, input) {
  const messages = [];
  if (String(instructions || '').trim()) {
    messages.push({ role: 'system', content: String(instructions).trim() });
  }
  if (typeof input === 'string') messages.push({ role: 'user', content: input });
  else messages.push(...toChatInputMessages(input));
  return messages;
}

function toChatInputMessages(input) {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  return (Array.isArray(input) ? input : []).map((item) => {
    if (item?.type === 'function_call_output') {
      return {
        role: 'tool',
        tool_call_id: String(item.call_id || ''),
        content: String(item.output || '')
      };
    }
    return { role: 'user', content: typeof item === 'string' ? item : JSON.stringify(item) };
  });
}

function toChatTools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => (tool?.type === 'function' && tool.name) || tool?.type === 'web_search')
    .map((tool) => {
      if (tool.type === 'web_search') {
        return {
          type: 'function',
          function: {
            name: 'web_search',
            description: '联网搜索最新网页信息，必须用于美食小吃饮料推荐、特产、菜单价格、新闻、演唱会、车次、航班等时效性问题。',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
              additionalProperties: false
            },
            strict: true
          }
        };
      }
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict
        }
      };
    });
}

function toAssistantHistoryMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const result = { role: 'assistant', content: message.content ?? null };
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    result.tool_calls = message.tool_calls;
  }
  return result;
}

function normalizeResponse(payload) {
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  const functionCalls = [];
  const textParts = [];
  const finishReason = payload?.status === 'incomplete' && payload?.incomplete_details?.reason === 'max_output_tokens'
    ? 'max_output_tokens' : '';
  for (const item of outputs) {
    if (item?.type === 'function_call') {
      functionCalls.push({
        callId: String(item.call_id || item.id || ''),
        name: String(item.name || ''),
        arguments: parseArguments(item.arguments, finishReason)
      });
    }
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'output_text' && content.text) textParts.push(String(content.text));
    }
  }
  const directText = typeof payload?.output_text === 'string' ? payload.output_text : '';
  return {
    id: String(payload?.id || ''),
    text: directText || textParts.join(''),
    functionCalls,
    finishReason,
    usage: {
      inputTokens: Number(payload?.usage?.input_tokens) || 0,
      outputTokens: Number(payload?.usage?.output_tokens) || 0
    }
  };
}

function sanitizeRequestBodyForLog(body, protocol) {
  const result = JSON.parse(JSON.stringify(body || {}));
  delete result.instructions;
  if (protocol === 'chat_completions' && Array.isArray(result.messages)) {
    result.messages = result.messages.map((message) => {
      if (message?.role !== 'system') return message;
      return { ...message, content: '[system prompt omitted]' };
    });
  }
  return result;
}

function parseArguments(value, finishReason = '') {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch {
    if (finishReason === 'length' || finishReason === 'max_output_tokens') {
      throw createPublicError('DEEPSEEK_OUTPUT_TRUNCATED', '模型输出达到长度上限，工具参数不完整。');
    }
    throw createPublicError('INVALID_TOOL_ARGUMENTS', '模型给出了无效的工具参数。');
  }
}

function isAuthenticationError(error) {
  return /(?:^|_)(?:401|403|AUTH|AUTHENTICATION|UNAUTHORIZED|INVALID_API_KEY)(?:$|_)/i
    .test(String(error?.code || ''));
}

module.exports = { createDeepSeekClient, normalizeResponse };
