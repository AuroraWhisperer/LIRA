'use strict';

const { cleanText } = require('../shared/utils');
const {
  SAFE_REFUSAL,
  checkLocalInput,
  buildInputReviewPrompt,
  buildOutputReviewPrompt,
  parseSafetyReview,
} = require('./safety');
const { isAiReady } = require('./config');
const { createOrderedAsyncCoordinator } = require('./async-coordinator');
const { getQuotaToolNames } = require('./api-quota-store');
const assistantHelpers = require('./ai-assistant-helpers');
const {
  MIN_CHUNK_INTERVAL_MS,
  MAX_CHUNK_INTERVAL_MS,
  randomReplyIntervalMs,
  randomIntervalMs,
  buildAvailableTools,
  extractTriggeredQuestion,
  normalizeDanmaku,
  buildConversationInput,
  buildReplyInstructions,
  getReplyLengthBudget,
  cleanModelText,
  truncateReply,
  addUsage,
  getModelOutputTokens,
  codedError,
  createShutdownError,
  isShutdownError,
  publicError,
  failureReply,
} = assistantHelpers;

const MAX_DELIVERY_ATTEMPTS = 3;
const DELIVERY_CONFIRM_TIMEOUT_MS = 10000;
const REVIEW_OUTPUT_TOKENS = 384;
function createAiAssistantService(dependencies) {
  const {
    store,
    deepseek,
    tools,
    sendReply,
    waitForDelivery,
    quotaStore,
    now = Date.now,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    log = console,
  } = dependencies;
  const userLastRequest = new Map();
  const roomRequests = [];
  const shutdownController = new AbortController();
  const directOperations = new Set();
  let lastUserMapPruneAt = 0;
  let lastDeliveryAt = 0;
  let lastError = '';
  let handledCount = 0;
  let shuttingDown = false;
  let shutdownPromise = null;

  const coordinator = createOrderedAsyncCoordinator({
    generate: generateReply,
    deliver: deliverReply,
    getConcurrency: () => store.getConfig().generationConcurrency,
    onError(error, item) {
      if (isShutdownError(error)) return;
      lastError = publicError(error);
      store.logRequest({
        uid: item.uid,
        userName: item.userName,
        category: 'delivery',
        status: 'failed',
        errorCode: String(error?.code || 'DELIVERY_FAILED'),
      });
      log.warn?.(
        `[AI] reply delivery failed uid=${JSON.stringify(item.uid)} code=${JSON.stringify(error?.code || 'DELIVERY_FAILED')}`,
      );
    },
  });

  function handleDanmaku(danmaku = {}) {
    if (shuttingDown) return { accepted: false, reason: 'stopped' };
    const config = store.getConfig();
    if (!isAiReady(config))
      return { accepted: false, reason: 'disabled_or_unconfigured' };
    const message = cleanText(danmaku.message);
    const question = extractTriggeredQuestion(message, config.trigger);
    if (question === null) return { accepted: false, reason: 'not_triggered' };
    const uid = cleanText(danmaku.uid) || `name:${cleanText(danmaku.userName)}`;
    if (store.isBlacklisted(uid))
      return { accepted: false, reason: 'blacklisted' };
    const localSafety = checkLocalInput(question);
    const rateReason = consumeRateLimit(uid, config);
    if (rateReason) return { accepted: false, reason: rateReason };
    if (coordinator.getStatus().queued >= config.queueLimit)
      return { accepted: false, reason: 'queue_full' };
    if (!localSafety.allowed) {
      return enqueueReply({
        ...normalizeDanmaku(danmaku, uid),
        question,
        localRefusal: localSafety.safeText,
      });
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
    if (last && current - last < config.userCooldownSeconds * 1000)
      return 'user_rate_limited';
    const cutoff = current - 60000;
    while (roomRequests.length && roomRequests[0] <= cutoff)
      roomRequests.shift();
    if (roomRequests.length >= config.roomLimitPerMinute)
      return 'room_rate_limited';
    userLastRequest.set(uid, current);
    roomRequests.push(current);
    pruneUserLastRequest(current, config);
    return '';
  }

  // 与 roomRequests 一样把观众维度的冷却表有界化：长直播下永不清理会无界增长。
  function pruneUserLastRequest(current, config) {
    if (current - lastUserMapPruneAt < 60000) return;
    lastUserMapPruneAt = current;
    const retentionMs = Math.max(
      60000,
      Number(config.userCooldownSeconds) * 1000 + 60000,
    );
    const expireBefore = current - retentionMs;
    for (const [uid, timestamp] of userLastRequest) {
      if (timestamp < expireBefore) userLastRequest.delete(uid);
    }
  }

  async function generateReply(item, options = {}) {
    throwIfShuttingDown();
    const startedAt = now();
    const config = store.getConfig();
    if (item.localRefusal) {
      return {
        text: item.localRefusal,
        category: 'safety',
        usage: {},
        toolCalls: 0,
      };
    }
    const cacheKey = `${config.model}\n${item.question}`;
    const cached = options.bypassCache ? null : store.getCache(cacheKey);
    if (cached?.text) return { ...cached, category: 'cache' };
    const usage = { inputTokens: 0, outputTokens: 0 };
    let toolCallCount = 0;
    try {
      const inputReview = await runSafetyReview(
        config,
        buildInputReviewPrompt(item.question),
        usage,
        'input_review',
      );
      throwIfShuttingDown();
      if (!inputReview.allowed) {
        return {
          text: inputReview.safeText || SAFE_REFUSAL,
          category: 'safety',
          usage,
          toolCalls: 0,
        };
      }

      if (!Object.prototype.hasOwnProperty.call(item, 'conversationContext')) {
        item.conversationContext = store.getContext(item.uid);
      }
      const context = item.conversationContext;
      const input = buildConversationInput(item.question, context);
      const excludedToolNames = new Set(
        quotaStore?.getExcludedToolNames?.() || [],
      );
      const replyBudget = getReplyLengthBudget(
        item.userName,
        config.replyMaxChars,
      );
      let response = await deepseek.createResponse({
        config,
        instructions: buildReplyInstructions(
          config.systemPrompt,
          config.replyMaxChars,
          excludedToolNames,
          config.webSearchEnabled,
          item.userName,
        ),
        input,
        tools: buildAvailableTools(config, excludedToolNames),
        maxOutputTokens: getModelOutputTokens(config),
        purpose: 'generation',
        signal: shutdownController.signal,
      });
      throwIfShuttingDown();
      addUsage(usage, response.usage);

      while (response.functionCalls.length) {
        if (
          toolCallCount + response.functionCalls.length >
          config.maxToolCalls
        ) {
          throw codedError(
            'TOOL_LIMIT',
            '工具调用次数太多，这次先不继续查了。',
          );
        }
        const outputs = [];
        for (const call of response.functionCalls) {
          const result = await executeToolWithQuotaFallback(
            call,
            config,
            excludedToolNames,
          );
          throwIfShuttingDown();
          outputs.push({
            type: 'function_call_output',
            call_id: call.callId,
            output: JSON.stringify(result),
          });
          toolCallCount += 1;
        }
        response = await deepseek.createResponse({
          config,
          instructions: buildReplyInstructions(
            config.systemPrompt,
            config.replyMaxChars,
            excludedToolNames,
            config.webSearchEnabled,
            item.userName,
          ),
          input: outputs,
          tools: buildAvailableTools(config, excludedToolNames),
          previousResponseId: response.id,
          maxOutputTokens: getModelOutputTokens(config),
          purpose: 'tool_followup',
          signal: shutdownController.signal,
        });
        throwIfShuttingDown();
        addUsage(usage, response.usage);
      }

      const rawText = cleanModelText(response.text);
      const outputReview = await runSafetyReview(
        config,
        buildOutputReviewPrompt(item.question, rawText),
        usage,
        'output_review',
      );
      throwIfShuttingDown();
      const approved = outputReview.allowed
        ? outputReview.safeText || rawText
        : outputReview.safeText || SAFE_REFUSAL;
      const text = truncateReply(approved, replyBudget.threeMessages);
      const result = {
        text,
        category: toolCallCount ? 'tool' : 'chat',
        usage,
        toolCalls: toolCallCount,
      };
      throwIfShuttingDown();
      store.setContext(
        item.uid,
        { question: item.question, answer: text },
        config.contextTtlSeconds,
      );
      throwIfShuttingDown();
      store.setCache(cacheKey, result, config.cacheTtlSeconds);
      throwIfShuttingDown();
      store.logRequest({
        uid: item.uid,
        userName: item.userName,
        category: result.category,
        status: 'generated',
        latencyMs: now() - startedAt,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        toolCalls: toolCallCount,
      });
      return result;
    } catch (error) {
      if (isShutdownError(error)) throw error;
      lastError = publicError(error);
      store.logRequest({
        uid: item.uid,
        userName: item.userName,
        category: 'generation',
        status: 'failed',
        latencyMs: now() - startedAt,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        toolCalls: toolCallCount,
        errorCode: String(error?.code || 'GENERATION_FAILED'),
      });
      return {
        text: failureReply(error),
        category: 'failure',
        usage,
        toolCalls: toolCallCount,
      };
    }
  }

  async function runSafetyReview(config, prompt, usage, purpose) {
    const instructions =
      purpose === 'output_review'
        ? '执行直播输出安全与质量校验，只输出指定 JSON。'
        : '执行直播输入安全审核，只输出指定 JSON。';
    const response = await deepseek.createResponse({
      config,
      instructions,
      input: prompt,
      tools: [],
      maxOutputTokens: REVIEW_OUTPUT_TOKENS,
      purpose,
      signal: shutdownController.signal,
    });
    addUsage(usage, response.usage);
    return parseSafetyReview(response.text);
  }

  async function executeTool(call, config) {
    const options = { signal: shutdownController.signal };
    if (call.name === 'get_weather')
      return tools.qweather.getWeather(config, call.arguments, options);
    if (call.name === 'search_places')
      return tools.amap.searchPlaces(config, call.arguments, options);
    if (call.name === 'resolve_location')
      return tools.amap.resolveLocation(config, call.arguments, options);
    if (call.name === 'get_route')
      return tools.amap.getRoute(config, call.arguments, options);
    if (call.name === 'web_search')
      return tools.webSearch.search(config, call.arguments, options);
    if (call.name === 'get_current_time')
      return tools.getCurrentTime(call.arguments);
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
          : '该第三方 API 已达到本月安全用量上限，且 web_search 未启用。请简短说明路线服务没有返回结果，不要编造路线。',
      };
    }
  }

  async function deliverReply(item, result) {
    let currentResult = result;
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      throwIfShuttingDown();
      const chunkIntervalMs = randomIntervalMs(
        random,
        MIN_CHUNK_INTERVAL_MS,
        MAX_CHUNK_INTERVAL_MS,
      );
      const waitMs = lastDeliveryAt
        ? Math.max(0, randomReplyIntervalMs(random) - (now() - lastDeliveryAt))
        : 0;
      if (waitMs) {
        await delay(waitMs);
        throwIfShuttingDown();
      }
      const mentionTarget = {
        uid: item.uid.startsWith('name:') ? '' : item.uid,
        name: item.userName,
        source: 'ai-assistant',
      };
      const delivery = await sendReply({
        message: currentResult.text,
        mentionTarget,
        mentionEveryChunk: true,
        intervalMs: chunkIntervalMs,
        rateLimitIntervalMs: 0,
      });
      throwIfShuttingDown();
      lastDeliveryAt = now();
      if (typeof waitForDelivery !== 'function') return;
      const delivered = await waitForDelivery({
        ...delivery,
        mentionName: mentionTarget.name,
        timeoutMs: DELIVERY_CONFIRM_TIMEOUT_MS,
        signal: shutdownController.signal,
      });
      throwIfShuttingDown();
      if (delivered) return;
      log.warn?.(
        `[AI] reply missing from room feed uid=${JSON.stringify(item.uid)} attempt=${attempt}/${MAX_DELIVERY_ATTEMPTS}`,
      );
      if (attempt < MAX_DELIVERY_ATTEMPTS) {
        currentResult = await generateReply(item, { bypassCache: true });
      }
    }
    throw codedError(
      'DANMAKU_SWALLOWED',
      'AI 回复连续三次未完整出现在直播间弹幕中。',
    );
  }

  async function testConfiguration() {
    const config = store.getConfig();
    return runDirectOperation(() =>
      deepseek.testConnection(config, {
        signal: shutdownController.signal,
      }),
    );
  }

  async function testProvider(provider) {
    const config = store.getConfig();
    return runDirectOperation(() => {
      const options = { signal: shutdownController.signal };
      if (provider === 'deepseek')
        return deepseek.testConnection(config, options);
      if (provider === 'qweather')
        return tools.qweather.testConnection(config, options);
      if (provider === 'amap')
        return tools.amap.testConnection(config, options);
      throw codedError('AI_PROVIDER_UNKNOWN', '不支持该连接测试。');
    });
  }

  async function listModels(input = {}) {
    const config = store.getConfig();
    const apiKey = String(input.apiKey || '').trim() || config.deepseekApiKey;
    const responsesUrl =
      String(input.apiUrl || '').trim() || config.deepseekResponsesUrl;
    return runDirectOperation(() =>
      deepseek.listModels({
        apiKey,
        responsesUrl,
        modelProvider: input.modelProvider || config.modelProvider,
        modelApiProtocol: input.modelApiProtocol || config.modelApiProtocol,
        requestTimeoutMs: config.requestTimeoutMs,
        signal: shutdownController.signal,
      }),
    );
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
      ...coordinator.getStatus(),
    };
  }

  function runDirectOperation(work) {
    throwIfShuttingDown();
    const operation = Promise.resolve().then(work);
    directOperations.add(operation);
    operation.then(
      () => directOperations.delete(operation),
      () => directOperations.delete(operation),
    );
    return operation;
  }

  function throwIfShuttingDown() {
    if (!shuttingDown && !shutdownController.signal.aborted) return;
    throw createShutdownError();
  }

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    shutdownController.abort(createShutdownError());
    const coordinatorDrain = coordinator.stop();
    shutdownPromise = Promise.allSettled([
      coordinatorDrain,
      ...directOperations,
    ]).then(() => {});
    return shutdownPromise;
  }

  return {
    handleDanmaku,
    testConfiguration,
    testProvider,
    listModels,
    getStatus,
    shutdown,
  };
}

module.exports = {
  createAiAssistantService,
  extractTriggeredQuestion,
  truncateReply,
  buildConversationInput,
  buildReplyInstructions,
  getReplyLengthBudget,
  failureReply,
};
