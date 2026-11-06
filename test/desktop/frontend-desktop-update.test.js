'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createDom } = require('../helpers/toast-dom');
const { loadModuleExports } = require('../helpers/frontend-modules');

const root = path.join(__dirname, '../..');
const markup = fs.readFileSync(path.join(root, 'public/pages/admin/toolbox/desktop-update.html'), 'utf8');

async function createFixture(utils = {}) {
  const { documentRef, windowRef } = createDom();
  const nodes = Object.fromEntries(
    [...markup.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => {
      const node = documentRef.createElement('div');
      node.dataset = {};
      return [id, node];
    }),
  );
  documentRef.getElementById = (id) => nodes[id] || null;
  documentRef.querySelectorAll = () => [];
  const { createDesktopShell } = await loadModuleExports(path.join(root, 'public/js/desktop.js'), {
    document: documentRef, window: windowRef,
  });
  const desktop = createDesktopShell(utils);
  return {
    nodes,
    windowRef,
    desktop,
    render: desktop.renderDesktopUpdateState,
  };
}

test('update failures notify once for manual checks and active downloads, keeping background checks quiet', async () => {
  const notices = [];
  const { desktop, nodes, windowRef } = await createFixture({
    showStackedToast: (options) => notices.push(options),
    showError: (error) => { throw error; },
  });
  let onState;
  windowRef.songAssistantDesktop = {
    onShowUpdatePage() {}, onUpdateState(callback) { onState = callback; },
    getInfo: async () => ({}),
    checkForUpdates: async () => {
      onState({ status: 'error' });
      throw new Error('offline');
    },
  };
  desktop.initDesktopShell();
  await new Promise(setImmediate);
  onState({ status: 'error' });
  assert.equal(notices.length, 0);
  nodes.desktopCheckUpdateBtn.listeners.get('click')();
  await new Promise(setImmediate);
  assert.equal(notices.length, 1, 'state event plus rejected action must not notify twice');
  onState({ status: 'downloading', updateVersion: '1.2.3' });
  onState({ status: 'error', updateVersion: '1.2.3' });
  onState({ status: 'error', updateVersion: '1.2.3' });
  assert.equal(notices.length, 2);
  assert.notEqual(notices[1].title, notices[0].title, 'download failure must not reuse the check failure notice');
});

test('resource checks ignore stale revisions and render bounded details as text', async () => {
  const { nodes, desktop } = await createFixture();
  const initial = {
    revision: 1,
    status: 'checking',
    appVersion: '1.0.0',
    totalFiles: null,
    checkedFiles: 0,
    issueCount: 0,
    unresolvedCount: 0,
    details: [],
  };
  desktop.renderResourceIntegrityState(initial);
  desktop.renderResourceIntegrityState({
    ...initial,
    revision: 2,
    status: 'issues',
    totalFiles: 30,
    checkedFiles: 30,
    issueCount: 25,
    unresolvedCount: 2,
    complete: false,
    details: Array.from({ length: 25 }, () => ({ path: 'app.asar.unpacked/<img>', reasonCode: 'FILE_UNREADABLE' })),
  });
  assert.equal(nodes.desktopIntegrityDetails.children.length, 20);
  assert.ok(nodes.desktopIntegrityDetails.children[0].textContent.startsWith('app.asar.unpacked/<img>'));
  assert.equal(nodes.desktopIntegrityDetails.children[0].children.length, 0);
  desktop.renderResourceIntegrityState({
    ...initial,
    revision: 3,
    status: 'passed',
    totalFiles: 1,
    checkedFiles: 1,
    complete: true,
  });
  desktop.renderResourceIntegrityState({ ...initial, revision: 2, status: 'checking' });
  assert.equal(nodes.desktopIntegrityResult.dataset.tone, 'success', 'an older revision must not replace the passed result');
  assert.equal(nodes.desktopIntegrityCheckBtn.disabled, false);
  assert.equal(nodes.desktopIntegrityDetails.hidden, true);
});

test('resource check subscription is registered once and an old initial snapshot cannot replace a newer event', async () => {
  const { desktop, nodes, windowRef } = await createFixture();
  const snapshot = Promise.withResolvers();
  let subscribeCount = 0;
  let readCount = 0;
  let listener;
  let dispose;
  let removed = 0;
  windowRef.addEventListener = (name, callback) => {
    if (name === 'beforeunload') dispose = callback;
  };
  const bridge = {
    onResourceIntegrityState(callback) {
      subscribeCount += 1;
      listener = callback;
      return () => {
        removed += 1;
      };
    },
    getResourceIntegrityState() {
      readCount += 1;
      return snapshot.promise;
    },
    checkResourceIntegrity() {},
  };
  desktop.initResourceIntegrity(bridge);
  desktop.initResourceIntegrity(bridge);
  listener({ revision: 2, status: 'unavailable', reasonCode: 'DEV_MODE', details: [] });
  snapshot.resolve({ revision: 1, status: 'idle', details: [] });
  await snapshot.promise;
  assert.equal(subscribeCount, 1);
  assert.equal(readCount, 1);
  assert.equal(nodes.desktopIntegrityCheckBtn.disabled, true, 'the older idle snapshot must not re-enable an unavailable check');
  dispose();
  assert.equal(removed, 1);
});

test('closing resource checks ignores late snapshots, events and rejected actions', async () => {
  const notices = [];
  const { desktop, nodes, windowRef } = await createFixture({ toast: (...args) => notices.push(args) });
  const initial = Promise.withResolvers();
  const check = Promise.withResolvers();
  let listener;
  let dispose;
  let removed = 0;
  windowRef.addEventListener = (_name, callback) => { dispose = callback; };
  desktop.initResourceIntegrity({
    onResourceIntegrityState(callback) { listener = callback; return () => { removed++; }; },
    getResourceIntegrityState: () => initial.promise,
    checkResourceIntegrity: () => check.promise,
  });
  const checking = nodes.desktopIntegrityCheckBtn.listeners.get('click')();
  const previousStatus = nodes.desktopIntegrityStatus.textContent;
  dispose();
  listener({ revision: 3, status: 'passed', totalFiles: 0, details: [] });
  initial.resolve({ revision: 2, status: 'idle', details: [] });
  check.reject(new Error('closed page'));
  await checking;
  await new Promise(setImmediate);
  assert.equal(removed, 1);
  assert.equal(nodes.desktopIntegrityStatus.textContent, previousStatus);
  assert.equal(notices.length, 0);
});
