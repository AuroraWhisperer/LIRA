'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT_DIR = path.join(__dirname, '..');

test('gift audit page loads dedicated assets without inline behavior', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'gift-audit.html'),
    'utf8',
  );
  const entrySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'gift-audit', 'index.js'),
    'utf8',
  );

  assert.match(
    html,
    /<link\s+rel="stylesheet"\s+href="\/css\/gift-audit\.css\?v=[^"]+"\s*\/?>/,
  );
  assert.match(
    html,
    /<script type="module" src="\/js\/gift-audit\/index\.js\?v=[^"]+"><\/script>/,
  );
  assert.doesNotMatch(html, /<style>/);
  assert.doesNotMatch(html, /\sonclick=/);
  assert.match(entrySource, /from '\.\/analysis\.js';/);
  assert.match(entrySource, /from '\.\/view\.js';/);
});

test('packaged frontend excludes the retired gift debug page and links', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'gift-audit.html'),
    'utf8',
  );
  const view = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'gift-audit', 'view.js'),
    'utf8',
  );

  assert.equal(
    fs.existsSync(path.join(ROOT_DIR, 'public', 'pages', 'debug-gifts.html')),
    false,
  );
  assert.doesNotMatch(html, /debug-gifts/);
  assert.doesNotMatch(view, /debug-gifts/);
});

test('gift audit analysis parses bubbles without browser dependencies', async () => {
  const { parseBubbleHtml } = await loadAnalysisModule();
  const gifts = parseBubbleHtml(`
    <div class="bubble-list">
      <div class="super-gift-item">
        <div class="user-name">示例用户</div>
        <span class="gift-name">粉丝团灯牌</span>
        <div class="gift-frame gift-31164-50"></div>
        <div class="numbers">
          <span class="number number-1"></span>
          <span class="number number-5"></span>
        </div>
      </div>
    </div>
  `);

  assert.deepEqual(toPlain(gifts), [
    {
      userName: '示例用户',
      giftName: '粉丝团灯牌',
      giftId: '31164',
      comboCount: 15,
    },
  ]);
});

test('gift audit analysis separates matches, misses, and server-only gifts', async () => {
  const { crossReference } = await loadAnalysisModule();
  const captureTime = Date.parse('2026-08-14T12:00:00.000Z');
  const results = crossReference(
    [
      {
        userName: '用户A',
        giftName: '粉丝团灯牌',
        giftId: '31164',
        comboCount: 2,
      },
      { userName: '用户B', giftName: '小花花', giftId: '1', comboCount: 1 },
    ],
    [
      {
        id: 'gift-1',
        user_name: '用户A',
        gift_name: '粉丝团灯牌',
        gift_id: 31164,
        num: 2,
        total_price: 0.2,
        created_at: '2026-08-14T12:00:00.000Z',
      },
      {
        id: 'gift-2',
        user_name: '用户C',
        gift_name: '辣条',
        gift_id: 2,
        num: 1,
        total_price: 0.1,
        created_at: '2026-08-14T12:00:00.000Z',
      },
    ],
    captureTime,
  );

  assert.deepEqual(
    toPlain(
      results.map(({ source, userName, status }) => ({
        source,
        userName,
        status,
      })),
    ),
    [
      { source: 'bubble', userName: '用户A', status: 'match' },
      { source: 'bubble', userName: '用户B', status: 'miss' },
      { source: 'server', userName: '用户C', status: 'extra' },
    ],
  );
});

async function loadAnalysisModule() {
  const filePath = path.join(
    ROOT_DIR,
    'public',
    'js',
    'gift-audit',
    'analysis.js',
  );
  const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
    context: vm.createContext({}),
    identifier: pathToFileURL(filePath).href,
  });
  await module.link(() => {
    throw new Error('analysis.js must remain dependency-free');
  });
  await module.evaluate();
  return module.namespace;
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}
