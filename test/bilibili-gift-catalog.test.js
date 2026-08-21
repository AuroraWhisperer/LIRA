'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..');
const GIFT_ROOT = path.join(ROOT_DIR, 'public', 'img');

test('latest 牛来、豹拉 and 涨艇 gifts use local Bilibili artwork', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(GIFT_ROOT, 'bilibili-gifts.json'), 'utf8'));
  const expectedGifts = [
    { id: 35866, name: '豹拉', battery: 66, rmb: 6.6 },
    { id: 35867, name: '牛来', battery: 188, rmb: 18.8 },
    { id: 35868, name: '涨艇', battery: 188, rmb: 18.8 }
  ];

  for (const expected of expectedGifts) {
    const gift = manifest.gifts.find(item => item.id === expected.id);
    assert.deepEqual(
      {
        id: gift?.id,
        name: gift?.name,
        battery: gift?.battery,
        rmb: gift?.rmb
      },
      expected
    );
    assert.match(gift.image, /^bilibili-gifts\/0000-under-0100\/\d+\.webp$/);
    assert.equal(fs.existsSync(path.join(GIFT_ROOT, gift.image)), true);
  }
});
