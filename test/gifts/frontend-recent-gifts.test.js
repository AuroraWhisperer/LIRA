'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('recent gift cards render escaped metadata and retain blind-box results', async () => {
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
    if (isBlindBox) assert.match(list.innerHTML, /class="profit-down">-¥3\.00</);
  }
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

  const [{ giftRecent: recent }, { eventBus }] = await loadModuleExports([
    path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), path.join(ROOT_DIR, 'public/js/shared/event-bus.js'),
  ],
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

  eventBus.emit('gift:catalog_updated', {
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

  eventBus.emit('gift:catalog_updated', {
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

test('failed gift artwork reads can retry after a bounded delay and valid empty catalogs stay cached', async () => {
  let now = 0;
  let requests = 0;
  const list = { classList: { toggle() {} }, querySelectorAll: () => [], innerHTML: '' };
  const { giftRecent } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), {
    Date: class extends Date { static now() { return now; } },
    console: { warn() {} },
    window: {
      getComputedStyle: () => ({ gridTemplateColumns: '270px' }),
      fetch: async () => {
        if (++requests === 1) throw new Error('offline');
        return { ok: true, json: async () => ({ ok: true, data: { gifts: [] } }) };
      },
    },
    document: { getElementById: () => list },
  });
  await giftRecent.loadGiftArtworkCatalog();
  await giftRecent.loadGiftArtworkCatalog();
  assert.equal(requests, 1, 'a failed request must not cause a retry storm');
  now = 5000;
  giftRecent.renderGiftRecentList([{ gift_name: '测试礼物', total_price: 1 }]);
  await giftRecent.loadGiftArtworkCatalog();
  assert.equal(requests, 2, 'a later render retries the failed catalog');
  now = 10000;
  await giftRecent.loadGiftArtworkCatalog();
  assert.equal(requests, 2, 'an accepted empty catalog is a valid cache result');
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
        list.innerHTML.includes(`alt="${escaped}图标" title="${escaped}"`),
        `expected an escaped icon for ${field}: ${raw}`,
      );
      assert.doesNotMatch(list.innerHTML, /" data-audit-probe="/);
      assert.doesNotMatch(list.innerHTML, /<span data-audit-probe=/);
    }
  }
});
