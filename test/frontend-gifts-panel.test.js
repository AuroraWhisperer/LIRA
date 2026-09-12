'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const heartBox = require('../../lira-server/test/fixtures/heart-blind-box-events.json');

test('recent blind-box icon names stay escaped at the HTML attribute boundary', async () => {
  const { escapeHtml } = await loadModuleExports(
    path.join(__dirname, '../public/js/shared/utils.js'),
  );
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
  await loadModuleExports(
    path.join(__dirname, '../public/js/admin/gifts/recent.js'),
    globals,
  );
  const recent = globals.window.AdminApp.gifts.recent;
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
          `<img class="gift-type-icon gift-blind-box-icon" src="/img/overtime-machine/gift-placeholder.svg" alt="${escaped}图标" title="${escaped}">`,
        ),
        `expected an escaped icon for ${field}: ${raw}`,
      );
      assert.doesNotMatch(list.innerHTML, /" data-audit-probe="/);
      assert.doesNotMatch(list.innerHTML, /<span data-audit-probe=/);
    }
  }
});

test('gift panel renders empty and populated recent gifts without legacy history registration', async (t) => {
  const list = {
    innerHTML: '',
    classList: { toggle: t.mock.fn() },
    querySelectorAll: () => [],
  };
  const gifts = {
    notification: { notifyNewGift: t.mock.fn() },
    detection: { renderDetectionStatus() {}, renderGiftStatusLine() {} },
    sprint: { renderSprintStats() {} },
    blindbox: { renderBlindBoxList() {} },
  };
  const globals = {
    console: { error: t.mock.fn() },
    window: {
      AdminApp: {
        gifts,
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: (value) => String(value),
          formatMoney: (value) => String(value),
        },
      },
      getComputedStyle: () => ({ gridTemplateColumns: '270px 270px' }),
    },
    document: {
      getElementById: (id) => (id === 'giftRecentList' ? list : null),
    },
  };
  const moduleDir = path.join(
    __dirname,
    '..',
    'public',
    'js',
    'admin',
    'gifts',
  );
  await loadModuleExports(path.join(moduleDir, 'recent.js'), globals);
  await loadModuleExports(path.join(moduleDir, 'index.js'), globals);

  assert.equal(gifts.history, undefined);
  gifts.renderGiftPanel({ recent: [] }, {}, {}, {});

  assert.match(list.innerHTML, /class="empty gift-recent-empty"/);
  assert.deepEqual(
    [...list.classList.toggle.mock.calls.at(-1).arguments],
    ['is-empty', true],
  );

  const items = [
    {
      gift_name: 'Example gift',
      user_name: 'Test viewer',
      num: 2,
      total_price: 10,
      created_at: '2026-09-05T12:00:00.000Z',
    },
  ];
  gifts.renderGiftPanel({ recent: items }, {}, {}, {});

  assert.match(list.innerHTML, /class="gift-card-content"/);
  assert.match(list.innerHTML, /Example gift x2/);
  assert.match(list.innerHTML, /Test viewer/);
  assert.doesNotMatch(list.innerHTML, /gift-recent-empty/);
  assert.deepEqual(
    [...list.classList.toggle.mock.calls.at(-1).arguments],
    ['is-empty', false],
  );
  assert.equal(gifts.notification.notifyNewGift.mock.callCount(), 2);
  assert.equal(
    gifts.notification.notifyNewGift.mock.calls.at(-1).arguments[0],
    items,
  );
  assert.equal(globals.console.error.mock.callCount(), 0);
});

test('heart-box output cards show source artwork and signed profit even without a source name', async () => {
  const list = { innerHTML: '', classList: { toggle() {} }, querySelectorAll: () => [] };
  const globals = {
    window: {
      AdminApp: { utils: {
        escapeHtml: (value) => String(value),
        formatTime: () => '12:00:00',
        formatMoney: (value) => `¥${Number(value).toFixed(2)}`,
      } },
      fetch: async () => ({ ok: true, json: async () => ({ ok: true, data: { gifts: [
        { id: heartBox.box.id, imagePath: '/overtime-gift-images/32251.webp' },
        ...heartBox.outputs.map(item => ({ id: item.id, imagePath: `/overtime-gift-images/${item.id}.webp` })),
      ] } }) }),
      getComputedStyle: () => ({ gridTemplateColumns: '270px' }),
    },
    document: { getElementById: () => list },
  };
  await loadModuleExports(path.join(__dirname, '../public/js/admin/gifts/recent.js'), globals);
  const recent = globals.window.AdminApp.gifts.recent;
  await recent.loadGiftArtworkCatalog();
  for (const name of [heartBox.box.name, '']) {
    for (const item of heartBox.outputs) {
      const row = { gift_id: item.id, gift_name: item.name, num: 1,
        is_blind_box: true, blind_box_id: heartBox.box.id, blind_box_name: name,
        total_price: item.rmb, blind_box_price: heartBox.box.rmb, blind_profit: item.profit };
      recent.renderGiftRecentList([row]);
      assert.match(list.innerHTML, /blind-box-card blind-box-heart/);
      assert.match(list.innerHTML, /src="\/overtime-gift-images\/32251.webp"/);
      assert.ok(!list.innerHTML.includes(`/overtime-gift-images/${item.id}.webp`));
      assert.match(list.innerHTML, item.profit < 0
        ? /class="profit-down">-¥6\.00<\/span>/
        : /class="profit-up">\+¥1\.00<\/span>/);
      assert.ok(list.innerHTML.includes(`计入 ¥${item.rmb.toFixed(2)}`));
    }
  }
  recent.renderGiftRecentList([{ gift_id: '32126', gift_name: '棉花糖', num: 1,
    is_blind_box: true, blind_box_id: heartBox.box.id, blind_box_name: heartBox.box.name,
    total_price: 9, blind_box_price: null, blind_profit: null }]);
  assert.match(list.innerHTML, /盈亏待确认/);
  assert.doesNotMatch(list.innerHTML, /profit-neutral.*¥0\.00/);
});
