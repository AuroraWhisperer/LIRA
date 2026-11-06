'use strict';

const { setTimeout: sleep } = require('node:timers/promises');
const { cleanText } = require('../shared/utils');
const { checkLocalInput } = require('./safety');
const { createAiReplyGenerator } = require('./ai-reply-generator');
const { isAiReady, applyModelProviderPreset, assertSavedModelKeyOrigin, usesAccountModel } = require('./config');
const { createOrderedAsyncCoordinator } = require('./async-coordinator');
const { appendConversationExchange } = require('./conversation-context');
const assistantHelpers = require('./ai-assistant-helpers');
const {
  MIN_CHUNK_INTERVAL_MS,
  MAX_CHUNK_INTERVAL_MS,
  randomReplyIntervalMs,
  randomIntervalMs,
  extractTriggeredQuestion,
  normalizeDanmaku,
  buildConversationInput,
  buildReplyInstructions,
  getReplyLengthBudget,
  truncateReply,
  codedError,
  createShutdownError,
  isShutdownError,
  publicError,
  failureReply,
} = assistantHelpers;

const MAX_DELIVERY_ATTEMPTS = 3;
const DELIVERY_CONFIRM_TIMEOUT_MS = 10000;
const REPLY_ECHO_TTL_MS = 60000;
function createAiAssistantService(dependencies) {
  const {
    store,
    modelClient,
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

  const generator = createAiReplyGenerator({ store, modelClient, tools, quotaStore, now,
    onError: error => { lastError = publicError(error); } });
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
    if (!isAiReady(config) || modelClient.isReady?.(config) === false) return { accepted: false, reason: 'disabled_or_unconfigured' };
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
    item.signal = AbortSignal.any([shutdownController.signal, replyController.signal]);
    item.replySession = captureReplySession?.();
    const config = store.getConfig();
    if (usesAccountModel(config)) {
      item.modelSessionConfig = { modelProvider: config.modelProvider, modelAuthMode: config.modelAuthMode };
      item.modelSessionRevision = modelClient.getSessionRevision?.(item.modelSessionConfig);
    }
    item.turn = generator.createTurn({ uid: item.uid, roomId: item.roomId, userName: item.userName,
      question: item.question, localRefusal: item.localRefusal, modelSessionRevision: item.modelSessionRevision });
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
    return item.turn.generate({ ...options, signal: item.signal, assertCurrent: () => throwIfReplyCancelled(item) });
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
        if (currentResult.memory && ['chat', 'tool', 'cache'].includes(currentResult.category)) {
          const { uid, question, context, sessionId, personaScope } = currentResult.memory;
          store.setContext(
            uid,
            appendConversationExchange(context, question, currentResult.text, sessionId),
            store.getConfig().contextTtlSeconds,
            personaScope,
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
      modelClient.testConnection(config, {
        signal: shutdownController.signal,
      }),
    );
  }

  async function testProvider(provider) {
    const config = store.getConfig();
    return runDirectOperation(() => {
      const options = { signal: shutdownController.signal };
      if (provider === 'deepseek') return modelClient.testConnection(config, options);
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
      modelClient.listModels({
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
      ready: isAiReady(config) && modelClient.isReady?.(config) !== false,
      trigger: config.trigger,
      model: config.modelProvider === 'doubao' ? '豆包' : config.model,
      doubao: modelClient.getAccountStatus?.(),
      chatgpt: modelClient.getSubscriptionStatus?.(),
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
    if (item.modelSessionRevision !== undefined && item.modelSessionRevision !== modelClient.getSessionRevision?.(item.modelSessionConfig)) {
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
