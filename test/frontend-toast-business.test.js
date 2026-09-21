'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { createDom, createClock } = require('./helpers/toast-dom');

test('blind boxes show the actual output and update the same event identity', async () => {
  for (const box of ['测试盲盒', '测试产物', '']) {
    const notices = [];
    const sandbox = {
      window: {},
      document: { getElementById: () => ({ checked: true }) },
    };
    const { createGiftNotification } = await loadModuleExports(path.resolve('public/js/admin/gifts/notification.js'), sandbox);
    const { notifyNewGift: notify } = createGiftNotification({ notify: (notice) => notices.push(notice) });
    const gift = { id: 1, is_blind_box: true, gift_name: '测试产物', blind_box_name: box, user_name: '<script>', num: 1 };
    notify([]); notify([gift]); notify([{ ...gift, num: 2 }]);
    assert.match(notices[0].html, /测试产物 x1/);
    assert.ok(notices[0].html.includes(`来自${box || '盲盒'}`));
    assert.match(notices[0].html, /&lt;script&gt;/);
    assert.equal(notices[0].key, notices[1].key);
    assert.equal(notices[1].update, true);
    assert.match(notices[1].html, /测试产物 x2/);
  }
});

test('desktop available and downloaded both notify, immediately or after expiry, with phase deduplication', async () => {
  for (const delay of [0, 10000]) {
    const { documentRef, windowRef, container } = createDom();
    const clock = createClock();
    const utils = await loadModuleExports(path.resolve('public/js/shared/utils.js'), { document: documentRef, window: windowRef, ...clock });
    documentRef.querySelectorAll = () => [];
    let onState;
    const notices = [];
    windowRef.AdminApp = { utils: { ...utils, showStackedToast: (notice) => { notices.push(notice); return utils.showStackedToast(notice); } } };
    windowRef.songAssistantDesktop = { onShowUpdatePage() {}, onUpdateState(fn) { onState = fn; }, getInfo: async () => ({}) };
    vm.runInNewContext(fs.readFileSync('public/js/desktop.js', 'utf8'), { document: documentRef, window: windowRef });
    windowRef.AdminApp.desktop.initDesktopShell();
    onState({ status: 'available', updateVersion: 'A' });
    onState({ status: 'available', updateVersion: 'A' });
    clock.tick(delay);
    onState({ status: 'downloaded', updateVersion: 'A' });
    onState({ status: 'downloaded', updateVersion: 'A' });
    assert.equal(notices.length, 2);
    assert.equal(container.children.length, 1);
    assert.match(container.children[0].textContent, /已下载/);
  }
});

test('music login action and result remain bound to the prompted platform after source changes', async () => {
  for (const auth of [true, false, 'error']) {
    const notifications = [];
    const requested = [];
    const state = { selectedSource: 'qq' };
    const { createProviderOperations } = await loadModuleExports(path.resolve('public/js/playback/operations/provider-operations.js'), {
      document: { getElementById: () => null },
      window: { musicAPI: { login: async (platform) => requested.push(platform) } },
    });
    const operations = createProviderOperations({
      playbackState: state,
      providerManager: { refreshAuthState: async ({ platform }) => {
        requested.push(platform);
        if (auth === 'error') throw new Error('offline');
        return { loggedIn: auth };
      } },
      renderPlayback() {}, showError(error) { throw error; }, toast() {},
      U: { showStackedToast: (notice) => notifications.push(notice) },
    });
    operations.showPlaybackLoginPrompt();
    state.selectedSource = 'netease';
    await notifications[0].onClick();
    assert.deepEqual(requested, ['qq', 'qq']);
    assert.match(notifications[0].title, /QQ音乐/);
    assert.match(notifications[1].title, /QQ音乐/);
    assert.equal(notifications[1].type, auth === true ? 'success' : 'warning');
    assert.match(notifications[1].title, auth === true ? /已登录/ : auth === false ? /尚未完成/ : /暂时无法确认/);
    assert.equal(operations.getAuthState(), null, 'old prompt does not overwrite the newly selected platform');
  }
});

test('health results including thrown errors replace earlier results under one key', async () => {
  const notifications = [];
  let current;
  const { createProviderOperations } = await loadModuleExports(path.resolve('public/js/playback/operations/provider-operations.js'));
  const operations = createProviderOperations({
    playbackState: { selectedSource: 'qq' },
    providerManager: { checkProviderHealth: async () => { if (current instanceof Error) throw current; return current; } },
    renderPlayback() {}, toast() {}, showError(error) { throw error; },
    U: { showStackedToast: (notice) => notifications.push(notice) },
  });
  for (current of [{ ok: true }, { ok: false }, { ok: true }, new Error('offline')]) await operations.checkSelectedMusicProviderHealth();
  assert.deepEqual(notifications.map((notice) => notice.type), ['success', 'warning', 'success', 'warning']);
  assert.equal(new Set(notifications.map((notice) => notice.key)).size, 1);
  assert.ok(notifications.every((notice) => notice.update));
  assert.equal(operations.getProviderHealth().message, 'offline');
});

test('import summaries distinguish success, partial failure, no success and all duplicates', async () => {
  for (const [data, type, text] of [
    [{ inserted: 3, duplicate: 0, failed: 0 }, 'success', /已新增 3/],
    [{ inserted: 2, duplicate: 0, failed: 1 }, 'warning', /2 首，1 行失败/],
    [{ inserted: 0, duplicate: 0, failed: 3 }, 'warning', /本次未导入歌曲/],
    [{ inserted: 0, duplicate: 3, failed: 0 }, undefined, /全部为重复歌曲/],
  ]) {
    const notices = [];
    const result = {};
    let reloads = 0;
    const utils = { value: () => 'song', toast: (message, options) => notices.push({ message, ...options }), api: async () => ({ data }) };
    const sandbox = {
      window: {},
      document: { getElementById: (id) => id === 'importFile' ? { files: [] } : id === 'importResult' ? result : null },
    };
    const { createSongImports } = await loadModuleExports(path.resolve('public/js/admin/import.js'), sandbox);
    const imports = createSongImports({ utils, state: { reloadAll: async () => { reloads++; } } });
    sandbox.window.AdminApp = {};
    await imports.importSongs();
    assert.equal(reloads, 1);
    assert.equal(notices[0].type, type);
    assert.match(notices[0].message, text);
    assert.match(result.textContent, new RegExp(`失败 ${data.failed}`));
  }
});

test('field feedback keeps the existing description and clears on editing', async () => {
  const { documentRef } = createDom();
  const input = documentRef.createElement('input');
  input.setAttribute('aria-describedby', 'help');
  documentRef.body.append(input);
  const { showFieldError } = await loadModuleExports(path.resolve('public/js/shared/field-feedback.js'));
  showFieldError(input, '请输入盲盒名');
  showFieldError(input, '名称不能为空');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(documentRef.activeElement, input);
  assert.match(input.getAttribute('aria-describedby'), /^help field-error-/);
  assert.equal(documentRef.body.children.at(-1).textContent, '名称不能为空');
  input.fire('input');
  assert.equal(input.getAttribute('aria-describedby'), 'help');
  assert.equal(input.getAttribute('aria-invalid'), null);
});

test('an immediate settings toggle reports one contextual failure and restores the stored value', async () => {
  const { documentRef, windowRef, container } = createDom();
  const clock = createClock();
  const elements = new Map();
  const lookup = documentRef.getElementById;
  documentRef.getElementById = (id) => {
    if (id === 'toast') return lookup(id);
    if (!elements.has(id)) elements.set(id, documentRef.createElement('input'));
    return elements.get(id);
  };
  const utils = await loadModuleExports(path.resolve('public/js/shared/utils.js'), {
    document: documentRef, window: windowRef, ...clock,
    fetch: async () => ({ status: 500, text: async () => JSON.stringify({ ok: false, error: '网络故障' }) }),
  });
  const { createSettingsForm } = await loadModuleExports(path.resolve('public/js/admin/settings-form.js'));
  const form = createSettingsForm({
    documentRef, ...utils, initLicenseAccountDevice: async () => {},
    blindboxSettings: { init() {} },
    getState: () => ({ getAppState: () => ({ settings: { enableGiftNotification: 'false' } }) }),
  });
  await form.init();
  const input = elements.get('enableGiftNotification');
  input.checked = true;
  await input.fire('change', { target: input });
  assert.equal(input.checked, false);
  assert.equal(container.children.length, 1);
  assert.match(container.children[0].textContent, /保存失败：网络故障/);
});

test('audit refuses zero parsed gifts and failed record fetches but accepts a reliable empty response', async () => {
  for (const scenario of ['zero', 'failed', 'empty']) {
    const { documentRef, windowRef } = createDom();
    const clock = createClock();
    const elements = new Map();
    documentRef.getElementById = (id) => {
      if (!elements.has(id)) {
        const node = documentRef.createElement('div');
        node.value = '';
        node.scrollIntoView = () => {};
        elements.set(id, node);
      }
      return elements.get(id);
    };
    await loadModuleExports(path.resolve('public/js/gift-audit/index.js'), {
      document: documentRef, window: windowRef, ...clock,
      location: { protocol: 'http:', host: 'local.test' },
      WebSocket: class { static OPEN = 1; }, setInterval() {},
      fetch: async () => ({ json: async () => {
        if (scenario === 'failed') throw new Error('offline');
        return { ok: true, data: { gifts: { recent: [] } } };
      } }),
    });
    documentRef.getElementById('bubbleHtml').value = scenario === 'zero'
      ? '<div class="bubble-list"></div>'
      : '<div class="super-gift-item"><div class="user-name">观众</div><span class="gift-name">小花</span><div class="gift-frame gift-1-50"></div></div>';
    await elements.get('parseAndCompareBtn').fire('click');
    const notice = documentRef.body.children.find((node) => node.className === 'audit-toast-stack').children[0];
    assert.match(notice.textContent, scenario === 'zero' ? /未识别到礼物/ : scenario === 'failed' ? /暂时无法核对/ : /疑似漏记/);
    assert.equal(elements.get('comparisonSection').style.display, scenario === 'empty' ? 'block' : 'none');
  }
});
