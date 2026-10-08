'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { registerUpdateIpc } = require('../../src/electron/ipc/update-ipc');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('desktop keeps the gift display bridge as a no-op compatibility channel', async () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'preload.js'), 'utf8');
  const bridges = {};
  const handlers = new Map();
  const invoked = [];
  const logs = [];
  const baseUrl = 'http://127.0.0.1:31001';
  const mainFrame = { url: `${baseUrl}/admin` };
  const webContents = { mainFrame };
  const window = { webContents, isDestroyed: () => false };
  registerUpdateIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getMainWindow: () => window,
    getDesktopBaseUrl: () => baseUrl,
    writeLog: (...args) => logs.push(args),
  });
  vm.runInNewContext(source, { require: name => {
    assert.equal(name, 'electron');
    return {
      contextBridge: { exposeInMainWorld: (name, bridge) => { bridges[name] = bridge; } },
      ipcRenderer: { invoke(channel, ...args) {
        invoked.push([channel, ...args]);
        assert.equal(channel, 'desktop:gift-display');
        return Promise.resolve(handlers.get(channel)({ sender: webContents, senderFrame: mainFrame }, ...args));
      } },
    };
  } });
  const gift = { id: 42, giftName: '测试礼物', quantity: 2 };
  assert.deepEqual(await bridges.songAssistantDesktop.reportGiftDisplay(gift), { ok: true });
  assert.deepEqual(invoked, [['desktop:gift-display', gift]]);
  assert.deepEqual(logs, []);
});

test('server broadcasts finalized gifts without per-gift diagnostic output', () => {
  const source = [
    fs.readFileSync(path.join(ROOT_DIR, 'src', 'server.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT_DIR, 'src', 'server', 'runtime-transport.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT_DIR, 'src', 'server', 'bilibili-client.js'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(source, /domainServices\.gifts\.add\(/);
  assert.match(source, /broadcastSnapshot\('bilibili:gift'\)/);
  assert.doesNotMatch(source, /logGiftDelivery/);
  assert.doesNotMatch(source, /\[Bilibili\]\[GiftDelivery\]/);
});

test('gift notification displays new gifts without per-toast diagnostics', async () => {
  const reports = [];
  const toasts = [];
  const context = {
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
  };

  const { createGiftNotification } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'notification.js'),
    context,
  );
  const { notifyNewGift: notify } = createGiftNotification({
    notify: (options) => toasts.push(options),
  });
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
