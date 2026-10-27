'use strict';

const { setTimeout: sleep } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');
const { cleanText } = require('../shared/utils');
const {
  SAFE_REFUSAL,
  DOUBAO_CHAT_POLICY,
  checkLocalInput,
  buildInputReviewPrompt,
  buildOutputReviewPrompt,
  parseSafetyReview,
} = require('./safety');
const { isAiReady, applyModelProviderPreset, assertSavedModelKeyOrigin, usesAccountModel } = require('./config');
const { createOrderedAsyncCoordinator } = require('./async-coordinator');
const { getQuotaToolNames } = require('./api-quota-store');
const { resolvePersona } = require('./personas');
const { getCurrentTime } = require('./tools/current-time-tool');
const { normalizeConversationContext, appendConversationExchange } = require('./conversation-context');
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
const REPLY_ECHO_TTL_MS = 60000;
function createAiAssistantService(dependencies) {
  const {
    store,
    deepseek,
    tools,
    sendReply,
    waitForDelivery,
    quotaStore,
    now = Date.now,
    delay = (ms, options) => sleep(ms, undefined, options),
    random = Math.random,
    log = console,
  } = dependencies;
  const lastRequestAtByUser = new Map();
  const roomRequestTimes = [];
  const replyEchoes = [];
  const shutdownController = new AbortController();
  const directOperations = new Set();
  const replyDrains = new Set();
  let replyController = new AbortController();
  let lastUserMapPruneAt = 0;
  let lastDeliveryAt = 0;
  let lastError = '';
  let handledCount = 0;
  let shuttingDown = false;
  let shutdownPromise = null;

  let coordinator = createCoordinator();

  function createCoordinator() {
    return createOrderedAsyncCoordinator({
      generate: generateReply,
      deliver: deliverReply,
      getKey: (item) => JSON.stringify([item.roomId, item.uid]),
      getConcurrency: () => store.getConfig().modelProvider === 'doubao' ? 1 : store.getConfig().generationConcurrency,
      onError(error, item) {
        if (item.signal.aborted || isShutdownError(error) || ['DANMAKU_SESSION_CHANGED', 'DOUBAO_SESSION_CHANGED', 'AI_MODEL_SESSION_CHANGED'].includes(error?.code)) return;
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
  }

  function updateConfig(changes) {
    throwIfShuttingDown();
    const previous = store.getConfig();
    const wasEnabled = previous.enabled;
    const config = store.updateConfig(changes);
    const accountProviderChanged = (previous.modelProvider !== config.modelProvider || previous.modelAuthMode !== config.modelAuthMode)
      && (usesAccountModel(previous) || usesAccountModel(config));
    if ((wasEnabled && config.enabled === false) || accountProviderChanged) {
      replyController.abort(accountProviderChanged ? codedError('DOUBAO_SESSION_CHANGED', '模型服务已切换。') : codedError('AI_DISABLED', 'AI 助手已关闭。'));
      const drain = coordinator.stop();
      replyDrains.add(drain);
      drain.then(() => replyDrains.delete(drain));
      replyController = new AbortController();
      coordinator = createCoordinator();
    }
    return config;
  }

  function handleDanmaku(danmaku = {}) {
    if (shuttingDown) return { accepted: false, reason: 'stopped' };
    const config = store.getConfig();
    if (!isAiReady(config) || deepseek.isReady?.(config) === false) return { accepted: false, reason: 'disabled_or_unconfigured' };
    const message = cleanText(danmaku.message);
    const uid = cleanText(danmaku.uid) || `name:${cleanText(danmaku.userName)}`;
    pruneReplyEchoes();
    if (replyEchoes.some((reply) => reply.uid === uid && reply.messages.includes(message))) {
      return { accepted: false, reason: 'self_reply' };
    }
    const question = extractTriggeredQuestion(message, config.trigger);
    if (question === null) return { accepted: false, reason: 'not_triggered' };
    if (store.isBlacklisted(uid)) return { accepted: false, reason: 'blacklisted' };
    const localSafety = checkLocalInput(question);
    const rateReason = consumeRateLimit(uid, config);
    if (rateReason) return { accepted: false, reason: rateReason };
    if (coordinator.getStatus().queued >= config.queueLimit) return { accepted: false, reason: 'queue_full' };
    if (!localSafety.allowed) {
      return enqueueReply(
        { ...normalizeDanmaku(danmaku, uid), question, localRefusal: localSafety.safeText },
        danmaku.captureReplySession,
      );
    }
    return enqueueReply({ ...normalizeDanmaku(danmaku, uid), question }, danmaku.captureReplySession);
  }

  function pruneReplyEchoes() {
    const cutoff = now() - REPLY_ECHO_TTL_MS;
    while (replyEchoes.length && replyEchoes[0].sentAt <= cutoff) replyEchoes.shift();
  }

  function rememberReply({ accountUid, message, mentionName }) {
    pruneReplyEchoes();
    replyEchoes.push({
      uid: cleanText(accountUid),
      messages: [cleanText(message), cleanText(`@${mentionName} ${message}`)],
      sentAt: now(),
    });
  }

  function enqueueReply(item, captureReplySession) {
    item.canRemember = Boolean(item.roomId && item.uid && !item.uid.startsWith('name:'));
    item.endConversation = /^(?:结束对话|清空对话)[。！!？?\s]*$/u.test(item.question);
    item.signal = AbortSignal.any([shutdownController.signal, replyController.signal]);
    item.replySession = captureReplySession?.();
    const config = store.getConfig();
    if (usesAccountModel(config)) {
      item.modelSessionConfig = { modelProvider: config.modelProvider, modelAuthMode: config.modelAuthMode };
      item.modelSessionRevision = deepseek.getSessionRevision?.(item.modelSessionConfig);
    }
    const accepted = coordinator.enqueue(item);
    if (accepted) handledCount += 1;
    return { accepted, reason: accepted ? 'queued' : 'stopped' };
  }

  function consumeRateLimit(uid, config) {
    const current = now();
    const last = lastRequestAtByUser.get(uid) || 0;
    if (last && current - last < config.userCooldownSeconds * 1000) return 'user_rate_limited';
    const cutoff = current - 60000;
    while (roomRequestTimes.length && roomRequestTimes[0] <= cutoff) roomRequestTimes.shift();
    if (roomRequestTimes.length >= config.roomLimitPerMinute) return 'room_rate_limited';
    lastRequestAtByUser.set(uid, current);
    roomRequestTimes.push(current);
    pruneUserLastRequest(current, config);
    return '';
  }

  // 与房间请求时间表一样，清理观众冷却记录以免长直播下无界增长。
  function pruneUserLastRequest(current, config) {
    if (current - lastUserMapPruneAt < 60000) return;
    lastUserMapPruneAt = current;
    const retentionMs = Math.max(60000, Number(config.userCooldownSeconds) * 1000 + 60000);
    const expireBefore = current - retentionMs;
    for (const [uid, timestamp] of lastRequestAtByUser) {
      if (timestamp < expireBefore) lastRequestAtByUser.delete(uid);
    }
  }

  async function generateReply(item, options = {}) {
    item.assertSessionCurrent = await item.replySession;
    throwIfReplyCancelled(item);
    item.assertSessionCurrent?.();
    const startedAt = now();
    const config = store.getConfig();
    const accountChat = config.modelProvider === 'doubao';
    if (item.localRefusal) {
      return {
        text: item.localRefusal,
        category: 'safety',
        usage: {},
        toolCalls: 0,
      };
    }
    const usage = { inputTokens: 0, outputTokens: 0 };
    let toolCallCount = 0;
    try {
      const persona = item.persona || (item.persona = resolvePersona(config));
      item.personaScope = JSON.stringify([item.roomId, persona.id, persona.prompt]);
      if (item.endConversation) {
        if (item.canRemember) store.clearContext(item.uid, item.personaScope);
        return { text: '这段对话结束啦，下次叫我会重新开始～', category: 'conversation_reset', usage, toolCalls: 0 };
      }
      if (!Object.prototype.hasOwnProperty.call(item, 'conversationContext')) {
        item.conversationContext = item.canRemember ? normalizeConversationContext(store.getContext(item.uid, item.personaScope)) : null;
      }
      const context = item.conversationContext;
      item.conversationSessionId ||= context?.sessionId || randomUUID();
      const input = buildConversationInput(item.question, context);
      const excludedToolNames = new Set(quotaStore?.getExcludedToolNames?.() || []);
      // The store persists only the key hash, not config secrets or context text.
      const cacheKey = JSON.stringify([
        'reply-v7',
        config,
        item.modelSessionRevision,
        item.personaScope,
        item.uid,
        item.userName,
        item.question,
        input,
        [...excludedToolNames].sort(),
      ]);
      const cached = options.bypassCache ? null : store.getCache(cacheKey);
      if (cached?.text) {
        return { ...cached, category: 'cache' };
      }
      if (!accountChat) {
        const inputReview = await runSafetyReview(config, buildInputReviewPrompt(input), usage, 'input_review', item.signal);
        throwIfReplyCancelled(item);
        if (!inputReview.allowed) {
          return { text: SAFE_REFUSAL, category: 'safety', usage, toolCalls: 0 };
        }
      }

      const currentTime = getCurrentTime({}, { now: new Date(now()) }).formatted;
      const replyBudget = getReplyLengthBudget(item.userName, config.replyMaxChars);
      const replyLimit = options.singleMessage ? replyBudget.oneMessage : replyBudget.threeMessages;
      let response = await deepseek.createResponse({
        config,
        instructions: buildReplyInstructions(
          persona.prompt,
          config.replyMaxChars,
          buildAvailableTools(config, excludedToolNames),
          item.userName,
          currentTime,
          options.singleMessage,
        ) + (accountChat ? `\n${DOUBAO_CHAT_POLICY}` : ''),
        input,
        tools: buildAvailableTools(config, excludedToolNames),
        maxOutputTokens: getModelOutputTokens(config),
        purpose: 'generation',
        ...(accountChat ? { conversationKey: JSON.stringify([item.uid, item.personaScope, item.conversationSessionId]) } : {}),
        signal: item.signal,
      });
      throwIfReplyCancelled(item);
      addUsage(usage, response.usage);

      while (response.functionCalls.length) {
        if (toolCallCount + response.functionCalls.length > config.maxToolCalls) {
          throw codedError('TOOL_LIMIT', '工具调用次数太多，这次先不继续查了。');
        }
        const outputs = [];
        for (const call of response.functionCalls) {
          const result = await executeToolWithQuotaFallback(call, config, excludedToolNames, item.signal);
          throwIfReplyCancelled(item);
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
            persona.prompt,
            config.replyMaxChars,
            buildAvailableTools(config, excludedToolNames),
            item.userName,
            currentTime,
            options.singleMessage,
          ),
          input: outputs,
          tools: buildAvailableTools(config, excludedToolNames),
          previousResponseId: response.id,
          maxOutputTokens: getModelOutputTokens(config),
          purpose: 'tool_followup',
          signal: item.signal,
        });
        throwIfReplyCancelled(item);
        addUsage(usage, response.usage);
      }

      const rawText = cleanModelText(response.text);
      let approvedText = rawText;
      if (!accountChat) {
        const outputReview = await runSafetyReview(
          config,
          buildOutputReviewPrompt(item.question, rawText, input, replyLimit),
          usage,
          'output_review',
          item.signal,
        );
        throwIfReplyCancelled(item);
        if (!outputReview.allowed) return { text: SAFE_REFUSAL, category: 'safety', usage, toolCalls: toolCallCount };
        approvedText = cleanModelText(outputReview.safeText || rawText);
      }
      if (!checkLocalInput(approvedText).allowed || approvedText === SAFE_REFUSAL) {
        return { text: SAFE_REFUSAL, category: 'safety', usage, toolCalls: toolCallCount };
      }
      const text = truncateReply(approvedText, replyLimit);
      const result = {
        text,
        category: toolCallCount ? 'tool' : 'chat',
        usage,
        toolCalls: toolCallCount,
      };
      throwIfReplyCancelled(item);
      store.setCache(cacheKey, result, config.cacheTtlSeconds);
      throwIfReplyCancelled(item);
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
      throwIfReplyCancelled(item);
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

  async function runSafetyReview(config, prompt, usage, purpose, signal) {
    const response = await deepseek.createResponse({
      config: { ...config, reasoningEnabled: false },
      instructions: prompt.instructions,
      input: prompt.input,
      tools: [],
      maxOutputTokens: REVIEW_OUTPUT_TOKENS,
      purpose,
      signal,
    });
    addUsage(usage, response.usage);
    return parseSafetyReview(response.text);
  }

  async function executeTool(call, config, signal) {
    const options = { signal };
    if (call.name === 'get_weather') return tools.qweather.getWeather(config, call.arguments, options);
    if (call.name === 'search_places') return tools.amap.searchPlaces(config, call.arguments, options);
    if (call.name === 'resolve_location') return tools.amap.resolveLocation(config, call.arguments, options);
    if (call.name === 'get_route') return tools.amap.getRoute(config, call.arguments, options);
    if (call.name === 'web_search') return tools.webSearch.search(config, call.arguments, options);
    throw codedError('UNKNOWN_TOOL', '模型请求了未开放的工具。');
  }

  async function executeToolWithQuotaFallback(call, config, excludedToolNames, signal) {
    const offered = (candidate) => candidate.functionCallingEnabled && buildAvailableTools(candidate, excludedToolNames)
      .some((tool) => (tool.name || tool.type) === call.name);
    if (!offered(config) || !offered(store.getConfig())) {
      excludedToolNames.add(call.name);
      return { unavailable: true, reason: 'tool_unavailable', instruction: '此工具本次不可用，请使用已提供的其他能力，或说明无法核实，不要编造结果。' };
    }
    try {
      return await executeTool(call, config, signal);
    } catch (error) {
      const quotaToolNames = getQuotaToolNames(error);
      if (!quotaToolNames.length) throw error;
      for (const name of quotaToolNames) excludedToolNames.add(name);
      const searchAvailable = [config, store.getConfig()].every((candidate) =>
        buildAvailableTools(candidate, excludedToolNames).some((tool) => tool.type === 'web_search'),
      );
      return {
        unavailable: true,
        reason: 'monthly_api_quota_reached',
        instruction: searchAvailable
          ? '该第三方 API 已达到本月安全用量上限。不要再次调用这个函数，请改用 web_search 回答。'
          : '该第三方 API 已达到本月安全用量上限，当前没有可用的联网搜索。请说明无法核实，并提供一般建议，不要编造实时数据。',
      };
    }
  }

  async function deliverReply(item, result) {
    const assertSessionCurrent = (auth) => {
      throwIfReplyCancelled(item);
      item.assertSessionCurrent?.(auth);
    };
    let currentResult = result;
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      assertSessionCurrent();
      const chunkIntervalMs = randomIntervalMs(random, MIN_CHUNK_INTERVAL_MS, MAX_CHUNK_INTERVAL_MS);
      const waitMs = lastDeliveryAt ? Math.max(0, randomReplyIntervalMs(random) - (now() - lastDeliveryAt)) : 0;
      if (waitMs) {
        await delay(waitMs, { signal: item.signal });
        assertSessionCurrent();
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
        assertSessionCurrent,
        onBeforeSend: rememberReply,
      });
      assertSessionCurrent();
      lastDeliveryAt = now();
      const delivered =
        typeof waitForDelivery !== 'function' ||
        (await waitForDelivery({
          ...delivery,
          mentionName: mentionTarget.name,
          timeoutMs: DELIVERY_CONFIRM_TIMEOUT_MS,
          signal: item.signal,
        }));
      assertSessionCurrent();
      if (delivered) {
        if (item.canRemember && ['chat', 'tool', 'cache'].includes(currentResult.category)) {
          store.setContext(
            item.uid,
            appendConversationExchange(item.conversationContext, item.question, currentResult.text, item.conversationSessionId),
            store.getConfig().contextTtlSeconds,
            item.personaScope,
          );
        }
        return;
      }
      log.warn?.(
        `[AI] reply missing from room feed uid=${JSON.stringify(item.uid)} attempt=${attempt}/${MAX_DELIVERY_ATTEMPTS}`,
      );
      if (attempt < MAX_DELIVERY_ATTEMPTS && currentResult.category !== 'conversation_reset') {
        currentResult = await generateReply(item, { bypassCache: true, singleMessage: true });
      }
    }
    throw codedError('DANMAKU_SWALLOWED', 'AI 回复连续三次未完整出现在直播间弹幕中。');
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
      if (provider === 'deepseek') return deepseek.testConnection(config, options);
      if (provider === 'qweather') return tools.qweather.testConnection(config, options);
      if (provider === 'amap') return tools.amap.testConnection(config, options);
      throw codedError('AI_PROVIDER_UNKNOWN', '不支持该连接测试。');
    });
  }

  async function listModels(input = {}) {
    const config = store.getConfig();
    const explicitKey = String(input.apiKey || '').trim();
    const requested = applyModelProviderPreset({
      ...config,
      deepseekResponsesUrl: String(input.apiUrl || '').trim() || config.deepseekResponsesUrl,
      modelProvider: input.modelProvider || config.modelProvider,
      modelApiProtocol: input.modelApiProtocol || config.modelApiProtocol,
      modelAuthMode: input.modelAuthMode || config.modelAuthMode,
    });
    // Account mode has no API destination. A temporary API probe must supply its
    // own key, or wait until switching back has validated the saved key origin.
    assertSavedModelKeyOrigin(usesAccountModel(config) ? { ...config, modelProvider: 'custom', deepseekResponsesUrl: '' } : config,
      requested, Boolean(explicitKey));
    return runDirectOperation(() =>
      deepseek.listModels({
        apiKey: explicitKey || config.deepseekApiKey,
        responsesUrl: requested.deepseekResponsesUrl,
        modelProvider: requested.modelProvider,
        modelApiProtocol: requested.modelApiProtocol,
        modelAuthMode: requested.modelAuthMode,
        requestTimeoutMs: config.requestTimeoutMs,
        signal: shutdownController.signal,
      }),
    );
  }

  function getStatus() {
    const config = store.getConfig();
    return {
      enabled: config.enabled,
      ready: isAiReady(config) && deepseek.isReady?.(config) !== false,
      trigger: config.trigger,
      model: config.modelProvider === 'doubao' ? '豆包' : config.model,
      doubao: deepseek.getAccountStatus?.(),
      chatgpt: deepseek.getSubscriptionStatus?.(),
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

  function throwIfReplyCancelled(item) {
    throwIfShuttingDown();
    item.signal.throwIfAborted();
    if (item.modelSessionRevision !== undefined && item.modelSessionRevision !== deepseek.getSessionRevision?.(item.modelSessionConfig)) {
      throw codedError(item.modelSessionConfig?.modelProvider === 'doubao' ? 'DOUBAO_SESSION_CHANGED' : 'AI_MODEL_SESSION_CHANGED', 'AI 账号会话已变化，本次回复已取消。');
    }
  }

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    shutdownController.abort(createShutdownError());
    const coordinatorDrain = coordinator.stop();
    shutdownPromise = Promise.allSettled([coordinatorDrain, ...replyDrains, ...directOperations]).then(() => {});
    return shutdownPromise;
  }

  return {
    handleDanmaku,
    updateConfig,
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
