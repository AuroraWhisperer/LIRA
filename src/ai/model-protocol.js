'use strict';

const { createPublicError } = require('./http-client');

function buildResponsesBody(request, config, endpoint) {
  const responsesBody = {
    model: config.model,
    instructions: request.instructions,
    input: request.input,
    max_output_tokens: Math.max(64, Number(request.maxOutputTokens) || 256),
  };
  if (request.tools?.length) responsesBody.tools = request.tools;
  if (request.previousResponseId) responsesBody.previous_response_id = request.previousResponseId;
  if (!config.reasoningEnabled) {
    responsesBody.reasoning = { effort: 'none' };
  } else if (config.reasoningEffort && config.reasoningEffort !== 'auto') {
    const reasoningEffort = endpoint.officialDeepSeek
      ? toDeepSeekReasoningEffort(config.reasoningEffort)
      : config.reasoningEffort;
    if (reasoningEffort) responsesBody.reasoning = { effort: reasoningEffort };
  }

  return responsesBody;
}

function buildChatBody(request, config, endpoint, previousMessages) {
  const instructions = String(request.instructions || '').trim();
  const messages = previousMessages
    ? [...previousMessages, ...toChatInputMessages(request.input)]
    : buildInitialChatMessages(instructions, request.input);
  const body = {
    model: config.model,
    messages,
    max_tokens: Math.max(64, Number(request.maxOutputTokens) || 256),
    stream: false,
  };
  if (endpoint.officialDeepSeek) {
    body.thinking = {
      type: config.reasoningEnabled ? 'enabled' : 'disabled',
    };
    const reasoningEffort = toDeepSeekReasoningEffort(config.reasoningEffort);
    if (config.reasoningEnabled && reasoningEffort) body.reasoning_effort = reasoningEffort;
  } else if (config.modelProvider === 'gemini') {
    const reasoningEffort = toGeminiReasoningEffort(config.reasoningEffort);
    if (!config.reasoningEnabled) body.reasoning_effort = 'none';
    else if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  } else if (config.modelProvider === 'kimi') {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
    if (/^kimi-k3(?:[.-]|$)/i.test(config.model)) {
      body.reasoning_effort = config.reasoningEnabled ? toDeepSeekReasoningEffort(config.reasoningEffort) || 'low' : 'low';
      body.max_completion_tokens = Math.max(4096, body.max_completion_tokens);
    } else if (/^kimi-k2\.[56](?:[.-]|$)/i.test(config.model)) {
      body.thinking = { type: config.reasoningEnabled ? 'enabled' : 'disabled' };
    }
  }
  const tools = toChatTools(request.tools);
  if (tools.length) body.tools = tools;

  return body;
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
      arguments: parseArguments(call.function.arguments, finishReason),
    }));
  const text =
    typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((item) => String(item?.text || '')).join('')
        : '';
  return {
    id: String(payload?.id || ''),
    text,
    functionCalls,
    finishReason,
    usage: {
      inputTokens: Number(payload?.usage?.prompt_tokens) || 0,
      outputTokens: Number(payload?.usage?.completion_tokens) || 0,
    },
    rawMessage: message,
  };
}

function toDeepSeekReasoningEffort(value) {
  const effort = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (effort === 'auto') return '';
  if (effort === 'low' || effort === 'max') return effort;
  if (['minimal', 'medium', 'high', 'xhigh'].includes(effort)) {
    return effort === 'minimal' ? 'low' : 'high';
  }
  return '';
}

function toGeminiReasoningEffort(value) {
  const effort = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (effort === 'auto') return '';
  if (['minimal', 'low', 'medium', 'high'].includes(effort)) return effort;
  if (effort === 'xhigh' || effort === 'max') return 'high';
  return '';
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
        content: String(item.output || ''),
      };
    }
    return {
      role: 'user',
      content: typeof item === 'string' ? item : JSON.stringify(item),
    };
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
            description:
              '联网搜索最新网页信息，必须用于美食小吃饮料推荐、特产、菜单价格、新闻、演唱会、车次、航班等时效性问题。',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
              additionalProperties: false,
            },
            strict: true,
          },
        };
      }
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict,
        },
      };
    });
}

function toAssistantHistoryMessage(message, preserveReasoning = false) {
  if (!message || typeof message !== 'object') return null;
  const result = { role: 'assistant', content: message.content ?? null };
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    result.tool_calls = message.tool_calls;
    if (preserveReasoning && typeof message.reasoning_content === 'string') result.reasoning_content = message.reasoning_content;
  }
  return result;
}

function normalizeResponse(payload) {
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  const functionCalls = [];
  const textParts = [];
  const finishReason =
    payload?.status === 'incomplete' && payload?.incomplete_details?.reason === 'max_output_tokens'
      ? 'max_output_tokens'
      : '';
  for (const item of outputs) {
    if (item?.type === 'function_call') {
      functionCalls.push({
        callId: String(item.call_id || item.id || ''),
        name: String(item.name || ''),
        arguments: parseArguments(item.arguments, finishReason),
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
      outputTokens: Number(payload?.usage?.output_tokens) || 0,
    },
  };
}

function parseArguments(value, finishReason = '') {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    if (finishReason === 'length' || finishReason === 'max_output_tokens') {
      throw createPublicError('DEEPSEEK_OUTPUT_TRUNCATED', '模型输出达到长度上限，工具参数不完整。');
    }
    throw createPublicError('INVALID_TOOL_ARGUMENTS', '模型给出了无效的工具参数。');
  }
}

module.exports = { buildResponsesBody, buildChatBody, normalizeResponse, normalizeChatResponse, toAssistantHistoryMessage };
