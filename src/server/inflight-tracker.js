'use strict';

function createInflightTracker() {
  let accepting = true;
  let active = 0;
  let drainPromise = null;
  let resolveDrain = null;

  async function run(work) {
    if (!accepting) {
      const error = new Error('Server is quiescing.');
      error.code = 'SERVER_QUIESCING';
      throw error;
    }
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
      if (active === 0 && resolveDrain) {
        const resolve = resolveDrain;
        resolveDrain = null;
        resolve();
      }
    }
  }

  function quiesce() {
    accepting = false;
  }

  function drain() {
    if (active === 0) return Promise.resolve();
    if (!drainPromise) {
      drainPromise = new Promise((resolve) => {
        resolveDrain = resolve;
      });
    }
    return drainPromise;
  }

  return { run, quiesce, drain };
}

module.exports = { createInflightTracker };
