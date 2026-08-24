'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readGiftMappings } = require('../src/bilibili/gift/sale-catalog');
const { giftCategory } = require('../scripts/sync-bilibili-backpack-gifts');

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

test('lottery backpack gifts use their official IDs and local artwork', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(GIFT_ROOT, 'bilibili-gifts.json'), 'utf8'));
  const expectedGifts = [
    { id: 35777, name: '相识玉扣', battery: 350, rmb: 35, image: 'bilibili-gifts/0000-under-0100/35777.webp' },
    { id: 35778, name: '常伴珠钗', battery: 1000, rmb: 100, image: 'bilibili-gifts/0100-0200/35778.webp' },
    { id: 35779, name: '缘起瓷瓶', battery: 3000, rmb: 300, image: 'bilibili-gifts/0300-0400/35779.webp' },
    { id: 35780, name: '倾心宝冠', battery: 8000, rmb: 800, image: 'bilibili-gifts/0800-0900/35780.webp' },
    { id: 35600, name: '万象天衣', battery: 30000, rmb: 3000, image: 'bilibili-gifts/3000-above/35600.webp' }
  ];

  for (const expected of expectedGifts) {
    const gift = manifest.gifts.find(item => item.id === expected.id);
    assert.deepEqual(
      {
        id: gift?.id,
        name: gift?.name,
        battery: gift?.battery,
        rmb: gift?.rmb,
        image: gift?.image
      },
      expected
    );
    assert.equal(fs.existsSync(path.join(GIFT_ROOT, gift.image)), true);
  }
});

test('paid backpack gift artwork and mappings use their RMB price folders', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(GIFT_ROOT, 'bilibili-gifts.json'), 'utf8'));
  const mappings = readGiftMappings(path.join(ROOT_DIR, 'public'));
  const paidBackpackGifts = manifest.gifts.filter(gift => gift.bagGift === true);

  assert.ok(paidBackpackGifts.length > 0);
  for (const gift of paidBackpackGifts) {
    const expectedCategory = giftCategory({ rmb: gift.rmb });
    assert.equal(gift.category, expectedCategory, `gift ${gift.id} manifest category`);
    assert.equal(path.posix.dirname(gift.image.replace(/^bilibili-gifts\//, '')), expectedCategory);
    assert.equal(mappings.get(gift.id)?.imagePath, `/img/${gift.image}`);
    assert.equal(fs.existsSync(path.join(GIFT_ROOT, gift.image)), true, `gift ${gift.id} image`);
  }
});

test('silver and free backpack gifts remain code-only remote mappings', () => {
  const source = fs.readFileSync(
    path.join(GIFT_ROOT, 'bilibili-gifts', 'silver-free-mapping.md'),
    'utf8'
  );

  assert.match(source, /^\| 35460 \| https:\/\/[^|]+ \| 元宝 \|/m);
  assert.doesNotMatch(source, /^\| 35460 \| \[[^\]]+\]\([^)]+\) \|/m);
});
