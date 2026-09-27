'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createDom } = require('./helpers/toast-dom');

const root = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'public/pages/admin/toolbox/desktop-update.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public/js/desktop.js'), 'utf8');

function createFixture() {
  const { documentRef, windowRef } = createDom();
  const nodes = Object.fromEntries(
    [...markup.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => {
      const node = documentRef.createElement('div');
      node.dataset = {};
      return [id, node];
    }),
  );
  documentRef.getElementById = (id) => nodes[id] || null;
  windowRef.AdminApp = { utils: {} };
  vm.runInNewContext(source, { document: documentRef, window: windowRef });
  return { nodes, windowRef, desktop: windowRef.AdminApp.desktop, render: windowRef.AdminApp.desktop.renderDesktopUpdateState };
}

test('desktop update shows only the action for the current update phase', () => {
  const { nodes, render } = createFixture();
  const buttons = ['desktopCheckUpdateBtn', 'desktopDownloadUpdateBtn', 'desktopInstallUpdateBtn'];
  const cases = [
    [{ status: 'idle' }, 'desktopCheckUpdateBtn', false],
    [{ status: 'checking' }, 'desktopCheckUpdateBtn', true],
    [{ status: 'available', canDownload: true }, 'desktopDownloadUpdateBtn', false],
    [{ status: 'downloading' }, null],
    [{ status: 'downloaded', canInstall: true }, 'desktopInstallUpdateBtn', false],
    [{ status: 'installing', canInstall: true }, 'desktopInstallUpdateBtn', true],
    [{ status: 'not-available' }, 'desktopCheckUpdateBtn', false],
    [{ status: 'error' }, 'desktopCheckUpdateBtn', false],
    [{ status: 'dev-disabled' }, 'desktopCheckUpdateBtn', true],
  ];

  for (const [state, visibleButton, disabled] of cases) {
    render(state);
    assert.deepEqual(
      buttons.filter((id) => !nodes[id].hidden),
      visibleButton ? [visibleButton] : [],
      state.status,
    );
    assert.equal(nodes.desktopUpdateActions.hidden, !visibleButton, state.status);
    if (visibleButton) assert.equal(nodes[visibleButton].disabled, disabled, state.status);
  }
});

test('download details and progress appear together and disappear after completion or failure', () => {
  const { nodes, render } = createFixture();
  const progress = { percent: 62.5, transferred: 80 * 1024 * 1024, total: 128 * 1024 * 1024, speed: 2 * 1024 * 1024 };
  render({ status: 'downloading', progress });
  assert.equal(nodes.desktopUpdateDownload.hidden, false);
  assert.equal(nodes.desktopUpdateDownloadDetails.hidden, false);
  assert.equal(nodes.desktopUpdatePercent.textContent, '62.5%');
  assert.equal(nodes.desktopUpdatePercent.hidden, false);
  assert.equal(nodes.desktopUpdateStatus.textContent, '正在下载更新');
  assert.equal(nodes.desktopUpdateProgress.getAttribute('aria-valuenow'), '62.5');
  assert.equal(nodes.desktopUpdateProgressBar.style.width, '62.5%');
  assert.equal(nodes.desktopUpdateTransferred.textContent, '80.0 MB / 128.0 MB');
  assert.equal(nodes.desktopUpdateSpeed.textContent, '2.00 MB/s');

  for (const status of ['downloaded', 'error', 'not-available', 'idle']) {
    render({ status, progress, canInstall: status === 'downloaded' });
    assert.equal(nodes.desktopUpdateDownload.hidden, true, status);
    assert.equal(nodes.desktopUpdateDownloadDetails.hidden, true, status);
    assert.equal(nodes.desktopUpdatePercent.hidden, true, status);
  }
  assert.equal(nodes.desktopUpdateHint.hidden, true);
  assert.equal(nodes.desktopUpdateHint.textContent, '');
});

test('preparing a download does not show fabricated download metrics', () => {
  const { nodes, render } = createFixture();
  render({ status: 'downloading', progress: { percent: 40, total: 100, transferred: 40, speed: 100 } });
  render({ status: 'downloading', message: '正在准备下载更新', progress: null });
  assert.equal(nodes.desktopUpdateStatus.textContent, '正在准备下载更新');
  assert.equal(nodes.desktopUpdateDownload.hidden, false);
  assert.equal(nodes.desktopUpdateDownloadDetails.hidden, true);
  assert.equal(nodes.desktopUpdatePercent.hidden, true);
  assert.equal(nodes.desktopUpdateProgress.getAttribute('aria-valuenow'), null);
  assert.equal(nodes.desktopUpdateProgressBar.style.width, '0%');
  assert.equal(nodes.desktopUpdateTransferred.textContent, '');
  assert.equal(nodes.desktopUpdateSpeed.textContent, '');
});

test('resource checks show scope-limited results, incomplete issues and safe bounded details', () => {
  const { nodes, desktop } = createFixture();
  const initial = { revision: 1, status: 'checking', appVersion: '1.0.0', totalFiles: null, checkedFiles: 0, issueCount: 0, unresolvedCount: 0, details: [] };
  desktop.renderResourceIntegrityState(initial);
  assert.equal(nodes.desktopIntegrityCheckBtn.disabled, true);
  assert.match(nodes.desktopIntegrityStatus.textContent, /正在读取并验证校验清单/);
  assert.equal(nodes.desktopIntegrityMeta.textContent.includes('0 / 0'), false);
  desktop.renderResourceIntegrityState({ ...initial, revision: 2, status: 'issues', totalFiles: 30, checkedFiles: 30, issueCount: 25, unresolvedCount: 2, complete: false,
    details: Array.from({ length: 25 }, () => ({ path: 'app.asar.unpacked/<img>', reasonCode: 'FILE_UNREADABLE' })) });
  assert.match(nodes.desktopIntegrityStatus.textContent, /已发现 25.*部分项目未完成/);
  assert.equal(nodes.desktopIntegrityDetails.children.length, 20);
  assert.equal(nodes.desktopIntegrityDetails.children[0].textContent, 'app.asar.unpacked/<img>：无法读取文件');
  assert.equal(nodes.desktopIntegrityDetails.children[0].children.length, 0);
  assert.match(nodes.desktopIntegrityHint.textContent, /共 27 项.*备份.*关闭客户端/);
  assert.equal(nodes.desktopIntegrityGithubBtn.hidden, false);
  desktop.renderResourceIntegrityState({ ...initial, revision: 3, status: 'passed', totalFiles: 1, checkedFiles: 1, complete: true });
  desktop.renderResourceIntegrityState({ ...initial, revision: 2, status: 'checking' });
  assert.match(nodes.desktopIntegrityStatus.textContent, /本次检查范围内.*不代表所有功能正常/);
  assert.equal(nodes.desktopIntegrityCheckBtn.textContent, '重新检查');
  assert.equal(nodes.desktopIntegrityDetails.hidden, true);
  assert.equal(nodes.desktopIntegrityGithubBtn.hidden, true);
});

test('resource check subscription is registered once and an old initial snapshot cannot replace a newer event', async () => {
  const { desktop, nodes, windowRef } = createFixture();
  const snapshot = Promise.withResolvers();
  let subscribeCount = 0;
  let readCount = 0;
  let listener;
  let dispose;
  let removed = 0;
  windowRef.addEventListener = (name, callback) => { if (name === 'beforeunload') dispose = callback; };
  const bridge = {
    onResourceIntegrityState(callback) { subscribeCount += 1; listener = callback; return () => { removed += 1; }; },
    getResourceIntegrityState() { readCount += 1; return snapshot.promise; },
    checkResourceIntegrity() {},
  };
  desktop.initResourceIntegrity(bridge);
  desktop.initResourceIntegrity(bridge);
  listener({ revision: 2, status: 'unavailable', reasonCode: 'DEV_MODE', details: [] });
  snapshot.resolve({ revision: 1, status: 'idle', details: [] });
  await snapshot.promise;
  assert.equal(subscribeCount, 1);
  assert.equal(readCount, 1);
  assert.equal(nodes.desktopIntegrityCheckBtn.disabled, true);
  assert.equal(nodes.desktopIntegrityStatus.textContent, '开发模式不支持此检查');
  dispose();
  assert.equal(removed, 1);
});
