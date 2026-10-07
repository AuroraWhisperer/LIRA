'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom, createClock } = require('../helpers/toast-dom');

test('blind boxes show the actual output and update the same event identity', async () => {
  for (const box of ['测试盲盒', '测试产物', '']) {
    const notices = [];
    const sandbox = {
      window: {},
      document: { getElementById: () => ({ checked: true }) },
    };
    const { createGiftNotification } = await loadModuleExports(
      path.resolve('public/js/admin/gifts/notification.js'),
      sandbox,
    );
    const { notifyNewGift: notify } = createGiftNotification({ notify: (notice) => notices.push(notice) });
    const gift = {
      id: 1,
      is_blind_box: true,
      gift_name: '测试产物',
      blind_box_name: box,
      user_name: '<script>',
      num: 1,
    };
    notify([]);
    notify([gift]);
    notify([{ ...gift, num: 2 }]);
    assert.match(notices[0].html, /测试产物 x1/);
    assert.ok(notices[0].html.includes(`来自${box || '盲盒'}`));
    assert.match(notices[0].html, /&lt;script&gt;/);
    assert.equal(notices[0].key, notices[1].key);
    assert.equal(notices[1].update, true);
    assert.match(notices[1].html, /测试产物 x2/);
  }
});

test('gift notifications detect delayed records that are not first in the list', async () => {
  const toasts = [];
  const sandbox = {
    window: {},
    document: {
      getElementById: () => ({ checked: true }),
    },
  };
  const { createGiftNotification } = await loadModuleExports(
    path.resolve('public/js/admin/gifts/notification.js'),
    sandbox,
  );
  const { notifyNewGift: notify } = createGiftNotification({ notify: (options) => toasts.push(options) });
  const newestByTime = {
    id: 10,
    gift_id: '1',
    gift_name: 'Rose',
    user_name: 'Alice',
    num: 1,
    total_price: 1,
  };

  notify([newestByTime]);
  notify([
    newestByTime,
    {
      id: 11,
      gift_id: '2',
      gift_name: 'Delayed Gift',
      user_name: 'Bob',
      num: 1,
      total_price: 2,
    },
  ]);

  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].key, 'gift:11');
  assert.match(toasts[0].html, /Delayed Gift/);
  assert.match(toasts[0].html, />¥2\.00<\/span>/);
  assert.doesNotMatch(toasts[0].html, /¥¥/);
});

test('desktop available and downloaded both notify, immediately or after expiry, with phase deduplication', async () => {
  for (const delay of [0, 10000]) {
    const { documentRef, windowRef, container } = createDom();
    const clock = createClock();
    const utils = await loadModuleExports(path.resolve('public/js/shared/utils.js'), {
      document: documentRef,
      window: windowRef,
      ...clock,
    });
    documentRef.querySelectorAll = () => [];
    let onState;
    const notices = [];
    windowRef.AdminApp = {
      utils: {
        ...utils,
        showStackedToast: (notice) => {
          notices.push(notice);
          return utils.showStackedToast(notice);
        },
      },
    };
    windowRef.songAssistantDesktop = {
      onShowUpdatePage() {},
      onUpdateState(fn) {
        onState = fn;
      },
      getInfo: async () => ({}),
    };
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
    const { createProviderOperations } = await loadModuleExports(
      path.resolve('public/js/playback/operations/provider-operations.js'),
      {
        document: { getElementById: () => null },
        window: { musicAPI: { login: async (platform) => requested.push(platform) } },
      },
    );
    const operations = createProviderOperations({
      playbackState: state,
      providerManager: {
        refreshAuthState: async ({ platform }) => {
          requested.push(platform);
          if (auth === 'error') throw new Error('offline');
          return { loggedIn: auth };
        },
      },
      renderPlayback() {},
      showError(error) {
        throw error;
      },
      toast() {},
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
  const { createProviderOperations } = await loadModuleExports(
    path.resolve('public/js/playback/operations/provider-operations.js'),
  );
  const operations = createProviderOperations({
    playbackState: { selectedSource: 'qq' },
    providerManager: {
      checkProviderHealth: async () => {
        if (current instanceof Error) throw current;
        return current;
      },
    },
    renderPlayback() {},
    toast() {},
    showError(error) {
      throw error;
    },
    U: { showStackedToast: (notice) => notifications.push(notice) },
  });
  for (current of [{ ok: true }, { ok: false }, { ok: true }, new Error('offline')])
    await operations.checkSelectedMusicProviderHealth();
  assert.deepEqual(
    notifications.map((notice) => notice.type),
    ['success', 'warning', 'success', 'warning'],
  );
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
    const utils = {
      value: () => 'song',
      toast: (message, options) => notices.push({ message, ...options }),
      api: async () => ({ data }),
    };
    const sandbox = {
      window: {},
      document: {
        getElementById: (id) => (id === 'importFile' ? { files: [] } : id === 'importResult' ? result : null),
      },
    };
    const { createSongImports } = await loadModuleExports(path.resolve('public/js/admin/song-import.js'), sandbox);
    const imports = createSongImports({
      utils,
      state: {
        reloadAll: async () => {
          reloads++;
        },
      },
    });
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
    document: documentRef,
    window: windowRef,
    ...clock,
    fetch: async () => ({ status: 500, text: async () => JSON.stringify({ ok: false, error: '网络故障' }) }),
  });
  const { createSettingsForm } = await loadModuleExports(path.resolve('public/js/admin/settings-form.js'));
  const form = createSettingsForm({
    documentRef,
    ...utils,
    initLicenseAccountDevice: async () => {},
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
      document: documentRef,
      window: windowRef,
      ...clock,
      location: { protocol: 'http:', host: 'local.test' },
      WebSocket: class {
        static OPEN = 1;
      },
      setInterval() {},
      fetch: async () => ({
        json: async () => {
          if (scenario === 'failed') throw new Error('offline');
          return { ok: true, data: { gifts: { recent: [] } } };
        },
      }),
    });
    documentRef.getElementById('bubbleHtml').value =
      scenario === 'zero'
        ? '<div class="bubble-list"></div>'
        : '<div class="super-gift-item"><div class="user-name">观众</div><span class="gift-name">小花</span><div class="gift-frame gift-1-50"></div></div>';
    await elements.get('parseAndCompareBtn').fire('click');
    const notice = documentRef.body.children.find((node) => node.className === 'audit-toast-stack').children[0];
    assert.match(
      notice.textContent,
      scenario === 'zero' ? /未识别到礼物/ : scenario === 'failed' ? /暂时无法核对/ : /疑似漏记/,
    );
    assert.equal(elements.get('comparisonSection').style.display, scenario === 'empty' ? 'block' : 'none');
  }
});

// Status feedback reported through the shared toast stack by other owners.
const settle = () => new Promise(setImmediate);
function feedbackFixture(extra = {}) {
  const dom = createDom();
  const clock = createClock();
  return { ...dom, clock, load: (file) => loadModuleExports(path.resolve('public/js', file), {
    document: dom.documentRef, window: dom.windowRef, ...clock, ...extra,
  }) };
}

test('component saves report failures, preserve later edits and ignore reset sessions', async () => {
  const f = feedbackFixture();
  const { createComponentConfigController } = await f.load('admin/component-config-controller.js');
  const { saveComponentWithFeedback } = await f.load('admin/component-save-feedback.js');
  let write;
  const controller = createComponentConfigController({ initial: { size: 20 }, persist: () => {
    write = Promise.withResolvers();
    return write.promise;
  } });
  await saveComponentWithFeedback(controller, '点歌板主题');
  assert.equal(f.container.children.length, 0, 'unchanged forms stay quiet');
  controller.edit({ size: 24 });
  const failed = saveComponentWithFeedback(controller, '点歌板主题');
  write.reject(new Error('offline'));
  await failed;
  assert.match(f.container.textContent, /offline/);
  assert.equal(controller.getState().saved.size, 20);
  assert.equal(controller.getState().draft.size, 24);
  assert.equal(controller.getState().dirty, true);
  const success = saveComponentWithFeedback(controller, '点歌板主题');
  controller.edit({ size: 28 });
  write.resolve({ size: 24 });
  await success;
  assert.equal(f.container.children.length, 1);
  assert.match(f.container.textContent, /新修改还没保存/);
  f.clock.tick(10000);
  const reset = saveComponentWithFeedback(controller, '点歌板主题');
  controller.reset();
  write.resolve({ size: 28 });
  await reset;
  assert.equal(f.container.children.length, 0, 'a previous session cannot announce success');
});

test('media resume reports a readable error but skips interruptions and handled media errors', async () => {
  const f = feedbackFixture();
  const { notifyMediaPlayFailure } = await f.load('shared/media-playback-feedback.js');
  notifyMediaPlayFailure({ name: 'AbortError' }, {});
  notifyMediaPlayFailure(new Error('The play() request was interrupted'), {});
  notifyMediaPlayFailure(new Error('decode error'), { error: { code: 3 } });
  assert.equal(f.container.children.length, 0);
  notifyMediaPlayFailure({ name: 'NotAllowedError' }, {});
  notifyMediaPlayFailure({ name: 'NotAllowedError' }, {});
  assert.equal(f.container.children.length, 1);
  assert.match(f.container.textContent, /暂时无法播放，请再点一次播放/);
});

test('reminder failures notify outside the editor once and announce recovery', async () => {
  const f = feedbackFixture({ crypto: { randomUUID: () => 'event-1' } });
  const pending = [];
  f.windowRef.localStorage = { getItem: () => null, setItem() {} };
  f.windowRef.plannerReminders = { sync() {
    const request = Promise.withResolvers();
    pending.push(request);
    return request.promise;
  } };
  const { todo } = await f.load('admin/streamer-planner.js');
  const event = todo.addEvent({ title: '直播', date: '2026-10-05', time: '20:00', reminderTime: '20:00' });
  pending[0].reject(new Error('IPC unavailable'));
  await settle();
  assert.match(f.container.textContent, /提醒没设好/);
  f.clock.tick(10000);
  todo.updateEvent(event.id, { title: '直播改名' });
  pending[1].resolve({ ok: false });
  await settle();
  assert.equal(f.container.children.length, 0, 'repeated failure stays quiet after dismissal');
  todo.updateEvent(event.id, { title: '直播改名2' });
  pending[2].resolve({ ok: true, supported: true });
  await settle();
  assert.match(f.container.textContent, /日程提醒已恢复/);
  f.clock.tick(10000);
  todo.updateEvent(event.id, { title: '旧修改' });
  todo.updateEvent(event.id, { title: '新修改' });
  pending[4].resolve({ ok: true, supported: true });
  await settle();
  pending[3].resolve({ ok: false });
  await settle();
  assert.equal(f.container.children.length, 0, 'late failed requests stay quiet');
});

test('gift effect copy handles clipboard and fallback failures without an unhandled rejection', async () => {
  const f = feedbackFixture({ location: { protocol: 'http:', port: '3000' },
    navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } } });
  const lookup = f.documentRef.getElementById;
  const nodes = new Map();
  f.documentRef.getElementById = (id) => {
    if (id === 'toast') return lookup(id);
    if (!nodes.has(id)) nodes.set(id, f.documentRef.createElement('div'));
    return nodes.get(id);
  };
  f.documentRef.execCommand = () => false;
  const create = f.documentRef.createElement;
  f.documentRef.createElement = (tag) => Object.assign(create(tag), { select() {} });
  const { giftEffects } = await f.load('admin/gift-effects.js');
  giftEffects.init();
  await nodes.get('giftEffectCopyBtn').listeners.get('click')();
  assert.match(f.container.textContent, /网址没复制成功/);
  assert.equal(f.container.children.length, 1);
});
