'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');

test('desktop keeps the gift display bridge as a no-op compatibility channel', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'electron', 'preload.js'),
    'utf8',
  );
  assert.match(
    source,
    /reportGiftDisplay:\s*\(gift\)\s*=>\s*ipcRenderer\.invoke\('desktop:gift-display', gift\)/,
  );

  const mainSource = [
    fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'main.js'), 'utf8'),
    fs.readFileSync(
      path.join(ROOT_DIR, 'src', 'electron', 'ipc', 'update-ipc.js'),
      'utf8',
    ),
  ].join('\n');
  assert.match(mainSource, /ipcMain\.handle\('desktop:gift-display'/);
  assert.doesNotMatch(mainSource, /\[Bilibili\]\[GiftDisplay\]/);
  assert.doesNotMatch(mainSource, /writeLog\('gift-display'/);
});

test('server broadcasts finalized gifts without per-gift diagnostic output', () => {
  const source = [
    fs.readFileSync(path.join(ROOT_DIR, 'src', 'server.js'), 'utf8'),
    fs.readFileSync(
      path.join(ROOT_DIR, 'src', 'server', 'runtime-transport.js'),
      'utf8',
    ),
    fs.readFileSync(
      path.join(ROOT_DIR, 'src', 'server', 'bilibili-client.js'),
      'utf8',
    ),
  ].join('\n');
  assert.doesNotMatch(source, /domainServices\.gifts\.add\(/);
  assert.match(source, /broadcastSnapshot\('bilibili:gift'\)/);
  assert.doesNotMatch(source, /logGiftDelivery/);
  assert.doesNotMatch(source, /\[Bilibili\]\[GiftDelivery\]/);
});

test('gift notification displays new gifts without per-toast diagnostics', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'notification.js'),
    'utf8',
  );
  const reports = [];
  const toasts = [];
  const context = vm.createContext({
    console,
    document: {
      getElementById(id) {
        if (id === 'enableGiftNotification') return { checked: true };
        return null;
      },
    },
    window: {
      songAssistantDesktop: {
        reportGiftDisplay(gift) {
          reports.push(gift);
          return Promise.resolve();
        },
      },
      AdminApp: {
        utils: {
          escapeHtml: String,
          formatMoney: String,
          showStackedToast(options) {
            toasts.push(options);
          },
        },
        gifts: {},
      },
    },
  });

  vm.runInContext(source, context);
  const notify = context.window.AdminApp.gifts.notification.notifyNewGift;
  notify([
    {
      id: 1,
      gift_id: '1',
      gift_name: 'Rose',
      user_name: 'Alice',
      uid: '42',
      num: 1,
      total_price: 1,
    },
  ]);
  notify([
    {
      id: 2,
      gift_id: '1',
      gift_name: 'Rose',
      user_name: 'Alice',
      uid: '42',
      num: 1,
      total_price: 1,
    },
  ]);

  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].key, 'gift:2');
  assert.equal(reports.length, 0);
});
