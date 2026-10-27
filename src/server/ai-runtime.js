'use strict';

const path = require('node:path');
const { createAiConfigStore } = require('../ai/config-store');
const { createAiStateStore } = require('../storage/ai-state-store');
const { createAiApiQuotaStore } = require('../ai/api-quota-store');
const { createElectronSecretCodec } = require('../ai/secret-codec');
const { createDeepSeekClient } = require('../ai/deepseek-client');
const { createDoubaoClient } = require('../ai/doubao-client');
const { createChatGptSession } = require('../ai/chatgpt-session');
const { createChatGptClient } = require('../ai/chatgpt-client');
const { createAiRequestLogger } = require('../ai/request-logger');
const { createQWeatherTool } = require('../ai/tools/qweather-tool');
const { createAmapTool } = require('../ai/tools/amap-tool');
const { createWebSearchTool } = require('../ai/tools/web-search-tool');
const { createAiAssistantService } = require('../ai/ai-assistant-service');
const { createDanmakuDeliveryVerifier } = require('../ai/danmaku-delivery-verifier');

function buildAiRuntime({ songDb, runtimeOptions = {}, aiLogPath, danmakuSender }) {
  const persistence = createAiStateStore(songDb);
  const secretCodec = runtimeOptions.aiSecretCodec || createElectronSecretCodec(runtimeOptions.safeStorage);
  const configStore = createAiConfigStore(persistence, secretCodec);
  const chatgptSession = createChatGptSession({ persistence, secretCodec,
    openBrowser: runtimeOptions.openAiLoginBrowser, fetchImpl: runtimeOptions.fetchImpl });
  const quotaStore = createAiApiQuotaStore(songDb);
  const deliveryVerifier = createDanmakuDeliveryVerifier();
  const requestLogger = runtimeOptions.aiRequestLogger || createAiRequestLogger({ logDir: path.dirname(aiLogPath) });
  const doubao = createDoubaoClient({
    session: runtimeOptions.doubaoSession,
    logEvent: (event) => requestLogger.log(event),
  });
  const service = createAiAssistantService({
    store: configStore,
    quotaStore,
    deepseek: createDeepSeekClient({
      doubao,
      chatgpt: createChatGptClient({ session: chatgptSession, fetchImpl: runtimeOptions.fetchImpl,
        logEvent: (event) => requestLogger.log(event) }),
      fetchImpl: runtimeOptions.fetchImpl,
      logEvent: (event, options) => requestLogger.log(event, options),
    }),
    tools: {
      qweather: createQWeatherTool({
        fetchImpl: runtimeOptions.fetchImpl,
        quotaStore,
      }),
      amap: createAmapTool({ fetchImpl: runtimeOptions.fetchImpl, quotaStore }),
      webSearch: createWebSearchTool({ fetchImpl: runtimeOptions.fetchImpl }),
    },
    sendReply: (input) => danmakuSender.send({ ...input, waitForRateLimit: true }),
    waitForDelivery: (delivery) => deliveryVerifier.waitForDelivery(delivery),
  });
  let shutdownPromise = null;
  const contextCleanupTimer = setInterval(() => {
    try {
      configStore.pruneExpired();
    } catch {
      console.warn('[AI] expired conversation cleanup failed');
    }
  }, 60000);
  contextCleanupTimer.unref?.();

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    clearInterval(contextCleanupTimer);
    shutdownPromise = (async () => {
      await Promise.all([service.shutdown(), chatgptSession.shutdown()]);
      deliveryVerifier.dispose();
      await requestLogger.flush?.();
    })();
    return shutdownPromise;
  }

  return {
    doubao,
    chatgptSession,
    configStore,
    quotaStore,
    deliveryVerifier,
    requestLogger,
    service,
    shutdown,
  };
}

module.exports = { buildAiRuntime };
