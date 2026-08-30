'use strict';

function createOvertimeConsumer({ service } = {}) {
  if (
    !service ||
    typeof service.observeGift !== 'function' ||
    typeof service.finalizeGift !== 'function'
  ) {
    throw new Error('OvertimeService is required to create OvertimeConsumer.');
  }

  return {
    name: 'overtime',
    isEnabled: () => service.getCurrentEpoch() > 0,
    getEpoch: () => service.getCurrentEpoch(),
    handle(event) {
      if (event?.phase === 'progress') return service.observeGift(event);
      if (event?.phase === 'final') return service.finalizeGift(event);
      return false;
    },
  };
}

module.exports = { createOvertimeConsumer };
