'use strict';

const path = require('node:path');
const { createLyricToggleButton, loadModuleExports } = require('./frontend-modules');

async function createGiftHistoryFixture({ fetch, headers = [] } = {}) {
  function element() {
    return {
      ...createLyricToggleButton(),
      style: { setProperty() {} },
      dataset: {},
      handlers: {},
      hidden: false,
      textContent: '',
      innerHTML: '',
      disabled: false,
      addEventListener(type, handler) {
        this.handlers[type] = handler;
      },
      focus() {
        this.focused = true;
      },
    };
  }
  const elements = new Map(
    [
      'giftHistoryOpenBtn',
      'giftHistoryClose',
      'giftHistoryBackdrop',
      'giftHistoryDrawer',
      'giftHistoryClearDatabaseBtn',
      'giftHistoryRetryBtn',
      'giftHistoryPrev',
      'giftHistoryNext',
      'giftHistoryState',
      'giftHistoryTotal',
      'giftHistoryBody',
      'giftHistoryPageInfo',
      'giftLedgerSyncStatus',
    ].map((id) => [id, element()]),
  );
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  let clock = 0;
  let dialog;
  const document = {
    body: {
      children: [],
      appendChild(node) {
        this.children.push(node);
      },
    },
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === '#giftHistoryDrawer th[data-sort]' ? headers : []),
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      const nodes = new Map(
        ['.lira-confirm-dialog', '.lira-confirm-cancel', '.lira-confirm-confirm'].map((selector) => [
          selector,
          element(),
        ]),
      );
      dialog = {
        ...element(),
        querySelector: (selector) => nodes.get(selector),
        remove() {
          document.body.children = [];
        },
      };
      return dialog;
    },
  };
  const ledger = await loadModuleExports(path.join(__dirname, '../..', 'public/js/admin/gifts/history.js'), {
    document,
    location: {},
    URLSearchParams,
    AbortController,
    AbortSignal,
    Date: class extends Date {
      static now() {
        return clock;
      }
    },
    console: { warn() {} },
    requestAnimationFrame: (callback) => callback(),
    window: { matchMedia: () => ({ matches: true }) },
    setTimeout(callback, delay) {
      timers.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fetch:
      fetch ||
      ((url, options = {}) =>
        new Promise((resolve, reject) => {
          requests.push({ url, options, resolve, reject });
        })),
  });
  ledger.initGiftHistoryDrawer();
  const flush = () => new Promise(setImmediate);
  function runTimer() {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    clock += timer.delay;
    timer.callback();
  }
  return {
    ledger,
    elements,
    requests,
    timers,
    runTimer,
    get: (id) => elements.get(id),
    body: () => elements.get('giftHistoryBody').innerHTML,
    dialog: () => dialog,
    click: (id) => elements.get(id).handlers.click(),
    open: () => elements.get('giftHistoryOpenBtn').handlers.click(),
    close: () => ledger.closeGiftHistoryDrawer(),
    elapse(ms) {
      clock += ms;
    },
    async reply(payload, status = 200, request = requests.at(-1)) {
      request.resolve({
        ok: status < 400,
        status,
        text: async () => JSON.stringify(payload),
      });
      await flush();
    },
    async confirm(value) {
      dialog.querySelector(value ? '.lira-confirm-confirm' : '.lira-confirm-cancel').handlers.click();
      const [id, timer] = [...timers.entries()].find(([, entry]) => entry.delay === 0);
      timers.delete(id);
      timer.callback();
      await flush();
    },
  };
}

module.exports = { createGiftHistoryFixture };
