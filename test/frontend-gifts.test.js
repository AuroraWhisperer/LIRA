'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('./helpers/css-bundle');
const { loadModuleExports, response } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('gift workspace avoids a redundant page heading and exposes nine semantic panel titles', () => {
  const page = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'gifts', 'page.html'),
    'utf8',
  );
  const styles = [
    readCssBundle('public', 'css', 'admin', 'gifts.css'),
    readCssBundle('public', 'css', 'admin', 'workspace.css'),
  ].join('\n');

  assert.doesNotMatch(page, /<h1 class="ui-page-title">礼物<\/h1>/);
  assert.equal(
    (page.match(/class="gift-section-title ui-section-title"/g) || []).length,
    9,
  );
  assert.match(styles, /\.gift-recent-heading \.gift-section-title\s*\{/);
  assert.match(styles, /\.blind-stats-heading \.gift-section-title\s*\{/);
  assert.doesNotMatch(
    styles,
    /\.(?:gift-recent-heading|blind-stats-heading) h3\s*\{/,
  );
  assert.match(
    styles,
    /\.app-shell \.gift-page \.panel-header h2\s*\{[\s\S]*?font-size:\s*var\(--type-size-section-title\)/,
  );
});

test('admin blind box summary shows one row per viewer and opens analysis', () => {
  const html = readAdminHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'),
    'utf8',
  );

  assert.match(html, /id="blindBoxAnalysisOpenBtn"/);
  assert.match(html, /title="查看完整盲盒分析"/);
  assert.match(html, /<th>观众<\/th>\s*<th>盒数<\/th>\s*<th>盒型<\/th>/);
  assert.match(
    html,
    /<th>总成本<\/th>\s*<th>开出价值<\/th>\s*<th>观众盈亏<\/th>/,
  );
  assert.doesNotMatch(html, /id="blindBoxStatsTable"[\s\S]*?<th>时间<\/th>/);
  assert.match(source, /const users = Array\.isArray\(perUser\)/);
  assert.match(source, /data-viewer=/);
  assert.match(source, /analysis\?\.open/);
  assert.match(source, /closest\('#blindBoxAnalysisOpenBtn'/);
});

test('blind box summary refreshes on gift events and coalesces in-flight updates', async () => {
  const { EventBus } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'event-bus.js'),
  );
  const section = { dataset: {}, querySelector: () => null };
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
  await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'),
    {
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
    },
  );
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
  assert.equal(section.dataset.state, 'empty');

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
  assert.equal(section.dataset.state, 'ready');
  assert.match(summary.innerHTML, /<strong>48\.00<\/strong>/);
  assert.match(summary.innerHTML, /<strong>49\.00<\/strong>/);
  assert.match(summary.innerHTML, /<strong>\+1\.00<\/strong>/);
  assert.match(body.innerHTML, /Test viewer/);
  assert.match(body.innerHTML, /<td>2<\/td>/);

  window.AdminApp.gifts.blindbox.initBlindBoxStatsToggle();
  assert.equal(eventBus.listenerCount('gift:received'), 1);
  assert.equal(statsRequests, 3);
  eventBus.emit('gift:received', { reason: 'database:clear-gifts' });
  assert.equal(statsRequests, 4);
  await finishRequest(empty);
  assert.equal(section.dataset.state, 'empty');
  assert.doesNotMatch(body.innerHTML, /Test viewer/);
});
