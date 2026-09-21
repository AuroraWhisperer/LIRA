'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.join(__dirname, '..');

test('recent gift cards keep a wider responsive minimum width', () => {
  const source = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const giftCardsRule = source.match(
    /\.gift-page \.panel-body \.gift-cards\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(giftCardsRule, 'gift card layout styles should remain defined');
  assert.match(
    giftCardsRule,
    /grid-template-columns:\s*repeat\(auto-fill, minmax\(270px, 1fr\)\)/,
  );
});

test('admin gift styles load feature-owned stylesheets in order', () => {
  const giftEntry = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'gifts.css'),
    'utf8',
  );

  assert.match(giftEntry, /@import url\('\.\/gifts\/recent\.css'\);/);
});

test('recent gift cards stay within six rows as the grid width changes', async () => {
  const cards = [];
  let gridTemplateColumns = '270px 270px 270px';
  let resizeCallback;
  const list = {
    classList: { toggle() {} },
    querySelectorAll: (selector) => (selector === '.gift-card' ? cards : []),
    set innerHTML(value) {
      cards.length = (value.match(/class="gift-card/g) ?? []).length;
      for (let index = 0; index < cards.length; index += 1)
        cards[index] = { hidden: false };
    },
  };
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: (value) => String(value),
          formatMoney: (value) => String(value),
        },
      },
      getComputedStyle: () => ({ gridTemplateColumns }),
      ResizeObserver: class {
        constructor(callback) {
          resizeCallback = callback;
        }
        observe() {}
      },
    },
    document: { getElementById: () => list },
  };
  const items = Array.from({ length: 30 }, (_, index) => ({
    gift_name: `Gift ${index + 1}`,
    user_name: 'Viewer',
    total_price: 1,
    created_at: index,
  }));

  await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), sandbox);
  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList(items);

  assert.equal(cards.filter((card) => !card.hidden).length, 18);

  gridTemplateColumns = '270px 270px';
  resizeCallback();
  assert.equal(cards.filter((card) => !card.hidden).length, 12);

  gridTemplateColumns = '270px 270px 270px 270px 270px';
  resizeCallback();
  assert.equal(cards.filter((card) => !card.hidden).length, 30);
});

test('recent gift cards reserve artwork space and keep metadata in named slots', () => {
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');

  assert.match(script, /class="gift-card-content"/);
  assert.match(script, /class="gift-user"/);
  assert.match(script, /class="gift-amount"/);
  assert.match(script, /class="gift-result/);
  assert.match(script, /class="gift-time"/);
  assert.doesNotMatch(
    script,
    /item\.is_blind_box \? '' : `<span>\$\{formatTime/,
  );
  assert.match(
    styles,
    /\.gift-card\.has-type-icon\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 52px/,
  );
  assert.match(
    styles,
    /\.gift-card \.gift-meta\s*\{[\s\S]*?grid-template-areas:/,
  );
  assert.match(
    styles,
    /\.gift-card \.gift-type-icon\s*\{[\s\S]*?position:\s*static/,
  );
});

test('recent guard gift cards use subtle matching guard level colors', () => {
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');

  assert.match(script, /guard-card guard-\$\{guardBadge\.level\}/);
  assert.match(script, /name:\s*['"]总督['"],\s*level:\s*1/);
  assert.match(script, /name:\s*['"]提督['"],\s*level:\s*2/);
  assert.match(script, /name:\s*['"]舰长['"],\s*level:\s*3/);
  assert.match(
    styles,
    /\.gift-card\.guard-card\.guard-1\s*\{[^}]*border-left-color:\s*#f25f72[^}]*background:\s*linear-gradient/,
  );
  assert.match(
    styles,
    /\.gift-card\.guard-card\.guard-2\s*\{[^}]*border-left-color:\s*#8d67e8[^}]*background:\s*linear-gradient/,
  );
  assert.match(
    styles,
    /\.gift-card\.guard-card\.guard-3\s*\{[^}]*border-left-color:\s*#4b91e8[^}]*background:\s*linear-gradient/,
  );
  assert.doesNotMatch(
    styles,
    /\.gift-card\.guard-card\s*\{[^}]*color:\s*var\(--color-bg-primary\)/,
  );
});

test('recent blind box cards keep heart and lucky colors and default all others to purple', () => {
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');

  assert.match(
    script,
    /profitClass\s*=\s*blindProfit\s*>\s*0\s*\?\s*['"]profit-up['"]\s*:\s*blindProfit\s*<\s*0\s*\?\s*['"]profit-down['"]\s*:\s*['"]profit-neutral['"]/,
  );
  assert.match(script, /className: 'blind-box-heart'/);
  assert.match(script, /className: 'blind-box-lucky'/);
  assert.match(script, /className: type\?\.className \|\| 'blind-box-default'/);
  assert.doesNotMatch(script, /className: 'blind-box-(?:bear|qixi|bond)'/);
  assert.doesNotMatch(script, /\/img\/bilibili-gifts/);
  assert.match(
    styles,
    /\.gift-card\.blind-box-card\.blind-box-heart\s*\{[^}]*border-left-color:\s*#f3a2aa/,
  );
  assert.match(
    styles,
    /\.gift-card\.blind-box-card\.blind-box-lucky\s*\{[^}]*border-left-color:\s*#b8d983/,
  );
  assert.match(
    styles,
    /\.gift-card\.blind-box-card\.blind-box-default\s*\{[^}]*border-left-color:\s*#8459c7[^}]*background:\s*linear-gradient/,
  );
  assert.match(
    styles,
    /\.gift-card\.blind-box-card \.profit-up\s*\{[^}]*color:\s*#c0392b/,
  );
  assert.match(
    styles,
    /\.gift-card\.blind-box-card \.profit-down\s*\{[^}]*color:\s*#21b6a8/,
  );
  assert.match(
    styles,
    /\.gift-card\.blind-box-card \.profit-neutral\s*\{[^}]*color:\s*#647181/,
  );
});

test('same-name 七夕鹊匣 gift card uses server artwork for its exact ID', async () => {
  const list = {
    classList: { toggle() {} },
    querySelectorAll: () => [],
    innerHTML: '',
  };
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: (value) => String(value),
          formatMoney: (value) => String(value),
        },
      },
      fetch: async (url) => {
        assert.equal(url, '/api/overtime/gifts/catalog');
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              gifts: [
                {
                  id: '35786',
                  name: '七夕鹊匣',
                  imagePath: '/overtime-gift-images/35786.webp',
                },
                {
                  id: '45786',
                  name: '七夕鹊匣',
                  imagePath: '/overtime-gift-images/45786.webp',
                },
              ],
            },
          }),
        };
      },
      getComputedStyle: () => ({ gridTemplateColumns: '270px' }),
    },
    document: { getElementById: () => list },
  };

  await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), sandbox);
  await sandbox.window.AdminApp.gifts.recent.loadGiftArtworkCatalog();
  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    {
      gift_id: '45786',
      gift_name: '七夕鹊匣',
      user_name: 'Alice',
      num: 1,
      unit_price: 25,
      total_price: 25,
      is_blind_box: true,
      blind_box_price: 25,
    },
  ]);

  assert.match(list.innerHTML, /blind-box-card blind-box-default/);
  assert.match(list.innerHTML, /\/overtime-gift-images\/45786\.webp/);
  assert.doesNotMatch(list.innerHTML, /\/overtime-gift-images\/35786\.webp/);

  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    {
      gift_id: '99999',
      gift_name: '盲盒产物',
      blind_box_id: '35786',
      blind_box_name: '七夕鹊匣',
      user_name: 'Alice',
      num: 1,
      unit_price: 1,
      total_price: 1,
      is_blind_box: true,
      blind_box_price: 25,
    },
  ]);
  assert.match(list.innerHTML, /\/overtime-gift-images\/35786\.webp/);

  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    {
      gift_id: '99999',
      gift_name: '七夕鹊匣',
      user_name: 'Alice',
      num: 1,
      unit_price: 25,
      total_price: 25,
      is_blind_box: true,
      blind_box_price: 25,
    },
  ]);
  assert.match(list.innerHTML, /\/img\/gift-placeholder\.png/);
  assert.doesNotMatch(list.innerHTML, /\/overtime-gift-images\/35786\.webp/);

  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    {
      gift_id: '35786',
      gift_name: '七夕鹊匣产物',
      user_name: 'Alice',
      num: 1,
      unit_price: 1,
      total_price: 1,
      is_blind_box: false,
      blind_box_id: null,
    },
  ]);
  assert.doesNotMatch(list.innerHTML, /blind-box-card/);
});

test('recent gift artwork refreshes from live catalog events without a slow fetch rollback', async () => {
  const list = {
    classList: { toggle() {} },
    querySelectorAll: () => [],
    innerHTML: '',
  };
  let resolveFetch;
  const fetchPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: (value) => String(value),
          formatMoney: (value) => String(value),
        },
      },
      fetch: () => fetchPromise,
      getComputedStyle: () => ({ gridTemplateColumns: '270px' }),
    },
    document: { getElementById: () => list },
  };

  await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), sandbox);
  const recent = sandbox.window.AdminApp.gifts.recent;
  recent.renderGiftRecentList([
    {
      gift_id: '35792',
      gift_name: '宸星定情',
      user_name: 'Alice',
      num: 1,
      unit_price: 1200,
      total_price: 1200,
    },
  ]);
  const initialPromise = recent.loadGiftArtworkCatalog();

  sandbox.window.AdminApp.eventBus.emit('gift:catalog_updated', {
    snapshot: {
      source: 'server',
      version: 'v2',
      gifts: [
        {
          id: '35792',
          name: '宸星定情',
          imagePath: '/overtime-gift-images/35792-new.webp',
        },
      ],
    },
  });
  assert.match(list.innerHTML, /\/overtime-gift-images\/35792-new\.webp/);

  resolveFetch({
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        gifts: [
          {
            id: '35792',
            name: '宸星定情',
            imagePath: '/overtime-gift-images/35792-old.webp',
          },
        ],
      },
    }),
  });
  await initialPromise;

  assert.match(list.innerHTML, /\/overtime-gift-images\/35792-new\.webp/);
  assert.doesNotMatch(
    list.innerHTML,
    /\/overtime-gift-images\/35792-old\.webp/,
  );

  sandbox.window.AdminApp.eventBus.emit('gift:catalog_updated', {
    snapshot: {
      source: 'server',
      version: 'v3',
      gifts: [
        {
          id: '35792',
          name: '宸星定情',
          imagePath: 'https://example.test/gift.webp',
        },
      ],
    },
  });
  assert.match(list.innerHTML, /\/overtime-gift-images\/35792-new\.webp/);
});

test('recent gift totals worth at least 1000 RMB use gold while unit-value artwork comes from the catalog', async () => {
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');
  const list = {
    classList: { toggle() {} },
    querySelectorAll: () => [],
    innerHTML: '',
  };
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: (value) => String(value),
          formatMoney: (value) => String(value),
        },
      },
      fetch: async (url) => {
        assert.equal(url, '/api/overtime/gifts/catalog');
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              gifts: [
                {
                  id: '35792',
                  name: '宸星定情',
                  imagePath: '/overtime-gift-images/35792.webp',
                },
              ],
            },
          }),
        };
      },
      getComputedStyle: () => ({ gridTemplateColumns: '270px' }),
    },
    document: { getElementById: () => list },
  };

  await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), sandbox);
  await sandbox.window.AdminApp.gifts.recent.loadGiftArtworkCatalog();
  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    {
      gift_id: '35792',
      gift_name: '宸星定情',
      user_name: 'Alice',
      num: 1,
      unit_price: 1200,
      total_price: 1200,
    },
    {
      gift_id: '35792',
      gift_name: '宸星定情',
      user_name: 'Bob',
      num: 2,
      unit_price: 600,
      total_price: 1200,
    },
  ]);

  assert.equal((list.innerHTML.match(/high-value-gift-card/g) || []).length, 2);
  assert.equal((list.innerHTML.match(/gift-high-value-icon/g) || []).length, 1);
  assert.equal(
    (list.innerHTML.match(/\/overtime-gift-images\/35792\.webp/g) || []).length,
    1,
  );
  assert.doesNotMatch(script, /HIGH_VALUE_GIFT_ARTWORK/);
  assert.match(
    styles,
    /\.gift-card\.high-value-gift-card\s*\{[\s\S]*?background:\s*linear-gradient\(90deg/,
  );
  assert.match(
    styles,
    /\.gift-card \.gift-high-value-icon\s*\{[\s\S]*?object-fit:\s*contain/,
  );
});
