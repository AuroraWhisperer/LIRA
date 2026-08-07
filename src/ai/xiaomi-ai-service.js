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
const MIN_CHUNK_INTERVAL_MS = 200;
const MAX_CHUNK_INTERVAL_MS = 600;
const MODEL_OUTPUT_TOKENS = 3072;
const REASONING_OUTPUT_TOKENS = 4096;
const REVIEW_OUTPUT_TOKENS = 384;
const DANMAKU_MESSAGE_LIMIT = 40;
const MAX_REPLY_MESSAGES = 3;

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
      const inputReview = await runSafetyReview(
        config, buildInputReviewPrompt(item.question), usage, 'input_review'
      );
      if (!inputReview.allowed) {
        return { text: inputReview.safeText || SAFE_REFUSAL, category: 'safety', usage, toolCalls: 0 };
      }

      if (!Object.prototype.hasOwnProperty.call(item, 'conversationContext')) {
        item.conversationContext = store.getContext(item.uid);
      }
      const context = item.conversationContext;
      const input = buildConversationInput(item.question, context);
      const excludedToolNames = new Set(quotaStore?.getExcludedToolNames?.() || []);
      const replyBudget = getReplyLengthBudget(item.userName, config.replyMaxChars);
      let response = await deepseek.createResponse({
        config,
        instructions: buildReplyInstructions(
          config.systemPrompt, config.replyMaxChars, excludedToolNames, config.webSearchEnabled, item.userName
        ),
        input,
        tools: buildAvailableTools(config, excludedToolNames),
        maxOutputTokens: getModelOutputTokens(config),
        purpose: 'generation'
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
          instructions: buildReplyInstructions(
            config.systemPrompt, config.replyMaxChars, excludedToolNames, config.webSearchEnabled, item.userName
          ),
          input: outputs,
          tools: buildAvailableTools(config, excludedToolNames),
          previousResponseId: response.id,
          maxOutputTokens: getModelOutputTokens(config),
          purpose: 'tool_followup'
        });
        addUsage(usage, response.usage);
      }

      const rawText = cleanModelText(response.text);
      const outputReview = await runSafetyReview(
        config, buildOutputReviewPrompt(rawText), usage, 'output_review'
      );
      const approved = outputReview.allowed ? (outputReview.safeText || rawText) : (outputReview.safeText || SAFE_REFUSAL);
      const text = truncateReply(approved, replyBudget.threeMessages);
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

  async function runSafetyReview(config, prompt, usage, purpose) {
    const response = await deepseek.createResponse({
      config, instructions: '执行直播内容审核，只输出指定 JSON。', input: prompt,
      tools: [], maxOutputTokens: REVIEW_OUTPUT_TOKENS, purpose
    });
    addUsage(usage, response.usage);
    return parseSafetyReview(response.text);
  }

  async function executeTool(call, config) {
    if (call.name === 'get_weather') return tools.qweather.getWeather(config, call.arguments);
    if (call.name === 'search_places') return tools.amap.searchPlaces(config, call.arguments);
    if (call.name === 'resolve_location') return tools.amap.resolveLocation(config, call.arguments);
    if (call.name === 'get_route') return tools.amap.getRoute(config, call.arguments);
    if (call.name === 'web_search') return tools.webSearch.search(config, call.arguments);
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
          : '该第三方 API 已达到本月安全用量上限，且 web_search 未启用。请简短说明路线服务没有返回结果，不要编造路线。'
      };
    }
  }

  async function deliverReply(item, result) {
    let currentResult = result;
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      const chunkIntervalMs = randomIntervalMs(random, MIN_CHUNK_INTERVAL_MS, MAX_CHUNK_INTERVAL_MS);
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
        intervalMs: chunkIntervalMs,
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
  return randomIntervalMs(random, MIN_REPLY_INTERVAL_MS, MAX_REPLY_INTERVAL_MS);
}

function randomIntervalMs(random, minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
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
function buildReplyInstructions(
  systemPrompt, replyMaxChars, excludedToolNames = new Set(), webSearchEnabled = true, mentionName = ''
) {
  const budget = getReplyLengthBudget(mentionName, replyMaxChars);
  let instructions = `${String(systemPrompt || '').trim()}\n\n本次回复长度规则以此处为准：加上 @用户名后，1 条弹幕可放 ${budget.oneMessage} 个字符，2 条共 ${budget.twoMessages} 个字符，3 条共 ${budget.threeMessages} 个字符。优先只用 1 条；信息较多时可用 2 条；只有确有必要完整说明时才使用第 3 条，禁止超过 3 条。${budget.preferred} 个字符只是长度偏好，不是必须达到或严格截断的位置。问候、招呼、简单聊天和简单事实回答，正文写约 18–22 个汉字；默认尽量在正文后添加一个简短的标点组合或颜文字。颜文字按语气自然轮换：开心/亲切可用“ฅ^•ﻌ•^ฅ”“(｡･ω･｡)”“(๑•̀ㅂ•́)و✧”；惊讶/好奇可用“Σ(ﾟдﾟ)”“(⊙o⊙)”“(°ロ°) !”；害羞/感谢可用“(*´∀｀*)”“(⁄ ⁄•⁄ω⁄•⁄ ⁄)”“ヾ(≧▽≦*)o”；无奈/犯困可用“(´-ω-｀)”“( ˘ω˘ )”“ヽ(￣д￣;)ノ”；鼓励/得意可用“٩(ˊᗜˋ*)و”“( •̀∀•́ )✧”“٩(๑•̀ω•́๑)۶”。根据上下文选择，不要每次都用同一个，也不要连续回复重复同一个颜文字；不适合时只用“～”或省略。如果会超出上限、属于必要的简短拒答，或事实信息已经较多，可以省略；不要堆叠多个颜文字。天气、路线等需要多项事实时按信息量自然增长。不要为了接近长度偏好补充废话或复述问题。`;
  if (excludedToolNames.size) {
    instructions += webSearchEnabled
      ? '\n本月部分第三方 API 已达到安全用量上限，相关函数已停用。涉及这些函数的查询必须改用 web_search，不要凭记忆回答。'
      : '\n本月部分第三方 API 已达到安全用量上限，相关函数已停用且 web_search 未启用。请简短说明路线服务没有返回结果，不要编造路线。';
  }
  return instructions;
}

function getReplyLengthBudget(mentionName, preferredChars) {
  const name = cleanText(mentionName);
  const mentionLength = name ? splitTextIntoCharacters(`@${name} `).length : 0;
  const oneMessage = Math.max(1, DANMAKU_MESSAGE_LIMIT - mentionLength);
  return {
    oneMessage,
    twoMessages: oneMessage * 2,
    threeMessages: oneMessage * MAX_REPLY_MESSAGES,
    preferred: Math.max(10, Math.min(50, Number(preferredChars) || 50))
  };
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

function getModelOutputTokens(config = {}) {
  return config.reasoningEnabled ? REASONING_OUTPUT_TOKENS : MODEL_OUTPUT_TOKENS;
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
  const code = String(error?.code || '');
  if (code === 'UPSTREAM_TIMEOUT') return '查询超时了，稍后再试一次～';
  if (code.startsWith('WEB_SEARCH_')) return '联网搜索暂时失败，换个关键词或稍后再问我～';
  if (code === 'AMAP_NOT_CONFIGURED') return '路线服务还没配置好，请先接入地图服务。';
  if (code === 'QWEATHER_NOT_CONFIGURED') return '天气服务还没配置好，请先接入天气服务。';
  if (code === 'AI_NOT_CONFIGURED') return 'AI 服务还没配置好，请先检查接口地址和 Key。';
  if (code.startsWith('QWEATHER_')) return '天气服务暂时没返回结果，换个城市再问我～';
  if (code.startsWith('AMAP_')) return '路线数据没返回完整，换个地点或方式再问我～';
  return '这次查询没完成，换个问法或稍后再试～';
}

module.exports = {
  createXiaomiAiService,
  extractTriggeredQuestion,
  truncateReply,
  buildConversationInput,
  buildReplyInstructions,
  getReplyLengthBudget,
  failureReply
};
