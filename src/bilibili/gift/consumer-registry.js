'use strict';

function createGiftConsumerRegistry(options = {}) {
  const consumers = Array.isArray(options.consumers)
    ? options.consumers.filter(isConsumer)
    : [];
  const onError =
    typeof options.onError === 'function'
      ? options.onError
      : defaultErrorHandler;

  function dispatch(event) {
    const result = { delivered: [], failed: [] };
    for (const consumer of consumers) {
      try {
        consumer.handle(event);
        result.delivered.push(consumer.name);
      } catch (error) {
        result.failed.push(consumer.name);
        onError(error, consumer.name, event);
      }
    }
    return result;
  }

  function getConsumers() {
    return consumers.map((consumer) => consumer.name);
  }

  return { dispatch, getConsumers };
}

function isConsumer(value) {
  return Boolean(
    value &&
    typeof value.name === 'string' &&
    value.name &&
    typeof value.handle === 'function',
  );
}

function defaultErrorHandler(error, consumerName, event) {
  const eventId = Number(event?.giftEventId) || 0;
  console.warn(
    `[Bilibili][GiftConsumer] consumer=${consumerName} eventId=${eventId} error=${error.message}`,
  );
}

module.exports = { createGiftConsumerRegistry };
