const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = (file) => fs.readFileSync(path.join(__dirname, '../public/js/admin', file), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const url = 'https://broadcaster.example.test:9443/overlay';
const saved = (style = 'signal', duration = 6, overlayUrl = url) => ({ ok: true, style, fullscreenDurationSeconds: duration, overlayUrl });

async function fixture() {
  const nodes = new Map();
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, {
      value: '', textContent: '', disabled: false, hidden: false, dataset: {}, events: {},
      addEventListener(name, listener) { this.events[name] = listener; },
      setAttribute(name, value) { this[name] = value; },
    });
    return nodes.get(key);
  };
  const elements = Object.fromEntries([
    'overlayUrl', 'styleChip', 'styleSaveState', 'fullscreenDurationField', 'fullscreenDuration',
    'copyOverlayUrlButton', 'openOverlayButton', 'previewOverlayButton',
  ].map((key) => [key, node(key)]));
  elements.styleButtons = ['bubble', 'signal', 'minimal', 'ranked', 'transparent', 'identity', 'outline', 'cream'].map((style) => {
    const button = node(style); button.dataset.danmakuStyle = style; return button;
  });
  let observer;
  const reads = [], writes = [], opened = [], copied = [];
  const bridge = {
    getOverlaySettings: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    updateOverlaySettings: (parameters) => new Promise((resolve, reject) => writes.push({ parameters: JSON.parse(JSON.stringify(parameters)), resolve, reject })),
  };
  const context = vm.createContext({
    URL, URLSearchParams, document: { getElementById: node },
    window: { liraLicense: bridge, open: (...args) => opened.push(args) },
  });
  const module = new vm.SourceTextModule(source('danmaku-overlay-settings.js'), { context });
  await module.link((specifier) => new vm.SyntheticModule(
    specifier.includes('utils') ? ['copyText'] : ['observeServerOverlayUrl'],
    function () {
      if (specifier.includes('utils')) this.setExport('copyText', async (value) => copied.push(value));
      else this.setExport('observeServerOverlayUrl', (callback) => { observer = callback; callback(url); });
    }, { context },
  ));
  await module.evaluate();
  module.namespace.initDanmakuOverlaySettings(elements, () => {});
  const click = (key) => node(key).events.click();
  const duration = (value) => { elements.fullscreenDuration.value = value; elements.fullscreenDuration.events.change(); };
  return { elements, node, reads, writes, opened, copied, click, duration, account: (value) => observer(value) };
}

test('server link uses the authorized configured public origin, including its port', async () => {
  const module = new vm.SourceTextModule(source('server-overlay-url.js'), { context: vm.createContext({ URL }) });
  await module.link(() => {}); await module.evaluate();
  const resolve = module.namespace.serverOverlayUrl;
  assert.equal(resolve({ state: 'authorized', streamer: { songPageUrl: 'https://broadcaster.example.test:9443/?anything=1' } }), url);
  for (const snapshot of [null, { state: 'blocked' }, { state: 'authorized', streamer: { songPageUrl: 'http://127.0.0.1:3000/' } }, { state: 'authorized', streamer: { songPageUrl: 'https://user:secret@example.test/' } }]) assert.equal(resolve(snapshot), '');
});

test('edits and server preview stay local until explicit apply; late save preserves newer draft', async () => {
  const f = await fixture();
  f.reads[0].resolve(saved()); await flush();
  f.click('outline'); f.duration('12');
  f.click('previewOverlayButton');
  const preview = new URL(f.opened[0][0]);
  assert.equal(preview.origin + preview.pathname, url);
  assert.equal(preview.searchParams.get('style'), 'outline');
  assert.equal(preview.searchParams.get('fullscreenDurationSeconds'), '12');
  assert.equal(preview.searchParams.get('preview'), '1');
  assert.equal(f.writes.length, 0);
  const first = f.click('danmakuApplyOverlayBtn');
  await f.click('danmakuApplyOverlayBtn');
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].parameters, { style: 'outline', fullscreenDurationSeconds: 12 });
  f.click('identity');
  f.writes[0].resolve(saved('outline', 12)); await first;
  assert.match(f.elements.styleChip.textContent, /待应用.*身份横卡/);
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, false);
  const next = f.click('danmakuApplyOverlayBtn');
  f.writes[1].resolve(saved('identity', 12)); await next;
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, true);
});

test('failed apply and invalid durations retain the editable draft', async () => {
  const f = await fixture(); f.reads[0].resolve(saved()); await flush();
  f.click('outline'); f.duration('12'); f.duration('31');
  assert.equal(f.elements.fullscreenDuration.value, '12');
  const pending = f.click('danmakuApplyOverlayBtn');
  f.writes[0].resolve({ ok: false, error: 'NETWORK_UNAVAILABLE' }); await pending;
  assert.match(f.elements.styleSaveState.textContent, /应用失败.*草稿已保留/);
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, false);
  assert.match(f.elements.styleChip.textContent, /全屏随机/);
});

test('cream is a random-style draft with duration, read-only preview and explicit apply', async () => {
  const f = await fixture(); f.reads[0].resolve(saved()); await flush();
  f.click('cream'); f.duration('9');
  assert.equal(f.elements.fullscreenDurationField.hidden, false);
  assert.match(f.elements.styleChip.textContent, /待应用.*奶油气泡/);
  f.click('previewOverlayButton');
  const preview = new URL(f.opened[0][0]);
  assert.equal(preview.searchParams.get('style'), 'cream');
  assert.equal(preview.searchParams.get('fullscreenDurationSeconds'), '9');
  assert.equal(f.writes.length, 0);
  const pending = f.click('danmakuApplyOverlayBtn');
  assert.deepEqual(f.writes[0].parameters, { style: 'cream', fullscreenDurationSeconds: 9 });
  f.writes[0].resolve(saved('cream', 9)); await pending;
  assert.match(f.elements.styleChip.textContent, /服务器样式.*奶油气泡/);
  assert.equal(f.node('danmakuApplyOverlayBtn').disabled, true);
  f.click('outline');
  assert.equal(f.elements.fullscreenDurationField.hidden, false);
  f.click('signal');
  assert.equal(f.elements.fullscreenDurationField.hidden, true);
});

test('a late read cannot replace a draft and an old account save cannot affect the new account', async () => {
  const f = await fixture(); f.reads[0].resolve(saved()); await flush();
  const reload = f.click('danmakuReloadOverlayBtn');
  f.click('transparent');
  f.reads[1].resolve(saved('bubble')); await reload;
  assert.match(f.elements.styleChip.textContent, /待应用.*透明简约/);
  const pending = f.click('danmakuApplyOverlayBtn');
  f.account('');
  assert.equal(f.elements.overlayUrl.value, '');
  assert.equal(f.elements.copyOverlayUrlButton.disabled, true);
  const nextUrl = 'https://other.example.test/overlay';
  f.account(nextUrl);
  f.reads[2].resolve(saved('ranked', 8, nextUrl)); await flush();
  f.writes[0].resolve(saved('transparent')); await pending;
  assert.equal(f.elements.overlayUrl.value, nextUrl);
  assert.match(f.elements.styleChip.textContent, /服务器样式.*直播气泡/);
  assert.equal(f.elements.fullscreenDuration.value, '8');
});
