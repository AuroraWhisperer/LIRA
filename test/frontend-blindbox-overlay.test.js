'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');

const ROOT_DIR = path.join(__dirname, '..');

test('blindbox overlay renders signed summary and per-user profit text', async (t) => {
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
    location: { search: '' },
    document: {
      addEventListener() {},
      getElementById: (id) => elements[id],
      querySelector: () => panel,
      documentElement: { style: { setProperty() {} } },
    },
  };
  vm.runInNewContext(source, sandbox);

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
        ...elements.blindboxSummary.innerHTML.matchAll(
          /<span class="stat-value">([^<]*)<\/span>/g,
        ),
      ].map((match) => match[1]);
      const userText = [
        ...elements.blindboxLeaderboard.innerHTML.matchAll(
          /<span class="profit-value [^"]*">([^<]*)<\/span>/g,
        ),
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

test('blindbox overlay fills the capture width and reflows without hiding data', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'blindbox.html'),
    'utf8',
  );
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'overlays', 'blindbox.css'),
    'utf8',
  );
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'blindbox.js'),
    'utf8',
  );
  const panelRule = styles.match(/\.blindbox-panel\s*\{[\s\S]*?\n\}/)?.[0];

  assert.match(
    html,
    /<script type="module" src="\/js\/overlays\/blindbox\.js\?v=[^"]+"><\/script>/,
  );
  assert.ok(panelRule, 'blindbox panel styles should remain defined');
  assert.doesNotMatch(html, /blindbox-live-status|>实时</);
  assert.doesNotMatch(styles, /blindbox-live-status/);
  assert.match(panelRule, /width:\s*420px/);
  assert.match(panelRule, /margin:\s*var\(--overlay-edge\)/);
  assert.match(
    styles,
    /\.overlay-body\.blindbox-viewport-resized \.blindbox-panel\s*\{[\s\S]*?width:\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)/,
  );
  assert.match(panelRule, /container-type:\s*inline-size/);
  assert.match(
    styles,
    /@container \(min-width: 680px\)[\s\S]*?grid-template-columns:\s*minmax\(240px, 0\.8fr\) minmax\(360px, 1\.35fr\)/,
  );
  assert.match(
    styles,
    /@container \(max-width: 259px\)[\s\S]*?grid-template-areas:\s*["']rank user user["']\s*["']rank count profit["']/,
  );
  assert.doesNotMatch(styles, /\.box-count\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(styles, /\.profit-value\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(source, /panel\.style\.overflow\s*=\s*['"]hidden['"]/);
  assert.match(source, /initialBlindboxViewportWidth\s*=\s*window\.innerWidth/);
  assert.match(source, /blindbox-viewport-resized/);
});
