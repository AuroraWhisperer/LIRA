'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('recent gifts build six visible rows and recover the latest records across grid and visibility changes', async () => {
  let columns = 3;
  let resize;
  const renders = [];
  const requests = [];
  const list = {
    classList: { toggle() {} }, querySelectorAll: () => [],
    set innerHTML(value) { renders.push([...value.matchAll(/class="gift-name" title="([^"]+)"/g)].map(match => match[1])); },
  };
  const { giftRecent } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), {
    AbortController,
    window: {
      async fetch(url) {
        requests.push(url);
        return { ok: true, json: async () => ({ ok: true, data: { gifts: [] } }) };
      },
      getComputedStyle: () => ({ gridTemplateColumns: Array(columns).fill('270px').join(' ') }),
      ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} disconnect() {} },
    },
    document: { getElementById: () => list },
  });
  const records = batch => Array.from({ length: 30 }, (_, i) => ({ gift_name: `${batch}-${i}` }));
  for (let i = 0; i < 20; i++) giftRecent.renderGiftRecentList(records(i));
  assert.equal(renders.flat().length, 360);
  await new Promise(setImmediate);
  resize();
  assert.equal(renders.length, 20, 'a height-only resize keeps the current cards');
  columns = 5;
  resize();
  assert.equal(renders.at(-1).at(-1), '19-29');
  columns = 1;
  resize();
  assert.equal(renders.at(-1).length, 6);
  giftRecent.setVisible(false);
  giftRecent.renderGiftRecentList(records(20));
  columns = 2;
  resize();
  assert.equal(renders.length, 22);
  giftRecent.setVisible(true);
  assert.equal(renders.at(-1).at(-1), '20-11');
  assert.deepEqual(requests, ['/api/overtime/gifts/catalog']);
});

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
    AbortController,
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

  const [{ giftRecent: recent }, { eventBus }, artwork] = await loadModuleExports([
    path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), path.join(ROOT_DIR, 'public/js/shared/event-bus.js'),
    path.join(ROOT_DIR, 'public/js/admin/gifts/artwork-catalog.js'),
  ],
    sandbox,
  );
  artwork.initGiftArtworkCatalog(recent.refreshArtwork);
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
  const initialPromise = artwork.loadGiftArtworkCatalog();

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
  const [{ giftRecent }, artwork] = await loadModuleExports([
    path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'),
    path.join(ROOT_DIR, 'public/js/admin/gifts/artwork-catalog.js'),
  ], {
    AbortController,
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
  await artwork.loadGiftArtworkCatalog();
  await artwork.loadGiftArtworkCatalog();
  assert.equal(requests, 1, 'a failed request must not cause a retry storm');
  now = 5000;
  giftRecent.renderGiftRecentList([{ gift_name: '测试礼物', total_price: 1 }]);
  await artwork.loadGiftArtworkCatalog();
  assert.equal(requests, 2, 'a later render retries the failed catalog');
  now = 10000;
  await artwork.loadGiftArtworkCatalog();
  assert.equal(requests, 2, 'an accepted empty catalog is a valid cache result');
});

test('recent blind-box icon names stay escaped at the HTML attribute boundary', async () => {
  const { escapeHtml } = await loadModuleExports(path.join(__dirname, '../../public/js/shared/html-escape.js'));
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
  const [{ giftRecent: recent }, { getBlindBoxIcon }] = await loadModuleExports([
    path.join(__dirname, '../../public/js/admin/gifts/recent.js'),
    path.join(__dirname, '../../public/js/admin/gifts/artwork-catalog.js'),
  ],
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

      assert.equal(getBlindBoxIcon(row).name, raw);
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

test('gift artwork lifecycle subscribes once and discards pending reads after disposal', async () => {
  const requests = [];
  let changes = 0;
  const [artwork, { eventBus }] = await loadModuleExports([
    path.join(ROOT_DIR, 'public/js/admin/gifts/artwork-catalog.js'),
    path.join(ROOT_DIR, 'public/js/shared/event-bus.js'),
  ], {
    AbortController,
    window: { fetch: (_url, { signal }) => {
      const request = Promise.withResolvers();
      requests.push({ ...request, signal });
      return request.promise;
    } },
  });
  assert.equal(requests.length, 0, 'importing an artwork reader does not initialize the catalog');
  const dispose = artwork.initGiftArtworkCatalog(() => { changes += 1; });
  artwork.initGiftArtworkCatalog(() => { changes += 1; });
  assert.equal(requests.length, 1);
  assert.equal(eventBus.listenerCount('gift:catalog_updated'), 1);
  const stale = artwork.loadGiftArtworkCatalog();
  dispose();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(eventBus.listenerCount('gift:catalog_updated'), 0);

  const finish = artwork.initGiftArtworkCatalog(() => { changes += 1; });
  const current = artwork.loadGiftArtworkCatalog();
  const payload = (image) => ({ ok: true, json: async () => ({ ok: true,
    data: { gifts: [{ id: '1', name: '礼物', imagePath: `/overtime-gift-images/${image}.webp` }] },
  }) });
  requests[0].resolve(payload('stale'));
  await stale;
  assert.equal(changes, 0);
  requests[1].resolve(payload('current'));
  await current;
  assert.equal(changes, 1);
  assert.equal(artwork.getGiftToastArtwork({ gift_id: '1', gift_name: '礼物' }), '/overtime-gift-images/current.webp');
  finish();
  eventBus.emit('gift:catalog_updated', { snapshot: { gifts: [] } });
  assert.equal(changes, 1);
});

test('recent blind-box combo batch renders cards in first-seen ascending id order while preserving outer descending order', async () => {
  const list = { innerHTML: '', classList: { toggle() {} }, querySelectorAll: () => [] };
  const { giftRecent } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gifts/recent.js'), {
    window: { getComputedStyle: () => ({ gridTemplateColumns: '1fr 1fr 1fr 1fr' }) },
    document: { getElementById: () => list },
  });
  const comboTime = '2026-11-28T06:10:41.000Z';
  giftRecent.renderGiftRecentList([
    {
      id: 200,
      gift_name: '粉丝团灯牌',
      user_name: '示例观众',
      num: 4,
      total_price: 0.4,
      is_blind_box: false,
      created_at: '2026-11-28T06:11:25.000Z',
    },
    {
      id: 104,
      uid: '2002',
      user_name: '示例观众',
      gift_name: '花束',
      num: 1,
      is_blind_box: true,
      blind_box_id: '35206',
      created_at: comboTime,
    },
    {
      id: 103,
      gift_name: '花园',
      uid: '1001',
      user_name: '示例观众',
      num: 1,
      total_price: 5.2,
      is_blind_box: true,
      blind_box_id: '35206',
      blind_box_name: '幸运盲盒',
      blind_profit: 0.2,
      created_at: comboTime,
    },
    {
      id: 102,
      gift_name: '柚叶',
      uid: '1001',
      user_name: '示例观众',
      num: 1,
      total_price: 5.2,
      is_blind_box: true,
      blind_box_id: '35206',
      blind_box_name: '幸运盲盒',
      blind_profit: 0.2,
      created_at: comboTime,
    },
    {
      id: 101,
      gift_name: '星光铃铛',
      uid: '1001',
      user_name: '示例观众',
      num: 2,
      total_price: 10.4,
      is_blind_box: true,
      blind_box_id: '35206',
      blind_box_name: '幸运盲盒',
      blind_profit: 0.4,
      created_at: comboTime,
    },
    {
      id: 90,
      gift_name: '人气票',
      user_name: '另一位观众',
      num: 1,
      total_price: 0.1,
      is_blind_box: false,
      created_at: '2026-11-28T05:53:21.000Z',
    },
  ]);
  const titles = [...list.innerHTML.matchAll(/<div class="gift-name"[^>]*>([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(titles, [
    '粉丝团灯牌 x4',
    '花束 x1',
    '星光铃铛 x2',
    '柚叶 x1',
    '花园 x1',
    '人气票 x1',
  ]);
});
