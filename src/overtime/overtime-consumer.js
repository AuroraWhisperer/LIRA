'use strict';

function createOvertimeConsumer({ service } = {}) {
  if (!service || typeof service.observeGift !== 'function' || typeof service.finalizeGift !== 'function') {
    throw new Error('OvertimeService is required to create OvertimeConsumer.');
  }

  return {
    name: 'overtime',
    handle(event) {
      if (event?.phase === 'progress') return service.observeGift(event);
      if (event?.phase === 'final') return service.finalizeGift(event);
      return false;
    },
  };
}

module.exports = { createOvertimeConsumer };
