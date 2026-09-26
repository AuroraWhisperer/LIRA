'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { createBlindboxFixture } = require('./helpers/frontend-blindbox-fixture');

const GIFT_MODULES = path.join(__dirname, '../public/js/admin/gifts');

test('recent cards and mappings share exact themes for each box and fall back for similar names', async () => {
  const fixture = await createBlindboxFixture();
  fixture.listToggle.setAttribute('aria-expanded', 'true');
  const list = { innerHTML: '', classList: { toggle() {} }, querySelectorAll: () => [] };
  const { giftRecent } = await loadModuleExports(path.join(GIFT_MODULES, 'recent.js'), {
    window: { getComputedStyle: () => ({ gridTemplateColumns: '270px' }) },
    document: { getElementById: () => list },
  });
  const cases = [
    ['心动盲盒', '32251', 'heart'],
    ['幸运盲盒', '35206', 'lucky'],
    ['修仙盲盒', '35891', 'xiuxian'],
    ['中秋盲盒', '35429', 'mid-autumn'],
    ['小熊虫盲盒', null, 'bear'],
    ['七夕鹊匣', '45786', 'qixi'],
    ['羁绊宝盒', null, 'bond'],
    ['用户自定义盲盒', null, 'default'],
    ['心动盲盒·中秋盲盒', null, 'default'],
    ['中秋盲盒纪念版', '35429', 'default'],
    ['小熊虫自定义盒', null, 'default'],
    ['七夕盲盒', '35429', 'default'],
    ['心动盲盒', '99999', 'default'],
  ];

  for (const [name, id, theme] of cases) {
    giftRecent.renderGiftRecentList([
      {
        is_blind_box: true,
        blind_box_name: name,
        blind_box_id: id,
        gift_name: '盲盒产物',
        gift_id: '900',
        total_price: 10,
      },
    ]);
    fixture.textarea.value = JSON.stringify([{ name, giftId: id, price: 9, outputs: [] }]);
    fixture.module.renderBlindBoxList();

    assert.equal(list.innerHTML.match(/data-blind-box-theme="([^"]+)"/)?.[1], theme, `card: ${name}`);
    assert.equal(
      fixture.container.innerHTML.match(/data-blind-box-theme="([^"]+)"/)?.[1],
      theme,
      `mapping: ${name}`,
    );
    assert.deepEqual(fixture.visibleNames(), [name]);
  }
});

test('theme selection requires a full name and keeps reused gift IDs separate', async () => {
  const { findBlindBoxTheme } = await loadModuleExports(path.join(GIFT_MODULES, 'blindbox-theme.js'));

  assert.equal(findBlindBoxTheme('中秋盲盒', '35429')?.key, 'mid-autumn');
  assert.equal(findBlindBoxTheme('七夕盲盒', '35429'), undefined);
  assert.equal(findBlindBoxTheme('新上架礼物', '32251'), undefined);
  assert.equal(findBlindBoxTheme('', '32251'), undefined);
  assert.equal(findBlindBoxTheme('心动盲盒', '35206'), undefined);
  assert.equal(findBlindBoxTheme('  心动盲盒  ', 32251)?.key, 'heart');
  assert.equal(findBlindBoxTheme('心动盲盒')?.key, 'heart');
  assert.equal(findBlindBoxTheme('constructor'), undefined);
});

test('direct gifts do not gain a blind-box theme just because their names match', async () => {
  const list = { innerHTML: '', classList: { toggle() {} }, querySelectorAll: () => [] };
  const { giftRecent } = await loadModuleExports(path.join(GIFT_MODULES, 'recent.js'), {
    window: { getComputedStyle: () => ({ gridTemplateColumns: '270px' }) },
    document: { getElementById: () => list },
  });

  giftRecent.renderGiftRecentList([{ gift_name: '中秋盲盒', gift_id: '35429', total_price: 10 }]);

  assert.doesNotMatch(list.innerHTML, /data-blind-box-theme|blind-box-card/);
});
