'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');

const fixture = createUiFixture();
test('gift banners load sender avatars through the token-scoped avatar proxy', async (t) => {
  const page = await fixture(t, 'gift-display');
  const avatar = await page.evaluate(async () => {
    const { createGiftBanner } = await import('/js/shared/gift-banner.js');
    window.__API_TOKEN__ = 'synthetic-overlay-token';
    const banner = createGiftBanner(
      {
        eventId: '1',
        gift: {
          giftId: 'sample',
          giftName: '舰长',
          userName: '测试观众',
          unitPrice: 2,
          num: 1,
          avatarUrl: 'https://i0.hdslb.com/bfs/face/synthetic.webp',
          guardLevel: 3,
        },
      },
      { thresholds: [3000, 10000, 100000] },
    );
    const url = new URL(banner.querySelector('.gift-banner-avatar').src);
    return { path: url.pathname, source: url.searchParams.get('url'), token: url.searchParams.get('token') };
  });
  assert.deepEqual(avatar, {
    path: '/api/bilibili/avatar',
    source: 'https://i0.hdslb.com/bfs/face/synthetic.webp',
    token: 'synthetic-overlay-token',
  });
});

test('gift banner updates patch the sender avatar and quantity', async (t) => {
  const page = await fixture(t, 'gift-display');
  await page.setContent('<div id="stage"></div>');
  const result = await page.evaluate(async () => {
    const { createGiftBanner, updateGiftBanner } = await import('/js/shared/gift-banner.js');
    const config = { thresholds: [3000, 10000, 100000] };
    const item = {
      eventId: 'same',
      gift: {
        giftId: 'sample',
        giftName: '花',
        userName: '短昵称',
        unitPrice: 2,
        num: 1,
        guardLevel: 3,
        avatarUrl: 'https://i0.hdslb.com/bfs/face/old.webp',
      },
    };
    const row = createGiftBanner(item, config);
    document.getElementById('stage').append(row);
    updateGiftBanner(row, { ...item, gift: { ...item.gift, num: 5, avatarUrl: 'https://i0.hdslb.com/bfs/face/new.webp' } }, config);
    return {
      avatarSource: new URL(row.querySelector('.gift-banner-avatar').src).searchParams.get('url'),
      count: row.querySelector('.gift-banner-count').textContent,
    };
  });
  assert.deepEqual(result, { avatarSource: 'https://i0.hdslb.com/bfs/face/new.webp', count: '×5' });
});

test('long gift counts expand exported PNG dimensions', async (t) => {
  const page = await fixture(t, 'gift-display');
  await page.setContent('<div id="stage" class="gift-banner-stage"></div>');
  await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css/shared/gift-banner.css'), 'utf8') });
  const result = await page.evaluate(async () => {
    await import('/js/overlays/gift-export.js');
    const stage = document.getElementById('stage');
    stage.style.transform = 'scale(2)';
    stage.style.transformOrigin = 'top left';
    const items = [1, 1234, 12345678, Number.MAX_SAFE_INTEGER].map((num) => ({
      eventId: String(num),
      gift: { giftId: 'sample', giftName: '测试礼物', userName: '测试观众', unitPrice: 2, num },
    }));
    const payload = { config: { thresholds: [10000, 50000, 100000] }, catalog: [], background: 'transparent' };
    const singles = [];
    for (const item of items) {
      singles.push(await window.renderGiftExport({ ...payload, items: [item] }));
    }
    const combined = await window.renderGiftExport({ ...payload, items });
    stage.style.transform = 'none';
    return {
      singles,
      combined,
      stageHeight: stage.getBoundingClientRect().height,
      rows: [...stage.children].map((row) => {
        const bounds = row.getBoundingClientRect();
        return {
          width: bounds.width,
          height: bounds.height,
        };
      }),
    };
  });
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows[index];
    assert.equal(result.singles[index].width, Math.ceil(row.width * 2));
    assert.equal(result.singles[index].height, Math.ceil(row.height * 2));
    if (index) assert.ok(row.width > result.rows[index - 1].width);
  }
  assert.equal(result.combined.width, result.singles.at(-1).width);
  assert.equal(result.combined.height, Math.ceil(result.stageHeight * 2));
});
