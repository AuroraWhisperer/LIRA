'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');

const ROOT_DIR = path.join(__dirname, '../..');

function createOverlay(search = '') {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'blindbox.js');
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
  vm.runInNewContext(source, sandbox);
  return { sandbox, elements };
}

test('blindbox overlay renders signed summary and per-user profit text', async (t) => {
  const { sandbox, elements } = createOverlay();
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
      sandbox.render({
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

test('blindbox ranking renders all, summary-only and bounded audience counts from URL settings', () => {
  const perUser = Array.from({ length: 12 }, (_, index) => ({
    userName: `Viewer-${index + 1}`,
    boxCount: 1,
    totalProfit: 12 - index,
  }));
  for (const [search, count] of [
    ['?top=-1', 12], ['?top=0', 0], ['?top=1', 1], ['?top=10', 10],
    ['?top=25', 10], ['', 3], ['?top=invalid', 3], ['?t=2', 2],
  ]) {
    const { sandbox, elements } = createOverlay(search);
    sandbox.render({ summary: { boxCount: 12, totalCost: 300, totalValue: 378, totalProfit: 78 }, perUser });
    const names = [...elements.blindboxLeaderboard.innerHTML.matchAll(/Viewer-\d+/g)].map(([name]) => name);
    assert.deepEqual(names, perUser.slice(0, count).map(({ userName }) => userName), search);
    assert.match(elements.blindboxSummary.innerHTML, /\+¥78\.00/, search);
    if (count === 0) assert.equal(elements.blindboxLeaderboard.innerHTML, '', search);
  }
});

test('blindbox saved appearance updates existing sources while explicit legacy URL filters win', () => {
  for (const [search, expected] of [['', [6, true, true, true, false]], ['?top=2&winners=0&heartBox=0&c=0&ns=1', [2, false, false, false, true]]]) {
    const { sandbox } = createOverlay(search);
    vm.runInNewContext('state = { settings: { blindboxOverlayTop: "6", blindboxWinnersOnly: "true", blindboxHeartBoxOnly: "true", blindboxCompact: "true", blindboxAutoPages: "false" } }; receiveAppearance();', sandbox);
    assert.deepEqual(Array.from(vm.runInNewContext('[TOP_N, WINNERS_ONLY, HEART_BOX_ONLY, COMPACT, NO_SCROLL]', sandbox)), expected);
  }
});

test('blindbox filtering requests the selected box and hides losses only in winner mode', async () => {
  const perUser = [
    { userName: 'Winner', boxCount: 1, totalProfit: 8 },
    { userName: 'BreakEven', boxCount: 1, totalProfit: 0 },
    { userName: 'Loss', boxCount: 1, totalProfit: -2 },
  ];
  for (const search of ['', '?heartBox=1&winners=1']) {
    const { sandbox, elements } = createOverlay(search);
    const requests = [];
    sandbox.fetch = async (url) => {
      requests.push(url);
      return { json: async () => ({ ok: true, data: { summary: {}, perUser } }) };
    };
    await sandbox.loadStats();
    assert.deepEqual(requests, [
      '/api/gifts/blind-box-stats' + (search ? '?boxName=' + encodeURIComponent('心动盲盒') : ''),
    ]);
    assert.match(elements.blindboxLeaderboard.innerHTML, /Winner/);
    assert.equal(elements.blindboxLeaderboard.innerHTML.includes('BreakEven'), search === '');
    assert.equal(elements.blindboxLeaderboard.innerHTML.includes('Loss'), search === '');
  }
});

test('blindbox empty states distinguish unopened boxes from a filtered ranking without duplicate messages', () => {
  const emptyStats = { summary: { boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 }, perUser: [] };
  for (const search of ['', '?winners=1']) {
    const { sandbox, elements } = createOverlay(search);
    sandbox.render(emptyStats);
    assert.equal(elements.blindboxSummary.innerHTML, '');
    assert.match(elements.blindboxLeaderboard.innerHTML, /等待开盒/);

    sandbox.render({
      summary: { boxCount: 1, totalCost: 10, totalValue: 8, totalProfit: -2 },
      perUser: [{ userName: 'Viewer', boxCount: 1, totalProfit: -2 }],
    });
    assert.match(elements.blindboxSummary.innerHTML, /-¥2\.00/);
    assert.match(elements.blindboxLeaderboard.innerHTML, search ? /暂无盈利观众/ : /Viewer/);
    assert.doesNotMatch(elements.blindboxLeaderboard.innerHTML, /等待开盒/);

    sandbox.render(emptyStats);
    assert.equal(elements.blindboxSummary.innerHTML, '');
    assert.match(elements.blindboxLeaderboard.innerHTML, /等待开盒/);
  }

  const { sandbox, elements } = createOverlay('?top=0');
  sandbox.render(emptyStats);
  assert.match(elements.blindboxSummary.innerHTML, /\+¥0\.00/);
  assert.match(elements.blindboxSummary.innerHTML, /开出价值 <span class="stat-value">¥0\.00<\/span>/);
  assert.equal(elements.blindboxLeaderboard.innerHTML, '');
});

test('heart box activity shows independent options, preserves zero and updates without rebuilding the ranking', () => {
  const { sandbox, elements } = createOverlay('?heartBox=1');
  const stats = { summary: { boxCount: 3, totalCost: 45, totalValue: 30, totalProfit: -15 },
    perUser: [{ userName: '观众', boxCount: 3, totalProfit: -15 }], heartBoxProgress: { openedSinceCastle: 0 } };
  vm.runInNewContext('state = { settings: { blindboxCastleMultiplier: "2.5", blindboxShowCastlesRemaining: "true", blindboxCastlesRemaining: "0", blindboxShowOpenedSinceCastle: "true" } };', sandbox);
  sandbox.render(stats);
  assert.equal(elements.blindboxHeartProgress.hidden, false);
  assert.match(elements.blindboxHeartProgress.innerHTML, /今天 <strong>2\.5<\/strong> 倍堡/);
  assert.match(elements.blindboxHeartProgress.innerHTML, /还有 <strong>0<\/strong> 个堡/);
  assert.match(elements.blindboxHeartProgress.innerHTML, /已开 <strong>0<\/strong> 个盲盒/);
  Object.defineProperty(elements.blindboxLeaderboard, 'innerHTML', { set() { assert.fail('unchanged ranking rebuilt'); } });
  vm.runInNewContext('state.settings.blindboxCastleMultiplier = "3"; state.settings.blindboxShowCastlesRemaining = "false";', sandbox);
  sandbox.render(stats);
  assert.match(elements.blindboxHeartProgress.innerHTML, /今天 <strong>3<\/strong> 倍堡/);
  assert.doesNotMatch(elements.blindboxHeartProgress.innerHTML, /还有/);
  vm.runInNewContext('HEART_BOX_ONLY = false;', sandbox);
  sandbox.render(stats);
  assert.equal(elements.blindboxHeartProgress.hidden, true);
});

test('blindbox overlay fills the capture width and reflows without hiding data', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'blindbox.html'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'blindbox.css'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'blindbox.js'), 'utf8');

  assert.match(html, /<script type="module" src="\/js\/overlays\/blindbox\.js\?v=[^"]+"><\/script>/);
  assert.match(
    styles,
    /\.overlay-body\.blindbox-viewport-resized \.blindbox-panel\s*\{[\s\S]*?width:\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)/,
  );
  assert.doesNotMatch(styles, /\.box-count\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(styles, /\.profit-value\s*\{[^}]*display:\s*none/);
  assert.match(styles, /\.blindbox-panel\.summary-only \.overlay-title[\s\S]*?display:\s*none/);
  assert.doesNotMatch(source, /panel\.style\.overflow\s*=\s*['"]hidden['"]/);
  assert.match(source, /blindbox-viewport-resized/);
});
