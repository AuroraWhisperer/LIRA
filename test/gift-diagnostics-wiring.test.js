'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');

test('desktop preload exposes a narrow gift display diagnostic bridge', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'preload.js'), 'utf8');
  assert.match(source, /reportGiftDisplay:\s*\(gift\)\s*=>\s*ipcRenderer\.invoke\('desktop:gift-display', gift\)/);

  const mainSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'main.js'), 'utf8');
  assert.match(mainSource, /ipcMain\.handle\('desktop:gift-display'/);
  assert.match(mainSource, /\[Bilibili\]\[GiftDisplay\] action=toast-requested/);
  assert.match(mainSource, /writeLog\('gift-display', trace\)/);
});

test('server logs both immediate and delayed gift broadcasts', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server.js'), 'utf8');
  assert.match(source, /logGiftDelivery\('immediate', item\)/);
  assert.match(source, /logGiftDelivery\('combo-flush', item\)/);
  assert.match(source, /\[Bilibili\]\[GiftDelivery\] action=broadcast/);
});

test('gift notification reports the exact new gift requested for display', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'notification.js'), 'utf8');
  const reports = [];
  const toasts = [];
  const context = vm.createContext({
    console,
    document: {
      getElementById(id) {
        if (id === 'enableGiftNotification') return { checked: true };
        return null;
      }
    },
    window: {
      songAssistantDesktop: {
        reportGiftDisplay(gift) {
          reports.push(gift);
          return Promise.resolve();
        }
      },
      AdminApp: {
        utils: {
          escapeHtml: String,
          formatMoney: String,
          showStackedToast(options) {
            toasts.push(options);
          }
        },
        gifts: {}
      }
    }
  });

  vm.runInContext(source, context);
  const notify = context.window.AdminApp.gifts.notification.notifyNewGift;
  notify([{ id: 1, gift_id: '1', gift_name: 'Rose', user_name: 'Alice', uid: '42', num: 1, total_price: 1 }]);
  notify([{ id: 2, gift_id: '1', gift_name: 'Rose', user_name: 'Alice', uid: '42', num: 1, total_price: 1 }]);

  assert.equal(toasts.length, 1);
  assert.equal(reports.length, 1);
  assert.deepEqual({ ...reports[0] }, {
    eventId: 2,
    giftId: '1',
    giftName: 'Rose',
    uid: '42',
    userName: 'Alice',
    num: 1,
    totalPrice: 1,
    toastKey: 'gift:2:1:1'
  });
});
