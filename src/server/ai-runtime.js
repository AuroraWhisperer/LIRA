'use strict';

const { createAiConfigStore } = require('../ai/config-store');
const { createAiApiQuotaStore } = require('../ai/api-quota-store');
const { createElectronSecretCodec } = require('../ai/secret-codec');
const { createDeepSeekClient } = require('../ai/deepseek-client');
const { createAiRequestLogger } = require('../ai/request-logger');
const { createQWeatherTool } = require('../ai/tools/qweather-tool');
const { createAmapTool } = require('../ai/tools/amap-tool');
const { createWebSearchTool } = require('../ai/tools/web-search-tool');
const { getCurrentTime } = require('../ai/tools/current-time-tool');
const { createAiAssistantService } = require('../ai/ai-assistant-service');
const { createDanmakuDeliveryVerifier } = require('../ai/danmaku-delivery-verifier');

function buildAiRuntime({ songDb, runtimeOptions = {}, aiLogPath, danmakuSender }) {
  const configStore = createAiConfigStore(
    songDb,
    runtimeOptions.aiSecretCodec || createElectronSecretCodec(runtimeOptions.safeStorage)
  );
  const quotaStore = createAiApiQuotaStore(songDb);
  const deliveryVerifier = createDanmakuDeliveryVerifier();
  const requestLogger = runtimeOptions.aiRequestLogger || createAiRequestLogger({ filePath: aiLogPath });
  const service = createAiAssistantService({
    store: configStore,
    quotaStore,
    deepseek: createDeepSeekClient({
      fetchImpl: runtimeOptions.fetchImpl,
      logEvent: (event, options) => requestLogger.log(event, options)
    }),
    tools: {
      qweather: createQWeatherTool({ fetchImpl: runtimeOptions.fetchImpl, quotaStore }),
      amap: createAmapTool({ fetchImpl: runtimeOptions.fetchImpl, quotaStore }),
      webSearch: createWebSearchTool({ fetchImpl: runtimeOptions.fetchImpl }),
      getCurrentTime
    },
    sendReply: (input) => danmakuSender.send({ ...input, waitForRateLimit: true }),
    waitForDelivery: (delivery) => deliveryVerifier.waitForDelivery(delivery)
  });
  let shutdownPromise = null;

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      await service.shutdown();
      deliveryVerifier.dispose();
      await requestLogger.flush?.();
    })();
    return shutdownPromise;
  }

  return { configStore, quotaStore, deliveryVerifier, requestLogger, service, shutdown };
}

module.exports = { buildAiRuntime };
