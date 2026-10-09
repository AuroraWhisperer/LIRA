'use strict';

const { setTimeout: delay } = require('node:timers/promises');

async function installComponentStyle(store, id, authorize) {
  store.beginPending(id);
  try {
    for (let attempt = 0; ; attempt++) {
      authorize();
      try { return store.install(id); }
      catch (error) {
        // Windows may briefly hold fresh files. Retry only before the index has changed.
        if (attempt >= 4 || !['EPERM', 'EBUSY'].includes(error.code) || error.syscall !== 'rename'
          || error.path !== store.directory(id, true) || error.dest !== store.directory(id)) throw error;
        await delay(50 * (attempt + 1));
      }
    }
  } finally { store.endPending(id); }
}

module.exports = { installComponentStyle };
