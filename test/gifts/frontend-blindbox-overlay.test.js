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
    { totalProfit: -12.345, text: '-¥12.35' },
    { totalProfit: 0, text: '+¥0.00' },
    { totalProfit: 12.345, text: '+¥12.35' },
  ];
  const perUser = cases.map(({ totalProfit }, index) => ({
    userName: `Viewer ${index + 1}`,
    boxCount: 1,
    totalProfit,
  }));

  for (const { totalProfit, text } of cases) {
    await t.test(`summary ${text} with mixed user profits`, () => {
      sandbox.render({
        summary: { boxCount: 3, totalCost: 75.25, totalProfit },
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
          summary: ['3', '¥75.25', text],
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
    sandbox.render({ summary: { boxCount: 12, totalCost: 300, totalProfit: 78 }, perUser });
    const names = [...elements.blindboxLeaderboard.innerHTML.matchAll(/Viewer-\d+/g)].map(([name]) => name);
    assert.deepEqual(names, perUser.slice(0, count).map(({ userName }) => userName), search);
    assert.match(elements.blindboxSummary.innerHTML, /\+¥78\.00/, search);
    if (count === 0) assert.equal(elements.blindboxLeaderboard.innerHTML, '', search);
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
  assert.match(styles, /\.blindbox-panel\.summary-only \.blindbox-header[\s\S]*?display:\s*none/);
  assert.doesNotMatch(source, /panel\.style\.overflow\s*=\s*['"]hidden['"]/);
  assert.match(source, /blindbox-viewport-resized/);
});
