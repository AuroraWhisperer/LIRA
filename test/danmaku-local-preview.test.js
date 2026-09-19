const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const styles = ['bubble', 'signal', 'minimal', 'ranked', 'transparent', 'identity', 'outline', 'cream', 'glow'];

async function fixture(search = '?preview=1', savedStyle) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', hidden: true, dataset: {}, events: {}, clientWidth: 1000, clientHeight: 800,
      style: { setProperty() {} },
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, handler) { this.events[name] = handler; },
    });
    return nodes.get(id);
  };
  const buttons = styles.map((style) => {
    const button = node(style);
    button.dataset.previewStyle = style;
    button.querySelector = () => ({ textContent: `${style} description` });
    return button;
  });
  node('danmakuPreviewControls').querySelectorAll = () => buttons;
  const listeners = {};
  const document = {
    getElementById: node,
    addEventListener(name, handler) { listeners[name] = handler; },
    documentElement: node('root'),
    body: { dataset: {}, classList: { add() {}, toggle() {} } },
  };
  const location = new URL(`http://127.0.0.1:3000/danmaku${search}`);
  const history = {
    state: savedStyle ? { danmakuPreviewStyle: savedStyle } : null,
    replaceState(state, _title, url) { this.state = state; location.href = new URL(url, location).href; },
  };
  const renders = [], options = [];
  const context = vm.createContext({
    document, location, URLSearchParams, URL,
    window: { location, history, innerWidth: 1366, innerHeight: 900, addEventListener() {} },
    WebSocket: class { constructor() { assert.fail('preview must not connect'); } },
    setInterval() { assert.fail('preview must not loop'); },
    setTimeout() { assert.fail('preview must not schedule message playback'); },
  });
  const read = (file) => fs.readFileSync(path.join(__dirname, '../public/js/overlays', file), 'utf8');
  const module = new vm.SourceTextModule(read('danmaku.js'), { context });
  await module.link((specifier) => {
    if (specifier === './danmaku-preview.js') return new vm.SourceTextModule(read('danmaku-preview.js'), { context });
    return new vm.SyntheticModule(['createDanmakuFeed'], function () {
      this.setExport('createDanmakuFeed', (_root, config) => {
        options.push(config);
        return { destroy() {}, render(items) { renders.push(items); } };
      });
    }, { context });
  });
  await module.evaluate();
  listeners.DOMContentLoaded();
  return { node, location, history, document, renders, options };
}

test('all local styles share one address and retain every example without looping or connecting', async () => {
  const f = await fixture('?preview=1&style=cream&fullscreenDurationSeconds=12');
  const url = 'http://127.0.0.1:3000/danmaku?preview=1';
  assert.equal(f.location.href, url);
  assert.equal(f.document.body.dataset.style, 'cream');
  for (const style of styles) {
    f.node(style).events.click();
    assert.equal(f.document.body.dataset.style, style);
    assert.equal(f.location.href, url);
    assert.equal(f.history.state.danmakuPreviewStyle, style);
    assert.equal(f.node(style)['aria-pressed'], 'true');
    const items = f.renders.at(-1);
    assert.equal(items.length, 6);
    assert.deepEqual(Array.from(items.slice(0, 4), (item) => item.guardLevel || 0), [1, 2, 3, 0]);
    assert.ok(items.slice(0, 4).every((item) => item.message.includes('[打call]') && item.emotes.length));
    assert.ok(items.some((item) => item.message === '[打call]'));
    assert.equal(items.find((item) => item.id === 'preview-emote').isStreamer, true);
    assert.ok(items.slice(0, 4).every((item) => item.isStreamer !== true));
    assert.ok(items.some((item) => item.kind === 'gift' && item.giftCount === 10));
    assert.equal(items.filter((item) => item.kind === 'gift').length, 1);
    assert.equal(items.find((item) => item.kind === 'gift').giftTotalPrice, 1);
    assert.equal(f.options.at(-1).showGiftTotal, ['transparent', 'cream'].includes(style));
    assert.ok(items.every((item) => item.id !== 'preview-thanks'));
    assert.equal(f.options.at(-1).resolveEmoteUrl(items[0].emotes[0].url), '/img/overlays/danmaku-previews/dacall.png');
    if (['outline', 'cream', 'glow'].includes(style)) {
      assert.equal(f.options.at(-1).expireItems, false);
      assert.equal(f.options.at(-1).layout, undefined, 'preview keeps all samples in static document flow');
      assert.equal(f.options.at(-1).showAvatar, style === 'cream');
    }
  }
});

test('local preview restores the last style on reload and rejects unknown initial styles', async () => {
  assert.equal((await fixture('?preview=1', 'identity')).document.body.dataset.style, 'identity');
  assert.equal((await fixture('?preview=1&style=unknown')).document.body.dataset.style, 'signal');
});

test('danmaku avatars load directly from the allowed Bilibili CDN while emotes retain their proxy', async () => {
  const f = await fixture();
  const { resolveAvatarUrl, resolveEmoteUrl } = f.options.at(-1);
  const avatarUrl = 'https://i0.hdslb.com/bfs/face/viewer.webp';
  assert.equal(resolveAvatarUrl(avatarUrl), avatarUrl);
  assert.equal(resolveEmoteUrl(avatarUrl), `/api/bilibili/avatar?url=${encodeURIComponent(avatarUrl)}`);
  for (const invalid of [
    '', 'http://i0.hdslb.com/avatar.png', '/avatar.png',
    'https://hdslb.com.example.com/avatar.png', 'https://example.com/avatar.png',
    'https://user:password@i0.hdslb.com/avatar.png',
  ]) {
    assert.equal(resolveAvatarUrl(invalid), '', invalid);
  }
  const html = fs.readFileSync(path.join(__dirname, '../public/pages/overlays/danmaku.html'), 'utf8');
  assert.match(html, /<meta name="referrer" content="no-referrer"\s*\/>/u);
});
