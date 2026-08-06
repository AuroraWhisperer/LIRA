'use strict';

const crypto = require('node:crypto');
const { fetchJson, createPublicError } = require('./http-client');

const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models';

function createDeepSeekClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logEvent = options.logEvent;
  const chatHistory = new Map();

  async function createResponse(request) {
    const config = request.config || {};
    if (!config.deepseekResponsesUrl || !config.deepseekApiKey) {
      throw createPublicError('AI_NOT_CONFIGURED', 'DeepSeek API 尚未配置。');
    }
    const responsesBody = {
      model: config.model,
      instructions: request.instructions,
      input: request.input,
      tools: request.tools || [],
      max_output_tokens: Math.max(64, Number(request.maxOutputTokens) || 256)
    };
    if (request.previousResponseId) responsesBody.previous_response_id = request.previousResponseId;
    if (!config.reasoningEnabled) responsesBody.reasoning = { effort: 'none' };

    const officialEndpoint = resolveOfficialChatEndpoint(config.deepseekResponsesUrl);
    if (officialEndpoint.adapted) {
      return createChatResponse(request, config, officialEndpoint.url);
    }
    return sendModelRequest({
      url: config.deepseekResponsesUrl,
      config,
      purpose: request.purpose,
      protocol: 'responses',
      body: responsesBody,
      normalize: normalizeResponse
    });
  }

  async function createChatResponse(request, config, url) {
    const previousId = String(request.previousResponseId || '');
    const previousMessages = previousId ? chatHistory.get(previousId) : null;
    const messages = previousMessages
      ? [...previousMessages, ...toChatInputMessages(request.input)]
      : buildInitialChatMessages(request.instructions, request.input);
    const body = {
      model: config.model,
      messages,
      max_tokens: Math.max(64, Number(request.maxOutputTokens) || 256),
      stream: false
    };
    const tools = toChatTools(request.tools);
    if (tools.length) body.tools = tools;

    const result = await sendModelRequest({
      url,
      config,
      purpose: request.purpose,
      protocol: 'chat_completions',
      body,
      normalize: normalizeChatResponse
    });
    const assistantMessage = toAssistantHistoryMessage(result.rawMessage);
    const responseId = result.id || `chat_${crypto.randomUUID()}`;
    if (assistantMessage) rememberChatHistory(responseId, [...messages, assistantMessage]);
    if (previousId) chatHistory.delete(previousId);
    return { ...result, id: responseId, rawMessage: undefined };
  }

  async function sendModelRequest({ url, config, purpose, protocol, body, normalize }) {
    const requestId = crypto.randomUUID();
    const secrets = [config.deepseekApiKey];
    await safeLog({
      type: 'request', requestId, purpose: purpose || 'model_request',
      provider: 'deepseek', protocol, method: 'POST', url, model: config.model, body
    }, secrets);
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
        onResponse: (response) => safeLog({
          type: 'response', requestId, purpose: purpose || 'model_request',
          provider: 'deepseek', protocol, status: response.status,
          ok: response.ok, rawText: response.text, payload: response.payload
        }, secrets)
      });
      const result = normalize(payload);
      if (!result.text && !result.functionCalls.length) {
        throw createPublicError('DEEPSEEK_INVALID_RESPONSE', 'DeepSeek 返回了空响应。');
      }
      await safeLog({
        type: 'normalized_response', requestId, purpose: purpose || 'model_request',
        provider: 'deepseek', protocol, result
      }, secrets);
      return result;
    } catch (error) {
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
    if (!apiKey) throw createPublicError('AI_NOT_CONFIGURED', '请先填写 DeepSeek API Key。');
    const payload = await fetchJson(DEEPSEEK_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: request.requestTimeoutMs,
      fetchImpl
    });
    const models = Array.from(new Set(
      (Array.isArray(payload?.data) ? payload.data : [])
        .map((item) => item?.id)
        .filter((id) => typeof id === 'string' && id.length >= 1 && id.length <= 80)
    )).sort((left, right) => left.localeCompare(right));
    return { models };
  }

  async function testConnection(config = {}) {
    if (!config.deepseekResponsesUrl) {
      throw createPublicError('DEEPSEEK_URL_MISSING', '请先填写 Responses API 地址。');
    }
    if (!config.deepseekApiKey) {
      throw createPublicError('DEEPSEEK_KEY_MISSING', '请先填写 DeepSeek API Key。');
    }
    let responseText;
    const testEndpoint = resolveOfficialChatEndpoint(config.deepseekResponsesUrl);
    try {
      const response = await createResponse({
        config,
        instructions: testEndpoint.adapted ? '' : '请简短回复用户。',
        input: '你好',
        tools: [],
        maxOutputTokens: 128,
        purpose: 'connection_test'
      });
      responseText = response.text;
    } catch (error) {
      if (isAuthenticationError(error)) {
        throw createPublicError('DEEPSEEK_AUTH_FAILED', 'DeepSeek 拒绝了该 API Key。');
      }
      throw error;
    }
    responseText = String(responseText || '').trim();
    if (!responseText) {
      throw createPublicError('DEEPSEEK_INVALID_RESPONSE', 'DeepSeek 返回了空响应。');
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

function resolveOfficialChatEndpoint(value) {
  const url = new URL(value);
  const officialHost = url.protocol === 'https:' && url.hostname === 'api.deepseek.com' && !url.port;
  const path = url.pathname.replace(/\/+$/, '');
  const chatPaths = ['/chat/completions', '/v1/chat/completions'];
  if (!officialHost || !['', '/v1', ...chatPaths].includes(path) || url.search || url.hash) {
    return { url: value, adapted: false };
  }
  if (chatPaths.includes(path)) return { url: value, adapted: true };
  const prefix = path === '/v1' ? '/v1' : '';
  return { url: `${url.origin}${prefix}/chat/completions`, adapted: true };
}

function normalizeChatResponse(payload) {
  const message = payload?.choices?.[0]?.message || {};
  const functionCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter((call) => call?.type === 'function' && call.function)
    .map((call) => ({
      callId: String(call.id || ''),
      name: String(call.function.name || ''),
      arguments: parseArguments(call.function.arguments)
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
    usage: {
      inputTokens: Number(payload?.usage?.prompt_tokens) || 0,
      outputTokens: Number(payload?.usage?.completion_tokens) || 0
    },
    rawMessage: message
  };
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
    .filter((tool) => tool?.type === 'function' && tool.name)
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: tool.strict
      }
    }));
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
  for (const item of outputs) {
    if (item?.type === 'function_call') {
      functionCalls.push({
        callId: String(item.call_id || item.id || ''),
        name: String(item.name || ''),
        arguments: parseArguments(item.arguments)
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
    usage: {
      inputTokens: Number(payload?.usage?.input_tokens) || 0,
      outputTokens: Number(payload?.usage?.output_tokens) || 0
    }
  };
}

function parseArguments(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch {
    throw createPublicError('INVALID_TOOL_ARGUMENTS', '模型给出了无效的工具参数。');
  }
}

function isAuthenticationError(error) {
  return /(?:^|_)(?:401|403|AUTH|AUTHENTICATION|UNAUTHORIZED|INVALID_API_KEY)(?:$|_)/i
    .test(String(error?.code || ''));
}

module.exports = { createDeepSeekClient, normalizeResponse };
