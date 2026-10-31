const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createParameterDocument } = require('../helpers/parameter-dom');

const source = (file) => fs.readFileSync(path.join(__dirname, '../../public/js/admin', file), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const url = 'https://broadcaster.example.test:9443/overlay/syntheticKey_123';
const saved = (style = 'signal', duration = 6, overlayUrl = url) => ({
  ok: true,
  style,
  fullscreenDurationSeconds: duration,
  styleOptions: {},
  overlayUrl,
});

async function fixture() {
  const document = createParameterDocument();
  const node = key => document.getElementById({
    fullscreenDuration: 'danmakuFullscreenDurationSeconds', fullscreenDurationField: 'danmakuFullscreenDurationField',
  }[key] || key);
  const elements = Object.fromEntries(
    [
      'overlayUrl',
      'styleChip',
      'styleSaveState',
      'fullscreenDurationField',
      'fullscreenDuration',
      'openOverlayButton',
      'previewOverlayButton',
    ].map((key) => [key, node(key)]),
  );
  elements.styleButtons = [
    'bubble',
    'signal',
    'minimal',
    'ranked',
    'transparent',
    'identity',
    'outline',
    'cream',
    'glow',
    'twitter',
  ].map((style) => {
    const button = node(style);
    button.dataset.danmakuStyle = style;
    return button;
  });
  let observer;
  const reads = [],
    writes = [],
    opened = [],
    copied = [],
    notifications = [];
  const localResponse = (value) => {
    if (!value.ok) throw new Error(value.error);
    const { ok, overlayUrl, ...config } = value;
    return { binding: overlayUrl, config };
  };
  const localApi = {
    readDanmakuAppearance: () => new Promise((resolve, reject) => reads.push({ resolve, reject })).then(localResponse),
    saveDanmakuAppearance: ({ binding, config: parameters }) =>
      new Promise((resolve, reject) =>
        writes.push({ binding, parameters: JSON.parse(JSON.stringify(parameters)), resolve, reject }),
      ).then(localResponse),
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    document,
    window: { liraLicense: new Proxy({}, { get() { throw new Error('The appearance UI must not use remote settings IPC.'); } }), open: (...args) => opened.push(args) },
  });
  const editors = [];
  const module = new vm.SourceTextModule(source('danmaku-overlay-settings.js'), {
    context, identifier: path.resolve(__dirname, '../../public/js/admin/danmaku-overlay-settings.js'),
  });
  const modules = new Map();
  await module.link((specifier, parent) => {
    const filename = path.resolve(path.dirname(parent.identifier), specifier);
    if (modules.has(filename)) return modules.get(filename);
    if (filename.endsWith('danmaku-appearance-api.js')) {
      const api = new vm.SyntheticModule(Object.keys(localApi), function () {
        for (const [name, fn] of Object.entries(localApi)) this.setExport(name, fn);
      }, { context });
      modules.set(filename, api);
      return api;
    }
    if (filename === path.resolve(__dirname, '../../public/js/shared/font-library.js')) {
      const fonts = new vm.SyntheticModule(['registerFontSelect', 'ensureSavedFontOption'], function () {
        this.setExport('registerFontSelect', () => () => {});
        this.setExport('ensureSavedFontOption', () => {});
      }, { context });
      modules.set(filename, fonts);
      return fonts;
    }
    if (filename === path.resolve(__dirname, '../../public/js/shared/component-style-parameter-view.js')) {
      const effects = new vm.SyntheticModule(['mountStyleParameters'], function () {
        this.setExport('mountStyleParameters', () => ({ dispose() {} }));
      }, { context });
      modules.set(filename, effects);
      return effects;
    }
    const dependency = !['utils.js', 'danmaku-canvas-dialog.js', 'authorized-account.js'].includes(path.basename(filename))
      ? new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename })
      : new vm.SyntheticModule(
          specifier.includes('utils') ? ['copyText', 'localOverlayOrigin', 'toast'] : specifier.includes('canvas-dialog') ? ['createDanmakuPreview', 'openDanmakuCanvas'] : ['observeAuthorizedAccount'],
          function () {
            if (specifier.includes('utils')) {
              this.setExport('copyText', async (value) => copied.push(value));
              this.setExport('toast', () => {});
              this.setExport('localOverlayOrigin', () => 'http://127.0.0.1:3000');
            } else if (specifier.includes('canvas-dialog')) {
              this.setExport('createDanmakuPreview', ({ controller }) => ({ id: 'danmaku', controller }));
              this.setExport('openDanmakuCanvas', ({ controller }) => {
                editors.push({ controller, get draft() { return controller.getState().draft; },
                  get canApply() { return controller.getState().loaded; },
                  onChange: (draft) => controller.edit(draft), onApply: () => controller.save() });
                return { close() {} };
              });
            } else
              this.setExport('observeAuthorizedAccount', (callback) => {
                observer = callback;
                callback(url);
              });
          },
          { context },
        );
    modules.set(filename, dependency);
    return dependency;
  });
  await module.evaluate();
  module.namespace.initDanmakuOverlaySettings(elements, (message, options) => notifications.push({ message, options }));
  elements.fullscreenDuration = node('fullscreenDuration');
  elements.fullscreenDurationField = node('fullscreenDurationField');
  const click = (key) => node(key).events.click();
  const duration = (value) => {
    elements.fullscreenDuration.value = value;
    elements.fullscreenDuration.events.change();
  };
  return { elements, node, reads, writes, opened, copied, editors, notifications, click, duration, account: (value) => observer(value) };
}

test('server link uses the authorized configured public origin, including its port', async () => {
  const module = new vm.SourceTextModule(source('server-overlay-url.js'), { context: vm.createContext({ URL }) });
  await module.link(() => {});
  await module.evaluate();
  const resolve = module.namespace.serverOverlayUrl;
  assert.equal(
    resolve(
      { state: 'authorized', streamer: { songPageUrl: 'https://broadcaster.example.test:9443/?anything=1' } },
      saved(),
    ),
    url,
  );
  for (const snapshot of [
    null,
    { state: 'blocked' },
    { state: 'authorized', streamer: { songPageUrl: 'http://127.0.0.1:3000/' } },
    { state: 'authorized', streamer: { songPageUrl: 'https://user:secret@example.test/' } },
  ])
    assert.equal(resolve(snapshot), '');
});

test('edits and local preview do not write until explicit apply; late save preserves newer draft', async () => {
  const f = await fixture();
  f.reads[0].resolve(saved());
  await flush();
  f.click('outline');
  f.duration('12');
  f.click('previewOverlayButton');
  assert.equal(f.editors[0].draft.style, 'outline');
  assert.equal(f.editors[0].draft.styleOptions.outline.durationSeconds, 12);
  assert.equal(f.opened.length, 0);
  assert.equal(f.writes.length, 0);
  const first = f.click('danmakuApplyOverlayBtn');
  void f.click('danmakuApplyOverlayBtn');
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].parameters, { style: 'outline', fullscreenDurationSeconds: 6, styleOptions: { outline: { durationSeconds: 12 } } });
  f.click('identity');
  f.writes[0].resolve({ ...saved('outline'), styleOptions: f.writes[0].parameters.styleOptions });
  await first;
  assert.match(f.elements.styleChip.textContent, /待应用.*灵动弹幕/);
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, false);
  const next = f.click('danmakuApplyOverlayBtn');
  f.writes[1].resolve({ ...saved('identity'), styleOptions: f.writes[1].parameters.styleOptions });
  await next;
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, true);
});

test('failed apply and invalid durations retain the editable draft', async () => {
  const f = await fixture();
  f.reads[0].resolve(saved());
  await flush();
  f.click('outline');
  f.duration('12');
  f.duration('31');
  assert.equal(f.elements.fullscreenDuration.value, '12');
  const pending = f.click('danmakuApplyOverlayBtn');
  f.writes[0].resolve({ ok: false, error: '本机保存失败，请稍后重试。' });
  await pending;
  assert.match(f.elements.styleSaveState.textContent, /草稿已保留.*本机保存失败/);
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, false);
  assert.match(f.elements.styleChip.textContent, /一纸素笺/);
});

test('a same-account relogin rejects the old read binding before subsequent saves', async () => {
  const f = await fixture();
  f.account('');
  f.account(url);
  const currentBinding = 'current-login-binding';
  f.reads[1].resolve(saved('signal', 6, currentBinding));
  await flush();
  f.reads[0].resolve(saved('bubble', 6, 'previous-login-binding'));
  await flush();
  f.click('twitter');
  const saving = f.click('danmakuApplyOverlayBtn');
  assert.equal(f.writes[0].binding, currentBinding);
  f.writes[0].resolve(saved('twitter', 6, currentBinding));
  await saving;
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, true);
});

test('local validation and ownership rejections retain the draft for retry', async () => {
  const f = await fixture();
  f.reads[0].resolve(saved());
  await flush();
  f.click('twitter');
  for (const [error, message] of [
    ['弹幕外观参数无效。', /参数无效/],
    ['账号授权已变化，请重新读取后保存。', /账号授权已变化/],
    ['本机保存失败，请稍后重试。', /请稍后重试/],
  ]) {
    const pending = f.click('danmakuApplyOverlayBtn');
    f.writes.at(-1).resolve({ ok: false, error });
    await pending;
    const notice = f.notifications.at(-1);
    assert.match(notice.message, message);
    assert.equal(notice.options.type, 'error');
    assert.equal(f.writes.at(-1).parameters.style, 'twitter');
    assert.equal(f.node('danmakuApplyOverlayBtn').disabled, false);
    assert.match(f.elements.styleSaveState.textContent, /草稿已保留/);
  }
});

test('an initial settings read failure is not presented as a failed apply or a retained draft', async () => {
  const f = await fixture();
  f.reads[0].resolve({ ok: false, error: '弹幕外观读取失败' });
  await flush();
  assert.match(f.elements.styleSaveState.textContent, /弹幕外观读取失败/);
  assert.doesNotMatch(f.elements.styleSaveState.textContent, /应用失败|草稿已保留|保存/);
  assert.equal(f.writes.length, 0);
});

test('appearance drafts belong to each style and apply together without leaking to the old server', async () => {
  const f = await fixture();
  f.reads[0].resolve({ ...saved(), styleOptions: {} });
  await flush();
  const change = (id, value, event = 'change') => {
    f.node(id).value = value;
    f.node(id).events[event]();
  };
  change('danmakuFontSize', '42');
  change('danmakuFontFamily', '"Cascadia Code"');
  change('danmakuTextColor', '#aabbcc');
  f.node('danmakuBackgroundOpacity').min = '0';
  f.node('danmakuBackgroundOpacity').max = '100';
  change('danmakuBackgroundOpacity', '35');
  change('danmakuGiftImage', 'gift');
  assert.equal(f.node('danmakuScrollDirection').value, 'up');
  change('danmakuScrollDirection', 'down');
  f.click('minimal');
  assert.equal(f.node('danmakuScrollDirectionField').hidden, false);
  assert.equal(f.node('danmakuScrollDirection').value, 'up');
  assert.equal(f.node('danmakuTextColor').value, '#f7f9ff');
  assert.equal(f.node('danmakuFontSize').max, '40');
  assert.equal(f.node('danmakuBackgroundOpacityField').hidden, true);
  assert.equal(f.node('danmakuGiftImageField').hidden, true);
  assert.equal(f.node('danmakuFontSize').value, '30');
  change('danmakuFontSize', '41');
  assert.equal(f.node('danmakuFontSize').value, '30');
  change('danmakuFontSize', '24');
  f.click('glow');
  assert.equal(f.node('danmakuEntranceAnimationField').hidden, false);
  assert.equal(f.node('danmakuEntranceAnimation').value, 'fade');
  change('danmakuEntranceAnimation', 'rise');
  f.click('twitter');
  assert.equal(f.node('danmakuComposerTextField').hidden, false);
  change('danmakuComposerText', '欢迎 ♥ Hello');
  change('danmakuTwitterHeader', 'hide');
  change('danmakuTwitterComposer', 'hide');
  change('danmakuTwitterActions', 'hide');
  change('danmakuTwitterColor0', '#12345680');
  change('danmakuTwitterColor50', '#234567');
  change('danmakuTwitterColor100', '#345678');
  change('danmakuTwitterColor1000', '#456789');
  f.click('signal');
  assert.equal(f.node('danmakuComposerTextField').hidden, true);
  assert.equal(f.node('danmakuEntranceAnimationField').hidden, true);
  assert.equal(f.node('danmakuTextColor').value, '#aabbcc');
  assert.equal(f.node('danmakuFontSize').value, '42');
  assert.equal(f.node('danmakuGiftImage').value, 'gift');
  assert.equal(f.node('danmakuScrollDirection').value, 'down');
  f.click('previewOverlayButton');
  const expected = {
    signal: {
      fontSize: 42,
      fontFamily: '"Cascadia Code"',
      textColor: '#aabbcc',
      backgroundOpacity: 35,
      giftImage: 'gift',
      scrollDirection: 'down',
    },
    minimal: { fontSize: 24 },
    glow: { entranceAnimation: 'rise' },
    twitter: { composerText: '欢迎 ♥ Hello', twitterHeader: 'hide', twitterComposer: 'hide', twitterActions: 'hide',
      twitterColor0: '#12345680', twitterColor50: '#234567', twitterColor100: '#345678', twitterColor1000: '#456789' },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(f.editors.at(-1).draft.styleOptions)), expected);
  assert.equal(f.writes.length, 0);
  const pending = f.click('danmakuApplyOverlayBtn');
  assert.deepEqual(f.writes[0].parameters.styleOptions, expected);
  f.writes[0].resolve({ ...saved(), styleOptions: expected });
  await pending;
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, true);
  f.click('danmakuResetParameters');
  assert.equal(f.node('danmakuScrollDirection').value, 'up');
  assert.equal(f.node('danmakuTextColor').value, '#eaf2ff');
  assert.equal(f.node('danmakuFontSize').value, '30');
  f.click('minimal');
  assert.equal(f.node('danmakuFontSize').value, '24');
  f.click('glow');
  assert.equal(f.node('danmakuEntranceAnimation').value, 'rise');
  f.click('danmakuResetParameters');
  assert.equal(f.node('danmakuEntranceAnimation').value, 'fade');
  f.account('');
  assert.equal(f.node('danmakuFontSize').disabled, true);
  assert.equal(f.node('danmakuFontFamily').value, '"Microsoft YaHei UI"');
  assert.equal(f.node('danmakuScrollDirection').disabled, true);
  assert.equal(f.node('danmakuEntranceAnimation').disabled, true);
});

test('canvas drafts use local persistence and remain after a rejected write', async () => {
  const f = await fixture();
  f.reads[0].resolve({ ...saved(), styleOptions: {}, layout: null });
  await flush();
  f.click('previewOverlayButton');
  assert.equal(f.editors[0].canApply, true);
  const layout = require('../../src/shared/danmaku-layout').createLayout();
  layout.regions.signal.x = 200;
  f.editors[0].onChange({ style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {}, layout });
  assert.equal(f.writes.length, 0);
  const pending = f.editors[0].onApply();
  assert.deepEqual(f.writes[0].parameters.layout, layout);
  f.writes[0].reject(new Error('本机保存失败'));
  await pending;
  assert.match(f.elements.styleSaveState.textContent, /草稿已保留.*本机保存失败/);
  const retry = f.editors[0].onApply();
  f.writes[1].resolve({ ...saved(), styleOptions: {}, layout });
  await retry;
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, true);
});

test('local defaults keep all supported appearance controls available', async () => {
  const f = await fixture();
  const legacy = saved();
  f.reads[0].resolve(legacy);
  await flush();
  assert.equal(f.node('danmakuFontSize').disabled, false);
  assert.equal(f.node('danmakuScrollDirection').disabled, false);
  f.click('outline');
  assert.equal(f.elements.fullscreenDuration.disabled, false);
  assert.match(f.elements.styleChip.textContent, /待应用.*一纸素笺/);
  f.click('glow');
  assert.equal(f.node('danmakuEntranceAnimation').disabled, false);
});

for (const [style, label] of [
  ['cream', '杏花白'],
  ['glow', '流光溢彩'],
]) {
  test(`${style} is a random-style draft with duration, read-only preview and explicit apply`, async () => {
    const f = await fixture();
    f.reads[0].resolve(saved());
    await flush();
    f.click(style);
    assert.equal(f.node('danmakuScrollDirectionField').hidden, true);
    f.duration('9');
    assert.equal(f.elements.fullscreenDurationField.hidden, false);
    assert.match(f.elements.styleChip.textContent, new RegExp(`待应用.*${label}`));
    f.click('previewOverlayButton');
    assert.equal(f.editors[0].draft.style, style);
    assert.equal(f.editors[0].draft.styleOptions[style].durationSeconds, 9);
    assert.equal(f.writes.length, 0);
    const pending = f.click('danmakuApplyOverlayBtn');
    assert.deepEqual(f.writes[0].parameters, { style, fullscreenDurationSeconds: 6, styleOptions: { [style]: { durationSeconds: 9 } } });
    f.writes[0].resolve({ ...saved(style), styleOptions: f.writes[0].parameters.styleOptions });
    await pending;
    assert.match(f.elements.styleChip.textContent, new RegExp(`已应用样式.*${label}`));
    assert.equal(f.node('danmakuApplyOverlayBtn').disabled, true);
    f.click('outline');
    assert.equal(f.node('danmakuScrollDirectionField').hidden, true);
    assert.equal(f.elements.fullscreenDurationField.hidden, false);
    f.click('signal');
    assert.equal(f.node('danmakuScrollDirectionField').hidden, false);
    assert.equal(f.elements.fullscreenDurationField.hidden, true);
  });
}

test('a late read cannot replace a draft and an old account save cannot affect the new account', async () => {
  const f = await fixture();
  f.reads[0].resolve(saved());
  await flush();
  const reload = f.click('danmakuReloadOverlayBtn');
  f.click('transparent');
  f.reads[1].resolve(saved('bubble'));
  await reload;
  assert.match(f.elements.styleChip.textContent, /待应用.*留白/);
  const pending = f.click('danmakuApplyOverlayBtn');
  f.account('');
  assert.match(f.elements.styleSaveState.textContent, /请先连接/);
  const nextUrl = 'https://other.example.test/overlay/syntheticKey_123';
  f.account(nextUrl);
  f.reads[2].resolve(saved('ranked', 8, nextUrl));
  await flush();
  f.writes[0].resolve(saved('transparent'));
  await pending;
  assert.match(f.elements.styleChip.textContent, /已应用样式.*经典样式/);
  f.click('outline');
  assert.equal(f.elements.fullscreenDuration.value, '8');
});

test('local preview is available without authorization and the appearance panel exposes no old source link', async () => {
  const f = await fixture();
  assert.doesNotMatch(source('danmaku-overlay-settings.js'), /getOverlaySettings|updateOverlaySettings|bindCopyUrl|window\.open/);
  f.account('');
  assert.equal(f.elements.previewOverlayButton.disabled, false);
  f.click('previewOverlayButton');
  assert.equal(f.editors.at(-1).canApply, false);
  assert.equal(f.writes.length, 0);
});

test('both address observers read the server capability and discard late account responses', async () => {
  const reads = [];
  let onState;
  let hide;
  const a = { state: 'authorized', streamer: { accountName: 'a', songPageUrl: 'https://a.example.test/' } };
  const b = { state: 'authorized', streamer: { accountName: 'b', songPageUrl: 'https://b.example.test/' } };
  const bridge = {
    getState: async () => a,
    onStateChanged: (callback) => {
      onState = callback;
      return () => {};
    },
    getOverlaySettings: () => new Promise((resolve) => reads.push(resolve)),
  };
  const context = vm.createContext({
    URL,
    window: {
      liraLicense: bridge,
      addEventListener: (_event, fn) => {
        hide = fn;
      },
    },
  });
  const module = new vm.SourceTextModule(source('server-overlay-url.js'), { context });
  await module.link(() => {});
  await module.evaluate();
  const first = [],
    second = [];
  module.namespace.observeServerOverlayUrl((value) => first.push(value));
  module.namespace.observeServerOverlayUrl((value) => second.push(value));
  let initialized = false;
  const initialization = module.namespace.waitForServerOverlayUrlInitialization().then(() => {
    initialized = true;
  });
  await flush();
  assert.equal(reads.length, 1);
  assert.equal(initialized, false);
  const aUrl = 'https://a.example.test/overlay/syntheticKey_123';
  reads.shift()(saved('signal', 6, aUrl));
  await initialization;
  assert.equal(initialized, true);
  assert.equal(first.at(-1), aUrl);
  assert.deepEqual(second, first);
  onState(a); // An old account request remains in flight.
  onState(b);
  assert.equal(first.at(-1), '');
  reads.shift()(saved('signal', 6, aUrl));
  await flush();
  assert.equal(first.at(-1), '');
  const bUrl = 'https://b.example.test/overlay/anotherKey_12345';
  reads.shift()(saved('signal', 6, bUrl));
  await flush();
  assert.equal(first.at(-1), bUrl);
  assert.deepEqual(second, first);
  onState({ state: 'blocked' });
  assert.equal(first.at(-1), '');
  hide();
});

test('restored authorization loads the profile before resolving the overlay address', async () => {
  const snapshot = { state: 'authorized', streamer: { accountName: 'restored', songPageUrl: '' } };
  const calls = [];
  const context = vm.createContext({
    URL,
    window: {
      liraLicense: {
        getState: async () => snapshot,
        getProfile: async () => {
          calls.push('profile');
          return { ok: true, ...snapshot, streamer: {
            ...snapshot.streamer, songPageUrl: 'https://broadcaster.example.test:9443/',
          } };
        },
        getOverlaySettings: async () => { calls.push('settings'); return saved(); },
      },
      addEventListener() {},
    },
  });
  const module = new vm.SourceTextModule(source('server-overlay-url.js'), { context });
  await module.link(() => {});
  await module.evaluate();
  const addresses = [];
  module.namespace.observeServerOverlayUrl((value) => addresses.push(value));
  module.namespace.observeServerOverlayUrl(() => {});
  await module.namespace.waitForServerOverlayUrlInitialization();
  assert.deepEqual(calls, ['profile', 'settings']);
  assert.deepEqual(addresses, ['', url]);
});

test('a profile response from the previous account cannot load its overlay after an account switch', async () => {
  const a = { state: 'authorized', streamer: { accountName: 'a' } };
  const b = { state: 'authorized', streamer: { accountName: 'b', songPageUrl: 'https://b.example.test/' } };
  const bUrl = 'https://b.example.test/overlay/anotherKey_12345';
  let onState;
  let resolveProfile;
  let reads = 0;
  const context = vm.createContext({
    URL,
    window: {
      liraLicense: {
        getState: async () => a,
        onStateChanged: (listener) => { onState = listener; },
        getProfile: () => new Promise((resolve) => { resolveProfile = resolve; }),
        getOverlaySettings: async () => { reads += 1; return saved('signal', 6, bUrl); },
      },
      addEventListener() {},
    },
  });
  const module = new vm.SourceTextModule(source('server-overlay-url.js'), { context });
  await module.link(() => {});
  await module.evaluate();
  const addresses = [];
  module.namespace.observeServerOverlayUrl((value) => addresses.push(value));
  await flush();
  assert.equal(reads, 0);
  onState(b);
  await flush();
  assert.equal(addresses.at(-1), bUrl);
  resolveProfile({ ok: true, ...a, streamer: { ...a.streamer, songPageUrl: 'https://a.example.test/' } });
  await module.namespace.waitForServerOverlayUrlInitialization();
  assert.equal(reads, 1);
  assert.deepEqual(addresses, ['', bUrl]);
});

test('URL resolver refuses bare, wrong-origin and malformed server addresses', async () => {
  const module = new vm.SourceTextModule(source('server-overlay-url.js'), { context: vm.createContext({ URL }) });
  await module.link(() => {});
  await module.evaluate();
  const snapshot = { state: 'authorized', streamer: { songPageUrl: 'https://a.example.test/' } };
  for (const value of [
    'https://a.example.test/overlay',
    'https://b.example.test/overlay/syntheticKey_123',
    'https://a.example.test/overlay/short',
    'https://a.example.test/overlay/syntheticKey_123?token=x',
    'https://a.example.test/overlay/syntheticKey_123#hash',
  ]) {
    assert.equal(module.namespace.serverOverlayUrl(snapshot, saved('signal', 6, value)), '');
  }
});
