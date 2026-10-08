'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readCssBundle } = require('../helpers/css-bundle');

const ROOT_DIR = path.join(__dirname, '../..');

test('admin gift styles load feature-owned stylesheets in order', () => {
  const giftEntry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'gifts.css'), 'utf8');

  assert.match(giftEntry, /@import url\('\.\/gifts\/recent\.css'\);/);
  assert.match(giftEntry, /@import url\('\.\/gifts\/blindbox-themes\.css'\);/);
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
      for (let index = 0; index < cards.length; index += 1) cards[index] = { hidden: false };
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

  const { giftRecent } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), sandbox);
  giftRecent.renderGiftRecentList(items);

  assert.equal(cards.filter((card) => !card.hidden).length, 18);

  gridTemplateColumns = '270px 270px';
  resizeCallback();
  assert.equal(cards.filter((card) => !card.hidden).length, 12);

  gridTemplateColumns = '270px 270px 270px 270px 270px';
  resizeCallback();
  assert.equal(cards.filter((card) => !card.hidden).length, 30);
});

test('recent gift cards render escaped metadata and retain blind-box timestamps and results', async () => {
  const list = { innerHTML: '', classList: { toggle() {} }, querySelectorAll: () => [] };
  const { giftRecent } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), {
    window: { getComputedStyle: () => ({ gridTemplateColumns: '1fr' }) },
    document: { getElementById: () => list },
  });
  const gift = {
    gift_name: '<花花>', user_name: '<观众>', num: 2, total_price: 20,
    created_at: new Date(2026, 9, 3, 12, 34, 56).toISOString(),
  };
  for (const isBlindBox of [false, true]) {
    giftRecent.renderGiftRecentList([{ ...gift, is_blind_box: isBlindBox, blind_profit: -3 }]);
    assert.ok(list.innerHTML.includes('&lt;花花&gt; x2'));
    assert.ok(list.innerHTML.includes('&lt;观众&gt;'));
    assert.ok(list.innerHTML.includes('计入 ¥20.00'));
    assert.ok(list.innerHTML.includes('12:34:56'));
    if (isBlindBox) assert.match(list.innerHTML, /class="profit-down">-¥3\.00</);
  }
});

test('recent guard gift cards preserve the three guard levels', async () => {
  const list = { innerHTML: '', classList: { toggle() {} }, querySelectorAll: () => [] };
  const { giftRecent } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), {
    window: { getComputedStyle: () => ({ gridTemplateColumns: '1fr' }) },
    document: { getElementById: () => list },
  });
  for (const [name, level] of [['总督', 1], ['提督', 2], ['舰长', 3]]) {
    giftRecent.renderGiftRecentList([{ gift_name: name, total_price: 1 }]);
    assert.match(list.innerHTML, new RegExp('\\bguard-' + level + '\\b'));
    assert.ok(list.innerHTML.includes('alt="' + name + '图标"'));
  }
});

test('recent blind box profit classes use the shared gain and loss color tokens', () => {
  // Rendered profit classes are asserted by the escaped-metadata test above and
  // frontend-recent-gifts-contract; this keeps their colors on the shared semantic tokens.
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');

  // Gain is green and loss is red, the same rule the overlays and the analysis workspace use.
  assert.match(styles, /\.gift-card\.blind-box-card \.profit-up\s*\{[^}]*color:\s*var\(--color-profit\)/);
  assert.match(styles, /\.gift-card\.blind-box-card \.profit-down\s*\{[^}]*color:\s*var\(--color-loss\)/);
  assert.match(styles, /\.gift-card\.blind-box-card \.profit-neutral\s*\{[^}]*color:\s*var\(--muted\)/);
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

  const { giftRecent } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), sandbox);
  await giftRecent.loadGiftArtworkCatalog();
  giftRecent.renderGiftRecentList([
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

  giftRecent.renderGiftRecentList([
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

  giftRecent.renderGiftRecentList([
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

  giftRecent.renderGiftRecentList([
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

  const { giftRecent: recent } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'),
    sandbox,
  );
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
  assert.doesNotMatch(list.innerHTML, /\/overtime-gift-images\/35792-old\.webp/);

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

  const { giftRecent } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), sandbox);
  await giftRecent.loadGiftArtworkCatalog();
  giftRecent.renderGiftRecentList([
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
  assert.equal((list.innerHTML.match(/\/overtime-gift-images\/35792\.webp/g) || []).length, 1);
});

test('recent blind-box icon names stay escaped at the HTML attribute boundary', async () => {
  const { escapeHtml } = await loadModuleExports(path.join(__dirname, '../../public/js/shared/utils.js'));
  const list = {
    innerHTML: '',
    classList: { toggle() {} },
    querySelectorAll: () => [],
  };
  const globals = {
    window: {
      AdminApp: {
        utils: { escapeHtml, formatTime: () => '', formatMoney: String },
      },
      getComputedStyle: () => ({ gridTemplateColumns: '270px' }),
    },
    document: { getElementById: () => list },
  };
  const { giftRecent: recent } = await loadModuleExports(
    path.join(__dirname, '../../public/js/admin/gifts/recent.js'),
    globals,
  );
  const names = [
    {
      raw: '自定义" data-audit-probe="name',
      escaped: '自定义&quot; data-audit-probe=&quot;name',
    },
    {
      raw: '"><span data-audit-probe="node"> & \'</span>',
      escaped: '&quot;&gt;&lt;span data-audit-probe=&quot;node&quot;&gt; &amp; &#39;&lt;/span&gt;',
    },
    {
      raw: '&quot; & < > \' "',
      escaped: '&amp;quot; &amp; &lt; &gt; &#39; &quot;',
    },
  ];

  for (const field of ['blind_box_name', 'name', 'gift_name']) {
    for (const { raw, escaped } of names) {
      const row = { is_blind_box: true, gift_name: '普通礼物', [field]: raw };
      recent.renderGiftRecentList([row]);

      assert.equal(recent.getBlindBoxIcon(row).name, raw);
      assert.equal(row[field], raw);
      assert.ok(
        list.innerHTML.includes(
          `<img class="gift-type-icon gift-blind-box-icon" src="/img/gift-placeholder.png" alt="${escaped}图标" title="${escaped}">`,
        ),
        `expected an escaped icon for ${field}: ${raw}`,
      );
      assert.doesNotMatch(list.innerHTML, /" data-audit-probe="/);
      assert.doesNotMatch(list.innerHTML, /<span data-audit-probe=/);
    }
  }
});
