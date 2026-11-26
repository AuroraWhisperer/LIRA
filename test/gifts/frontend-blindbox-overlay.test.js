'use strict';

const assert = require('node:assert/strict');

const test = require('node:test');
const path = require('node:path');
const { loadModuleScope } = require('../helpers/frontend-modules');

async function createOverlay(search = '') {
  const elements = {
    blindboxTitle: { textContent: '' },
    blindboxSummary: { innerHTML: '' },
    blindboxLeaderboard: { innerHTML: '' },
    blindboxHeartProgress: { innerHTML: '', hidden: true },
  };
  const panel = { classList: { toggle() {} }, style: {} };
  const sandbox = {
    window: {},
    URLSearchParams,
    location: { search },
    document: {
      addEventListener() {},
      getElementById: (id) => elements[id],
      querySelector: () => panel,
      documentElement: { style: { setProperty() {} } },
    },
  };
  const evaluate = await loadModuleScope(path.join(__dirname, '../../public/js/overlays/blindbox.js'), sandbox);
  return { sandbox, elements, evaluate, api: evaluate('({ render, loadStats, connectSocket })') };
}

test('blindbox overlay renders signed summary and per-user profit text', async (t) => {
  const { api, elements } = await createOverlay();
  const cases = [
    { totalProfit: -12.345, totalValue: 62.9, valueText: '¥62.90', text: '-¥12.35' },
    { totalProfit: 0, totalValue: 75.25, valueText: '¥75.25', text: '+¥0.00' },
    { totalProfit: 12.345, totalValue: 87.6, valueText: '¥87.60', text: '+¥12.35' },
  ];
  const perUser = cases.map(({ totalProfit }, index) => ({
    userName: `Viewer ${index + 1}`,
    boxCount: 1,
    totalProfit,
  }));

  for (const { totalProfit, totalValue, valueText, text } of cases) {
    await t.test(`summary ${text} with mixed user profits`, () => {
      api.render({
        summary: { boxCount: 3, totalCost: 75.25, totalValue, totalProfit },
        perUser,
      });

      const summaryText = [
        ...elements.blindboxSummary.innerHTML.matchAll(/<span class="stat-value">([^<]*)<\/span>/g),
      ].map((match) => match[1]);
      const userText = [
        ...elements.blindboxLeaderboard.innerHTML.matchAll(/<span class="profit-value [^"]*">([^<]*)<\/span>/g),
      ].map((match) => match[1]);

      assert.deepEqual(
        { summary: summaryText, perUser: userText },
        {
          summary: ['3', '¥75.25', valueText, text],
          perUser: ['-¥12.35', '+¥0.00', '+¥12.35'],
        },
      );
    });
  }
});

test('blindbox ranking renders all, summary-only and bounded audience counts from URL settings', async () => {
  const perUser = Array.from({ length: 12 }, (_, index) => ({
    userName: `Viewer-${index + 1}`,
    boxCount: 1,
    totalProfit: 12 - index,
  }));
  for (const [search, count] of [
    ['?top=-1', 12], ['?top=0', 0], ['?top=25', 10], ['?top=invalid', 3], ['?t=2', 2],
  ]) {
    const { api, elements } = await createOverlay(search);
    api.render({ summary: { boxCount: 12, totalCost: 300, totalValue: 378, totalProfit: 78 }, perUser });
    const names = [...elements.blindboxLeaderboard.innerHTML.matchAll(/Viewer-\d+/g)].map(([name]) => name);
    assert.deepEqual(names, perUser.slice(0, count).map(({ userName }) => userName), search);
    if (count === 0) assert.equal(elements.blindboxLeaderboard.innerHTML, '', search);
  }
});

test('blindbox saved appearance updates existing sources while explicit legacy URL filters win', async () => {
  for (const [search, expected] of [['', [6, true, true, true, false]], ['?top=2&winners=0&heartBox=0&c=0&ns=1', [2, false, false, false, true]]]) {
    const { evaluate } = await createOverlay(search);
    evaluate('state = { settings: { blindboxOverlayTop: "6", blindboxWinnersOnly: "true", blindboxHeartBoxOnly: "true", blindboxCompact: "true", blindboxAutoPages: "false" } }; receiveAppearance();');
    assert.deepEqual(Array.from(evaluate('[TOP_N, WINNERS_ONLY, HEART_BOX_ONLY, COMPACT, NO_SCROLL]')), expected);
  }
});

test('blindbox summary-only changes repaint a stable ranking', async () => {
  const { api, evaluate, elements } = await createOverlay();
  const stats = { summary: { boxCount: 1, totalCost: 1, totalValue: 2, totalProfit: 1 },
    perUser: [{ userName: 'Viewer', boxCount: 1, totalProfit: 1 }] };
  for (const top of [0, 3, 0]) {
    evaluate(`state = { settings: { blindboxOverlayTop: '${top}', blindboxAutoPages: 'false' } }; receiveAppearance();`);
    api.render(stats);
    assert.equal(elements.blindboxLeaderboard.innerHTML.includes('Viewer'), top !== 0);
  }
});

test('blindbox filtering requests the selected box and hides losses only in winner mode', async () => {
  const perUser = [
    { userName: 'Winner', boxCount: 1, totalProfit: 8 },
    { userName: 'BreakEven', boxCount: 1, totalProfit: 0 },
    { userName: 'Loss', boxCount: 1, totalProfit: -2 },
  ];
  for (const search of ['', '?heartBox=1&winners=1']) {
    const { sandbox, api, elements } = await createOverlay(search);
    const requests = [];
    sandbox.fetch = async (url) => {
      requests.push(url);
      return { json: async () => ({ ok: true, data: { summary: {}, perUser } }) };
    };
    await api.loadStats();
    assert.equal(requests.length, 1);
    const query = new URLSearchParams(requests[0].split('?')[1]);
    assert.equal(query.get('top'), '3');
    assert.equal(query.get('hideLoss'), search ? '1' : '0');
    assert.equal(query.get('boxName'), search ? '心动盲盒' : null);
    assert.match(elements.blindboxLeaderboard.innerHTML, /Winner/);
    assert.equal(elements.blindboxLeaderboard.innerHTML.includes('BreakEven'), search === '');
    assert.equal(elements.blindboxLeaderboard.innerHTML.includes('Loss'), search === '');
  }
});

test('changed leaderboard filters refresh even when a coalesced snapshot has another reason', async () => {
  const { sandbox, api, elements } = await createOverlay();
  let onMessage;
  sandbox.WebSocket = class {
    addEventListener(type, listener) {
      if (type === 'message') onMessage = payload => listener({ data: JSON.stringify(payload) });
    }
  };
  const requests = [];
  sandbox.fetch = async url => {
    requests.push(url);
    return { json: async () => ({ ok: true, data: { summary: {},
      perUser: Array.from({ length: 6 }, (_, index) => ({ userName: `User-${index}`, totalProfit: 1 })) } }) };
  };
  api.connectSocket();
  const snapshot = { type: 'snapshot', reason: 'lyrics',
    state: { settings: { blindboxOverlayTop: '6', blindboxAutoPages: 'false' } } };
  onMessage(snapshot);
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  assert.equal(new URLSearchParams(requests[0].split('?')[1]).get('top'), '6');
  assert.match(elements.blindboxLeaderboard.innerHTML, /User-5/);
  onMessage(snapshot);
  assert.equal(requests.length, 1);
});

test('a reconnect and its first snapshot fetch the blind box stats once', async () => {
  const { sandbox, api } = await createOverlay('?r=0');
  const listeners = new Map();
  let reconnect;
  let reads = 0;
  sandbox.WebSocket = class {
    addEventListener(event, listener) { listeners.set(event, listener); }
  };
  sandbox.setTimeout = callback => { reconnect = callback; return 1; };
  sandbox.clearTimeout = () => {};
  sandbox.fetch = async () => { reads++; return { json: async () => ({ ok: true, data: { summary: {} } }) }; };
  api.connectSocket();
  listeners.get('close')();
  reconnect();
  listeners.get('open')();
  listeners.get('message')({ data: JSON.stringify({ type: 'snapshot', reason: 'connect', state: { settings: {} } }) });
  await new Promise(setImmediate);
  assert.equal(reads, 1);
});

test('a coalesced gift database clear removes the old leader and reads the cleared ledger once', async () => {
  const { invokeBodyRoute } = require('../helpers/route-invoke');
  const { routes } = require('../../src/server/routes/data-routes');
  const { sandbox, api, elements } = await createOverlay();
  let receive;
  sandbox.WebSocket = class {
    addEventListener(type, listener) {
      if (type === 'message') receive = payload => listener({ data: JSON.stringify(payload) });
    }
  };
  let reads = 0;
  let perUser = [{ userName: 'Old leader', totalProfit: 9 }];
  const clearedRead = Promise.withResolvers();
  sandbox.fetch = async () => {
    if (++reads === 2) await clearedRead.promise;
    return { json: async () => ({ ok: true, data: { summary: {}, perUser } }) };
  };
  api.connectSocket();
  await api.loadStats();
  assert.match(elements.blindboxLeaderboard.innerHTML, /Old leader/);
  const result = await invokeBodyRoute(routes['POST /api/database/clear-gifts'], {
    giftSync: { clearRemote: async () => ({ deletedCounts: { gifts: 1 } }), rebuild() {} },
    data: { clearGifts() { perUser = []; return { gifts: 1 }; } },
    broadcastSnapshot(reason) { receive({ type: 'snapshot', reason: 'lyrics', reasons: [reason, 'lyrics'], state: { settings: {} } }); },
  }, { confirm: true });
  assert.equal(result.status, 200);
  assert.doesNotMatch(elements.blindboxLeaderboard.innerHTML, /Old leader/);
  clearedRead.resolve();
  await new Promise(setImmediate);
  assert.equal(reads, 2);
  assert.doesNotMatch(elements.blindboxLeaderboard.innerHTML, /Old leader/);
});

test('retention keeps the leader until refreshed and a source switch rejects that pending result', async () => {
  const { sandbox, api, elements } = await createOverlay();
  let message;
  sandbox.WebSocket = class {
    addEventListener(type, listener) { if (type === 'message') message = listener; }
  };
  const reads = [];
  sandbox.fetch = () => {
    const read = Promise.withResolvers();
    reads.push(name => read.resolve({ json: async () => ({ ok: true, data: {
      summary: {}, perUser: [{ userName: name, totalProfit: 1 }],
    } }) }));
    return read.promise;
  };
  function snapshot(reason, giftSourceEpoch) {
    message({ data: JSON.stringify({ type: 'snapshot', reason, state: { giftSourceEpoch, settings: {} } }) });
  }
  const leaderboard = elements.blindboxLeaderboard;
  api.connectSocket();
  snapshot('connect', 'source-A');
  reads[0]('First leader'); await new Promise(setImmediate);
  snapshot('gift:source', 'source-A');
  assert.match(leaderboard.innerHTML, /First leader/);
  reads[1]('Updated leader'); await new Promise(setImmediate);
  assert.match(leaderboard.innerHTML, /Updated leader/);

  snapshot('gift:source', 'source-A');
  snapshot('connect', 'source-B');
  assert.doesNotMatch(leaderboard.innerHTML, /Updated leader/);
  reads[2]('Late from A'); await new Promise(setImmediate);
  assert.doesNotMatch(leaderboard.innerHTML, /Late from A/);
  reads[3]('Leader B'); await new Promise(setImmediate);
  assert.match(leaderboard.innerHTML, /Leader B/);
  assert.equal(reads.length, 4);
});

test('blindbox refreshes share one pending request and read the last dirty update', async () => {
  const { sandbox, api, elements } = await createOverlay();
  const pending = [];
  sandbox.fetch = () => new Promise((resolve) => pending.push(resolve));
  const first = api.loadStats();
  for (let index = 0; index < 20; index++) assert.equal(api.loadStats(), first);
  assert.equal(pending.length, 1);
  pending[0]({ json: async () => ({ ok: true, data: { summary: {}, perUser: [{ userName: 'Old', totalProfit: 1 }] } }) });
  await new Promise(setImmediate);
  assert.equal(pending.length, 2);
  assert.doesNotMatch(elements.blindboxLeaderboard.innerHTML, /Old/);
  pending[1]({ json: async () => ({ ok: true, data: { summary: {}, perUser: [{ userName: 'Latest', totalProfit: 2 }] } }) });
  await first;
  assert.match(elements.blindboxLeaderboard.innerHTML, /Latest/);
});
