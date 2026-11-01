'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { registerDesktopShellIpc } = require('../../src/electron/ipc/desktop-shell-ipc');

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
  registerDesktopShellIpc({
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

test('server gift ingress does not write a second local ledger', () => {
  const source = [
    fs.readFileSync(path.join(ROOT_DIR, 'src', 'server.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT_DIR, 'src', 'server', 'runtime-transport.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT_DIR, 'src', 'server', 'bilibili-client.js'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(source, /domainServices\.gifts\.add\(/);
});
