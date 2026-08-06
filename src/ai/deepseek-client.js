'use strict';

const { fetchJson, createPublicError } = require('./http-client');

const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models';

function createDeepSeekClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  async function createResponse(request) {
    const config = request.config || {};
    if (!config.deepseekResponsesUrl || !config.deepseekApiKey) {
      throw createPublicError('AI_NOT_CONFIGURED', 'DeepSeek API 尚未配置。');
    }
    const body = {
      model: config.model,
      instructions: request.instructions,
      input: request.input,
      tools: request.tools || [],
      max_output_tokens: Math.max(64, Number(request.maxOutputTokens) || 256)
    };
    if (request.previousResponseId) body.previous_response_id = request.previousResponseId;
    if (!config.reasoningEnabled) body.reasoning = { effort: 'none' };

    const payload = await fetchJson(config.deepseekResponsesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseekApiKey}`
      },
      body: JSON.stringify(body),
      timeoutMs: config.requestTimeoutMs,
      fetchImpl
    });
    return normalizeResponse(payload);
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

  return { createResponse, listModels };
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

module.exports = { createDeepSeekClient, normalizeResponse };
