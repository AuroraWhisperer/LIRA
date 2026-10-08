'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readServerFixture } = require('../../scripts/verify-server-contract');
const heartBox = readServerFixture('test/fixtures/heart-blind-box-events.json');

test('heart-box output cards require source identity evidence for artwork and preserve signed profit', async () => {
  const list = {
    innerHTML: '',
    classList: { toggle() {} },
    querySelectorAll: () => [],
  };
  const globals = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: () => '12:00:00',
          formatMoney: (value) => `¥${Number(value).toFixed(2)}`,
        },
      },
      fetch: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            gifts: [
              {
                id: heartBox.box.id,
                name: heartBox.box.name,
                imagePath: '/overtime-gift-images/32251.webp',
              },
              ...heartBox.outputs.map((item) => ({
                id: item.id,
                name: item.name,
                imagePath: `/overtime-gift-images/${item.id}.webp`,
              })),
            ],
          },
        }),
      }),
      getComputedStyle: () => ({ gridTemplateColumns: '270px' }),
    },
    document: { getElementById: () => list },
  };
  const { giftRecent: recent } = await loadModuleExports(
    path.join(__dirname, '../../public/js/admin/gifts/recent.js'),
    globals,
  );
  await recent.loadGiftArtworkCatalog();
  for (const name of [heartBox.box.name, '']) {
    for (const item of heartBox.outputs) {
      const row = {
        gift_id: item.id,
        gift_name: item.name,
        num: 1,
        is_blind_box: true,
        blind_box_id: heartBox.box.id,
        blind_box_name: name,
        total_price: item.rmb,
        blind_box_price: heartBox.box.rmb,
        blind_profit: item.profit,
      };
      recent.renderGiftRecentList([row]);
      assert.match(list.innerHTML, name ? /blind-box-card blind-box-heart/ : /blind-box-card blind-box-default/);
      assert.match(
        list.innerHTML,
        name ? /src="\/overtime-gift-images\/32251.webp"/ : /src="\/img\/gift-placeholder.png"/,
      );
      assert.ok(!list.innerHTML.includes(`/overtime-gift-images/${item.id}.webp`));
      assert.match(
        list.innerHTML,
        item.profit < 0 ? /class="profit-down">-¥6\.00<\/span>/ : /class="profit-up">\+¥1\.00<\/span>/,
      );
      assert.ok(list.innerHTML.includes(`计入 ¥${item.rmb.toFixed(2)}`));
    }
  }
  recent.renderGiftRecentList([
    {
      gift_id: '32126',
      gift_name: '棉花糖',
      num: 1,
      is_blind_box: true,
      blind_box_id: heartBox.box.id,
      blind_box_name: heartBox.box.name,
      total_price: 9,
      blind_box_price: null,
      blind_profit: null,
    },
  ]);
  assert.match(list.innerHTML, /盈亏待确认/);
  assert.doesNotMatch(list.innerHTML, /profit-neutral.*¥0\.00/);
});
