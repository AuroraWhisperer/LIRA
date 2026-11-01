'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

function response(payload) {
  return { ok: payload.ok !== false, text: async () => JSON.stringify(payload) };
}

const ROOT_DIR = path.join(__dirname, '../..');

test('blind box summary refreshes on gift events and coalesces in-flight updates', async () => {
  const { EventBus } = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'shared', 'event-bus.js'));
  const section = { dataset: {}, querySelector: () => null, classList: { contains: () => false, toggle() {} } };
  const summary = { innerHTML: '', closest: () => section };
  const body = { innerHTML: '', addEventListener() {} };
  const pending = [];
  let statsRequests = 0;
  const window = {
    addEventListener() {},
    AdminApp: {
      eventBus: new EventBus(),
      utils: {
        escapeHtml: String,
        escapeAttr: String,
        formatMoney: (value) => Number(value).toFixed(2),
        readJsonResponse: async (result) => result.payload,
      },
    },
  };
  const { giftBlindbox } = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'), {
    window,
    document: {
      readyState: 'complete',
      addEventListener() {},
      querySelector: () => section,
      getElementById: (id) =>
        ({
          blindBoxStatsSummary: summary,
          blindBoxStatsBody: body,
        })[id] || null,
    },
    fetch: (url) => {
      if (url !== '/api/gifts/blind-box-stats') {
        return Promise.resolve(response({ ok: true, data: { gifts: [] } }));
      }
      statsRequests += 1;
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  const empty = {
    summary: { boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 },
    perUser: [],
  };
  const finishRequest = async (data) => {
    pending.shift()(response({ ok: true, data }));
    await new Promise(setImmediate);
  };

  assert.equal(statsRequests, 1);
  await finishRequest(empty);

  const eventBus = window.AdminApp.eventBus;
  eventBus.emit('state:loaded', { state: {} });
  assert.equal(statsRequests, 1);
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  assert.equal(statsRequests, 2);
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  assert.equal(statsRequests, 2);
  await finishRequest(empty);
  assert.equal(statsRequests, 3);
  await finishRequest({
    summary: { boxCount: 2, totalCost: 48, totalValue: 49, totalProfit: 1 },
    perUser: [
      {
        userName: 'Test viewer',
        viewer: 'name:Test viewer',
        boxCount: 2,
        boxTypeCount: 2,
        totalCost: 48,
        totalValue: 49,
        totalProfit: 1,
      },
    ],
  });
  assert.match(body.innerHTML, /Test viewer/);

  giftBlindbox.initBlindBoxStatsToggle();
  assert.equal(eventBus.listenerCount('gift:received'), 1);
  assert.equal(statsRequests, 3);
  eventBus.emit('gift:received', { reason: 'database:clear-gifts' });
  assert.equal(statsRequests, 4);
  await finishRequest(empty);
  assert.doesNotMatch(body.innerHTML, /Test viewer/);
});
