const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = (file) => fs.readFileSync(path.join(__dirname, '../../public/js/admin', file), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const url = 'https://broadcaster.example.test:9443/overlay/syntheticKey_123';
const saved = (style = 'signal', duration = 6, overlayUrl = url) => ({
  ok: true,
  style,
  fullscreenDurationSeconds: duration,
  overlayUrl,
});

async function fixture() {
  const nodes = new Map();
  const node = (key) => {
    if (!nodes.has(key))
      nodes.set(key, {
        ownerDocument: document,
        value: '',
        textContent: '',
        disabled: false,
        hidden: false,
        dataset: {},
        events: {},
        addEventListener(name, listener) {
          this.events[name] = listener;
        },
        setAttribute(name, value) {
          this[name] = value;
        },
      });
    return nodes.get(key);
  };
  const document = { activeElement: null, getElementById: (id) => node({
    danmakuFullscreenDurationSeconds: 'fullscreenDuration', danmakuFullscreenDurationField: 'fullscreenDurationField',
  }[id] || id) };
  const elements = Object.fromEntries(
    [
      'overlayUrl',
      'styleChip',
      'styleSaveState',
      'fullscreenDurationField',
      'fullscreenDuration',
      'copyOverlayUrlButton',
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
  ].map((style) => {
    const button = node(style);
    button.dataset.danmakuStyle = style;
    return button;
  });
  let observer;
  const reads = [],
    writes = [],
    opened = [],
    copied = [];
  const bridge = {
    getOverlaySettings: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    updateOverlaySettings: (parameters) =>
      new Promise((resolve, reject) =>
        writes.push({ parameters: JSON.parse(JSON.stringify(parameters)), resolve, reject }),
      ),
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    document,
    window: { liraLicense: bridge, open: (...args) => opened.push(args) },
  });
  const editors = [];
  const module = new vm.SourceTextModule(source('danmaku-overlay-settings.js'), {
    context, identifier: path.resolve(__dirname, '../../public/js/admin/danmaku-overlay-settings.js'),
  });
  const modules = new Map();
  await module.link((specifier, parent) => {
    const filename = path.resolve(path.dirname(parent.identifier), specifier);
    if (modules.has(filename)) return modules.get(filename);
    const dependency = !['utils.js', 'danmaku-canvas-dialog.js', 'server-overlay-url.js'].includes(path.basename(filename))
      ? new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename })
      : new vm.SyntheticModule(
          specifier.includes('utils') ? ['copyText', 'localOverlayOrigin'] : specifier.includes('canvas-dialog') ? ['createDanmakuPreview', 'openDanmakuCanvas'] : ['observeServerOverlayUrl'],
          function () {
            if (specifier.includes('utils')) {
              this.setExport('copyText', async (value) => copied.push(value));
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
              this.setExport('observeServerOverlayUrl', (callback) => {
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
  module.namespace.initDanmakuOverlaySettings(elements, () => {});
  const click = (key) => node(key).events.click();
  const duration = (value) => {
    elements.fullscreenDuration.value = value;
    elements.fullscreenDuration.events.change();
  };
  return { elements, node, reads, writes, opened, copied, editors, click, duration, account: (value) => observer(value) };
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
  assert.equal(f.editors[0].draft.fullscreenDurationSeconds, 12);
  assert.equal(f.opened.length, 0);
  assert.equal(f.writes.length, 0);
  const first = f.click('danmakuApplyOverlayBtn');
  void f.click('danmakuApplyOverlayBtn');
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].parameters, { style: 'outline', fullscreenDurationSeconds: 12 });
  f.click('identity');
  f.writes[0].resolve(saved('outline', 12));
  await first;
  assert.match(f.elements.styleChip.textContent, /待应用.*头像横卡/);
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, false);
  const next = f.click('danmakuApplyOverlayBtn');
  f.writes[1].resolve(saved('identity', 12));
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
  f.writes[0].resolve({ ok: false, error: 'NETWORK_UNAVAILABLE' });
  await pending;
  assert.match(f.elements.styleSaveState.textContent, /应用失败.*草稿已保留/);
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, false);
  assert.match(f.elements.styleChip.textContent, /简洁白卡/);
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
  change('danmakuTextColor', '#aabbcc', 'input');
  f.node('danmakuBackgroundOpacity').min = '0';
  f.node('danmakuBackgroundOpacity').max = '100';
  change('danmakuBackgroundOpacity', '35', 'input');
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
  f.click('signal');
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
  f.account('');
  assert.equal(f.node('danmakuFontSize').disabled, true);
  assert.equal(f.node('danmakuFontFamily').value, '"Microsoft YaHei UI"');
  assert.equal(f.node('danmakuScrollDirection').disabled, true);
});

test('canvas drafts apply through the existing save path and remain when an old server drops layout', async () => {
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
  f.writes[0].resolve({ ...saved(), styleOptions: {} });
  await pending;
  assert.match(f.elements.styleSaveState.textContent, /草稿已保留.*未保存画布/);
  const retry = f.editors[0].onApply();
  f.writes[1].resolve({ ...saved(), styleOptions: {}, layout });
  await retry;
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, true);
});

test('older servers keep style editing available and explain unsupported appearance controls', async () => {
  const f = await fixture();
  f.reads[0].resolve(saved());
  await flush();
  assert.equal(f.node('danmakuFontSize').disabled, true);
  assert.match(f.node('danmakuParametersHint').textContent, /更新服务器/);
  assert.equal(f.node('danmakuScrollDirection').disabled, true);
  f.click('outline');
  assert.equal(f.elements.fullscreenDuration.disabled, false);
});

for (const [style, label] of [
  ['cream', '奶油气泡'],
  ['glow', '流光气泡'],
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
    assert.equal(f.editors[0].draft.fullscreenDurationSeconds, 9);
    assert.equal(f.writes.length, 0);
    const pending = f.click('danmakuApplyOverlayBtn');
    assert.deepEqual(f.writes[0].parameters, { style, fullscreenDurationSeconds: 9 });
    f.writes[0].resolve(saved(style, 9));
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
  assert.match(f.elements.styleChip.textContent, /待应用.*透明文字/);
  const pending = f.click('danmakuApplyOverlayBtn');
  f.account('');
  assert.equal(f.elements.overlayUrl.value, '');
  assert.equal(f.elements.copyOverlayUrlButton.disabled, true);
  const nextUrl = 'https://other.example.test/overlay/syntheticKey_123';
  f.account(nextUrl);
  f.reads[2].resolve(saved('ranked', 8, nextUrl));
  await flush();
  f.writes[0].resolve(saved('transparent'));
  await pending;
  assert.equal(f.elements.overlayUrl.value, nextUrl);
  assert.match(f.elements.styleChip.textContent, /已应用样式.*经典样式/);
  assert.equal(f.elements.fullscreenDuration.value, '8');
});

test('copy and open use the server; preview is available locally without authorization', async () => {
  const f = await fixture();
  await f.click('copyOverlayUrlButton');
  f.click('openOverlayButton');
  assert.deepEqual(f.copied, [url]);
  assert.equal(f.opened[0][0], url);
  f.account('');
  assert.equal(f.elements.copyOverlayUrlButton.disabled, true);
  assert.equal(f.elements.openOverlayButton.disabled, true);
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
    getProfile: async () => a,
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
