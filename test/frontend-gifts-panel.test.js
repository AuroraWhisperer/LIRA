'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

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
