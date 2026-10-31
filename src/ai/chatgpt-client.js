'use strict';

const { randomUUID } = require('node:crypto');
const { createPublicError, createRequestSignal } = require('./http-client');
const { readResponseText } = require('../shared/response-body');
const { normalizeResponse } = require('./model-client');

const BASE_URL = 'https://api.openai.com/v1';
const MAX_BYTES = 2 * 1024 * 1024;

function createChatGptClient({ session, fetchImpl = globalThis.fetch, logEvent }) {
  const histories = new Map();
  let historyRevision;

  async function listModels(request = {}) {
    return session.withAccessToken(async (token, signal) => {
      const response = await fetchImpl(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
        signal: createRequestSignal(signal, request.requestTimeoutMs),
      });
      if (!response.ok) { await response.body?.cancel(); throw responseError(response.status); }
      const payload = JSON.parse(await readResponseText(response, MAX_BYTES, responseError));
      return { models: (Array.isArray(payload.models) ? payload.models : [])
        .filter(model => model.visibility === 'list' && typeof model.slug === 'string' && model.slug.length <= 80)
        .map(model => model.slug) };
    }, request.signal).catch(error => { throw publicError(error); });
  }

  async function createResponse(request) {
    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      const result = await session.withAccessToken(async (token, sessionSignal) => {
        const revision = session.getSessionRevision();
        if (historyRevision !== revision) { histories.clear(); historyRevision = revision; }
        const previous = request.previousResponseId ? histories.get(request.previousResponseId) : [];
        if (!previous) throw createPublicError('CHATGPT_CONTEXT_EXPIRED', '工具对话已过期，请重新提问。');
        const input = [...previous, ...(Array.isArray(request.input) ? request.input : [{ role: 'user', content: String(request.input || '') }])];
        const functions = (request.tools || []).filter(tool => tool.type === 'function');
        const tools = (request.tools || []).filter(tool => tool.type !== 'function');
        if (functions.length) tools.push({ type: 'namespace', name: 'lira', description: 'LIRA 互动助手的可选工具。', tools: functions });
        const body = {
          model: request.config.model, instructions: request.instructions || '请简短回答。', input,
          store: false, stream: true, include: ['reasoning.encrypted_content'],
        };
        if (tools.length) body.tools = tools;
        // Subscription catalogs may not offer a non-reasoning mode.
        if (request.config.reasoningEnabled && request.config.reasoningEffort !== 'auto') {
          body.reasoning = { effort: request.config.reasoningEffort };
        } else if (!request.config.reasoningEnabled) body.reasoning = { effort: 'low' };
        const signal = createRequestSignal(sessionSignal, request.config.requestTimeoutMs);
        const response = await fetchImpl(`${BASE_URL}/responses`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), redirect: 'error', signal,
        });
        if (!response.ok) { await response.body?.cancel(); throw responseError(response.status); }
        const payload = await readCompletedResponse(response, signal);
        sessionSignal.throwIfAborted();
        const normalized = normalizeResponse(payload);
        if (!normalized.text && !normalized.functionCalls.length) throw responseError();
        if (request.previousResponseId) histories.delete(request.previousResponseId);
        if (normalized.functionCalls.length) {
          normalized.id ||= randomUUID();
          histories.set(normalized.id, [...input, ...(payload.output || [])]);
          if (histories.size > 100) histories.delete(histories.keys().next().value);
        }
        return normalized;
      }, request.signal);
      await log({ type: 'request_succeeded', requestId, purpose: request.purpose, provider: 'openai', authMode: 'subscription',
        model: request.config.model, durationMs: Date.now() - startedAt, ...result.usage, functionCallCount: result.functionCalls.length });
      return result;
    } catch (error) {
      const safe = publicError(error);
      await log({ type: 'request_failed', requestId, provider: 'openai', authMode: 'subscription', error: { code: safe.code } });
      throw safe;
    }
  }
  async function log(event) {
    try { await logEvent?.(event); }
    catch { console.warn('[AI] ChatGPT request logging failed'); }
  }
  return { createResponse, listModels, getStatus: session.getStatus, getSessionRevision: session.getSessionRevision };
}

function publicError(error) {
  return ['AI_SHUTDOWN', 'AI_DISABLED', 'AI_MODEL_SESSION_CHANGED'].includes(error.code) || String(error.code || '').startsWith('CHATGPT_')
    ? error : createPublicError('CHATGPT_REQUEST_FAILED', 'ChatGPT 订阅请求未完成，请检查网络、模型或订阅权限后重试。');
}

async function readCompletedResponse(response, signal) {
  let buffer = '';
  let total = 0;
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    signal.throwIfAborted();
    total += chunk.byteLength;
    if (total > MAX_BYTES) throw createPublicError('CHATGPT_RESPONSE_TOO_LARGE', 'ChatGPT 返回内容过大。');
    buffer += decoder.decode(chunk, { stream: true });
    let separator;
    while ((separator = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      const event = JSON.parse(data);
      if (event.type === 'response.failed' || event.type === 'error') throw responseError(0, event.response?.error?.code || event.code);
      if (event.type === 'response.incomplete') throw createPublicError('CHATGPT_RESPONSE_INCOMPLETE', 'ChatGPT 回复未完成，未发送部分内容。');
      if (event.type === 'response.completed') {
        if (!event.response || event.response.status !== 'completed') throw responseError();
        return event.response;
      }
    }
  }
  throw createPublicError('CHATGPT_RESPONSE_INCOMPLETE', 'ChatGPT 连接提前结束，未发送部分内容。');
}

function responseError(status, code) {
  if (status === 429 || ['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable'].includes(code)) {
    return createPublicError('CHATGPT_USAGE_LIMIT', 'ChatGPT 订阅额度暂不可用，请查看订阅用量；不会自动改用 API。');
  }
  if (status === 401 || status === 403) return createPublicError('CHATGPT_ACCESS_DENIED', 'ChatGPT 未授权本次请求，请检查订阅权限或重新登录。');
  return createPublicError('CHATGPT_REQUEST_FAILED', 'ChatGPT 订阅请求失败，请检查账号权限和所选模型。');
}

module.exports = { createChatGptClient };
