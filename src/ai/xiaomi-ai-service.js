'use strict';

const { cleanText, splitTextIntoCharacters } = require('../shared/utils');
const { buildTools } = require('./prompt');
const {
  SAFE_REFUSAL,
  checkLocalInput,
  buildInputReviewPrompt,
  buildOutputReviewPrompt,
  parseSafetyReview
} = require('./safety');
const { isAiReady } = require('./config');
const { createOrderedAsyncCoordinator } = require('./async-coordinator');
const { getQuotaToolNames } = require('./api-quota-store');

const MAX_DELIVERY_ATTEMPTS = 3;
const DELIVERY_CONFIRM_TIMEOUT_MS = 10000;
const MIN_REPLY_INTERVAL_MS = 500;
const MAX_REPLY_INTERVAL_MS = 2000;

function createXiaomiAiService(dependencies) {
  const {
    store, deepseek, tools, sendReply, waitForDelivery, quotaStore,
    now = Date.now,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    log = console
  } = dependencies;
  const userLastRequest = new Map();
  const roomRequests = [];
  let lastDeliveryAt = 0;
  let lastError = '';
  let handledCount = 0;

  const coordinator = createOrderedAsyncCoordinator({
    generate: generateReply,
    deliver: deliverReply,
    getConcurrency: () => store.getConfig().generationConcurrency,
    onError(error, item) {
      lastError = publicError(error);
      store.logRequest({
        uid: item.uid, userName: item.userName, category: 'delivery', status: 'failed',
        errorCode: String(error?.code || 'DELIVERY_FAILED')
      });
      log.warn?.(`[AI] reply delivery failed uid=${JSON.stringify(item.uid)} code=${JSON.stringify(error?.code || 'DELIVERY_FAILED')}`);
    }
  });

  function handleDanmaku(danmaku = {}) {
    const config = store.getConfig();
    if (!isAiReady(config)) return { accepted: false, reason: 'disabled_or_unconfigured' };
    const message = cleanText(danmaku.message);
    const question = extractTriggeredQuestion(message, config.trigger);
    if (question === null) return { accepted: false, reason: 'not_triggered' };
    const uid = cleanText(danmaku.uid) || `name:${cleanText(danmaku.userName)}`;
    if (store.isBlacklisted(uid)) return { accepted: false, reason: 'blacklisted' };
    const localSafety = checkLocalInput(question);
    const rateReason = consumeRateLimit(uid, config);
    if (rateReason) return { accepted: false, reason: rateReason };
    if (coordinator.getStatus().queued >= config.queueLimit) return { accepted: false, reason: 'queue_full' };
    if (!localSafety.allowed) {
      return enqueueReply({ ...normalizeDanmaku(danmaku, uid), question, localRefusal: localSafety.safeText });
    }
    return enqueueReply({ ...normalizeDanmaku(danmaku, uid), question });
  }

  function enqueueReply(item) {
    const accepted = coordinator.enqueue(item);
    if (accepted) handledCount += 1;
    return { accepted, reason: accepted ? 'queued' : 'stopped' };
  }

  function consumeRateLimit(uid, config) {
    const current = now();
    const last = userLastRequest.get(uid) || 0;
    if (last && current - last < config.userCooldownSeconds * 1000) return 'user_rate_limited';
    const cutoff = current - 60000;
    while (roomRequests.length && roomRequests[0] <= cutoff) roomRequests.shift();
    if (roomRequests.length >= config.roomLimitPerMinute) return 'room_rate_limited';
    userLastRequest.set(uid, current);
    roomRequests.push(current);
    return '';
  }

  async function generateReply(item, options = {}) {
    const startedAt = now();
    const config = store.getConfig();
    if (item.localRefusal) {
      return { text: item.localRefusal, category: 'safety', usage: {}, toolCalls: 0 };
    }
    const cacheKey = `${config.model}\n${item.question}`;
    const cached = options.bypassCache ? null : store.getCache(cacheKey);
    if (cached?.text) return { ...cached, category: 'cache' };
    const usage = { inputTokens: 0, outputTokens: 0 };
    let toolCallCount = 0;
    try {
      const inputReview = await runSafetyReview(config, buildInputReviewPrompt(item.question), usage);
      if (!inputReview.allowed) {
        return { text: inputReview.safeText || SAFE_REFUSAL, category: 'safety', usage, toolCalls: 0 };
      }

      if (!Object.prototype.hasOwnProperty.call(item, 'conversationContext')) {
        item.conversationContext = store.getContext(item.uid);
      }
      const context = item.conversationContext;
      const input = buildConversationInput(item.question, context);
      const excludedToolNames = new Set(quotaStore?.getExcludedToolNames?.() || []);
      let response = await deepseek.createResponse({
        config,
        instructions: buildReplyInstructions(config.systemPrompt, config.replyMaxChars, excludedToolNames, config.webSearchEnabled),
        input,
        tools: buildAvailableTools(config, excludedToolNames),
        maxOutputTokens: 256
      });
      addUsage(usage, response.usage);

      while (response.functionCalls.length) {
        if (toolCallCount + response.functionCalls.length > config.maxToolCalls) {
          throw codedError('TOOL_LIMIT', '工具调用次数太多，这次先不继续查了。');
        }
        const outputs = [];
        for (const call of response.functionCalls) {
          const result = await executeToolWithQuotaFallback(call, config, excludedToolNames);
          outputs.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result) });
          toolCallCount += 1;
        }
        response = await deepseek.createResponse({
          config,
          instructions: buildReplyInstructions(config.systemPrompt, config.replyMaxChars, excludedToolNames, config.webSearchEnabled),
          input: outputs,
          tools: buildAvailableTools(config, excludedToolNames),
          previousResponseId: response.id,
          maxOutputTokens: 256
        });
        addUsage(usage, response.usage);
      }

      const rawText = cleanModelText(response.text);
      const outputReview = await runSafetyReview(config, buildOutputReviewPrompt(rawText), usage);
      const approved = outputReview.allowed ? (outputReview.safeText || rawText) : (outputReview.safeText || SAFE_REFUSAL);
      const text = truncateReply(approved, config.replyMaxChars);
      const result = { text, category: toolCallCount ? 'tool' : 'chat', usage, toolCalls: toolCallCount };
      store.setContext(item.uid, { question: item.question, answer: text }, config.contextTtlSeconds);
      store.setCache(cacheKey, result, config.cacheTtlSeconds);
      store.logRequest({
        uid: item.uid, userName: item.userName, category: result.category, status: 'generated',
        latencyMs: now() - startedAt, inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens, toolCalls: toolCallCount
      });
      return result;
    } catch (error) {
      lastError = publicError(error);
      store.logRequest({
        uid: item.uid, userName: item.userName, category: 'generation', status: 'failed',
        latencyMs: now() - startedAt, inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens, toolCalls: toolCallCount,
        errorCode: String(error?.code || 'GENERATION_FAILED')
      });
      return { text: failureReply(error), category: 'failure', usage, toolCalls: toolCallCount };
    }
  }

  async function runSafetyReview(config, prompt, usage) {
    const response = await deepseek.createResponse({
      config, instructions: '执行直播内容审核，只输出指定 JSON。', input: prompt, tools: [], maxOutputTokens: 120
    });
    addUsage(usage, response.usage);
    return parseSafetyReview(response.text);
  }

  async function executeTool(call, config) {
    if (call.name === 'get_weather') return tools.qweather.getWeather(config, call.arguments);
    if (call.name === 'search_places') return tools.amap.searchPlaces(config, call.arguments);
    if (call.name === 'resolve_location') return tools.amap.resolveLocation(config, call.arguments);
    if (call.name === 'get_route') return tools.amap.getRoute(config, call.arguments);
    if (call.name === 'get_current_time') return tools.getCurrentTime(call.arguments);
    throw codedError('UNKNOWN_TOOL', '模型请求了未开放的工具。');
  }

  async function executeToolWithQuotaFallback(call, config, excludedToolNames) {
    try {
      return await executeTool(call, config);
    } catch (error) {
      const quotaToolNames = getQuotaToolNames(error);
      if (!quotaToolNames.length) throw error;
      for (const name of quotaToolNames) excludedToolNames.add(name);
      return {
        unavailable: true,
        reason: 'monthly_api_quota_reached',
        instruction: config.webSearchEnabled
          ? '该第三方 API 已达到本月安全用量上限。不要再次调用这个函数，请改用 web_search 回答。'
          : '该第三方 API 已达到本月安全用量上限，且 web_search 未启用。请直接说明暂时无法查询。'
      };
    }
  }

  async function deliverReply(item, result) {
    let currentResult = result;
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      const waitMs = lastDeliveryAt
        ? Math.max(0, randomReplyIntervalMs(random) - (now() - lastDeliveryAt))
        : 0;
      if (waitMs) await delay(waitMs);
      const mentionTarget = {
        uid: item.uid.startsWith('name:') ? '' : item.uid,
        name: item.userName,
        source: 'xiaomi-ai'
      };
      const delivery = await sendReply({
        message: currentResult.text,
        mentionTarget,
        mentionEveryChunk: true,
        intervalMs: 0,
        rateLimitIntervalMs: 0
      });
      lastDeliveryAt = now();
      if (typeof waitForDelivery !== 'function') return;
      const delivered = await waitForDelivery({
        ...delivery,
        mentionName: mentionTarget.name,
        timeoutMs: DELIVERY_CONFIRM_TIMEOUT_MS
      });
      if (delivered) return;
      log.warn?.(`[AI] reply missing from room feed uid=${JSON.stringify(item.uid)} attempt=${attempt}/${MAX_DELIVERY_ATTEMPTS}`);
      if (attempt < MAX_DELIVERY_ATTEMPTS) {
        currentResult = await generateReply(item, { bypassCache: true });
      }
    }
    throw codedError('DANMAKU_SWALLOWED', 'AI 回复连续三次未完整出现在直播间弹幕中。');
  }

  async function testConfiguration() {
    const config = store.getConfig();
    return deepseek.testConnection(config);
  }

  async function testProvider(provider) {
    const config = store.getConfig();
    if (provider === 'deepseek') return deepseek.testConnection(config);
    if (provider === 'qweather') return tools.qweather.testConnection(config);
    if (provider === 'amap') return tools.amap.testConnection(config);
    throw codedError('AI_PROVIDER_UNKNOWN', '不支持该连接测试。');
  }

  async function listModels(input = {}) {
    const config = store.getConfig();
    const apiKey = String(input.apiKey || '').trim() || config.deepseekApiKey;
    return deepseek.listModels({ apiKey, requestTimeoutMs: config.requestTimeoutMs });
  }

  function getStatus() {
    const config = store.getConfig();
    return {
      enabled: config.enabled,
      ready: isAiReady(config),
      trigger: config.trigger,
      model: config.model,
      handledCount,
      lastError,
      apiUsage: quotaStore?.getAllUsage?.() || [],
      ...coordinator.getStatus()
    };
  }

  function shutdown() {
    coordinator.stop();
  }

  return { handleDanmaku, testConfiguration, testProvider, listModels, getStatus, shutdown };
}

function randomReplyIntervalMs(random) {
  return MIN_REPLY_INTERVAL_MS
    + Math.floor(random() * (MAX_REPLY_INTERVAL_MS - MIN_REPLY_INTERVAL_MS + 1));
}

function buildAvailableTools(config, excludedToolNames) {
  return buildTools(config).filter((tool) => !tool.name || !excludedToolNames.has(tool.name));
}

function extractTriggeredQuestion(message, trigger) {
  const text = cleanText(message);
  const keyword = cleanText(trigger);
  const index = keyword ? text.indexOf(keyword) : -1;
  if (index < 0) return null;
  const question = cleanText(`${text.slice(0, index)} ${text.slice(index + keyword.length)}`)
    .replace(/^[，,。.!！?？:：、\s]+|[\s]+$/g, '');
  return question || '和大家打个招呼';
}

function normalizeDanmaku(danmaku, uid) {
  return { uid, userName: cleanText(danmaku.userName) || '观众' };
}

function buildConversationInput(question, context) {
  if (!context?.question || !context?.answer) return question;
  return `短期上下文（仅用于理解省略，不要逐字复述）：观众上次问“${context.question}”，回答“${context.answer}”。\n本次问题：${question}`;
}

/**
 * Append a runtime length contract so old/custom persona text cannot turn the
 * configured maximum into a target that every answer tries to fill.
 */
function buildReplyInstructions(systemPrompt, replyMaxChars, excludedToolNames = new Set(), webSearchEnabled = true) {
  const maximum = Math.max(10, Math.min(50, Number(replyMaxChars) || 50));
  let instructions = `${String(systemPrompt || '').trim()}\n\n本次回复长度规则：绝对上限是 ${maximum} 个字符，这只是上限，不是目标。问候、招呼、简单聊天和简单事实回答，正文写约 18–22 个汉字；正文之外可以自然添加标点和一个简短的标点组合或颜文字，例如“～”“ฅ^•ﻌ•^ฅ”或“(｡･ω･｡)”，但不要堆叠多个颜文字。天气、路线等需要多项事实时按信息量增长，确有必要才接近上限。不要为了接近上限补充废话或复述问题。`;
  if (excludedToolNames.size) {
    instructions += webSearchEnabled
      ? '\n本月部分第三方 API 已达到安全用量上限，相关函数已停用。涉及这些函数的查询必须改用 web_search，不要凭记忆回答。'
      : '\n本月部分第三方 API 已达到安全用量上限，相关函数已停用且 web_search 未启用。请明确说明暂时无法查询。';
  }
  return instructions;
}

function cleanModelText(value) {
  return cleanText(value).replace(/^```[\s\S]*?\n|```$/g, '').replace(/https?:\/\/\S+/g, '');
}

function truncateReply(text, limit) {
  const chars = splitTextIntoCharacters(cleanText(text));
  if (chars.length <= limit) return chars.join('');
  return `${chars.slice(0, Math.max(1, limit - 1)).join('')}…`;
}

function addUsage(target, usage = {}) {
  target.inputTokens += Number(usage.inputTokens) || 0;
  target.outputTokens += Number(usage.outputTokens) || 0;
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function publicError(error) {
  return String(error?.message || 'AI 处理失败').slice(0, 160);
}

function failureReply(error) {
  if (error?.code === 'UPSTREAM_TIMEOUT') return '查询超时了，这次没有查到，稍后再问我喵～';
  if (String(error?.code || '').includes('NOT_CONFIGURED')) return '对应查询工具还没配置好，暂时查不到喵～';
  return '这次查询失败了，没有查到可靠结果喵～';
}

module.exports = {
  createXiaomiAiService,
  extractTriggeredQuestion,
  truncateReply,
  buildConversationInput,
  buildReplyInstructions
};
