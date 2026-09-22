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
  return { nodes, render: windowRef.AdminApp.desktop.renderDesktopUpdateState };
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
