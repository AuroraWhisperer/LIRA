const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createParameterDocument } = require('../helpers/parameter-dom');
const { createDanmakuPreviewItems } = require('../../public/js/overlays/danmaku-preview-samples.js');

const styles = ['comic', 'bubble', 'signal', 'minimal', 'ranked', 'transparent', 'identity', 'sketch', 'prismatic', 'harbor', 'snowfox', 'ripploid', 'twitter', 'spooky', 'starlight', 'moonlit', 'outline', 'mist', 'whiteframe', 'cream', 'glow', 'starveil'];

async function fixture(search = '?preview=1', savedStyle) {
  const document = createParameterDocument();
  const node = document.getElementById;
  const buttons = [...styles, 'floating', 'comet'].map((style) => {
    const button = node(style);
    button.dataset.previewStyle = style;
    button.querySelector = () => ({ textContent: `${style} description`, firstChild: { textContent: style } });
    return button;
  });
  node('danmakuPreviewControls').querySelectorAll = (selector) => selector === '[data-preview-style]' ? buttons : [];
  const listeners = {};
  document.hidden = false;
  document.addEventListener = (name, handler) => { listeners[name] = handler; };
  document.removeEventListener = (name, handler) => { if (listeners[name] === handler) delete listeners[name]; };
  document.documentElement = node('root');
  const location = new URL(`http://127.0.0.1:3000/danmaku${search}`);
  const history = {
    state: typeof savedStyle === 'object' ? savedStyle : savedStyle ? { danmakuPreviewStyle: savedStyle } : null,
    replaceState(state, _title, url) {
      this.state = state;
      location.href = new URL(url, location).href;
    },
  };
  const renders = [], appends = [], options = [], destroyedFeeds = [];
  const timeouts = new Map();
  const frames = new Map();
  const windowListeners = new Map();
  let timerSequence = 0;
  let elapsed = 0;
  function flushFrames() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  }
  function advance(milliseconds) {
    const target = elapsed + milliseconds;
    while (true) {
      const next = [...timeouts.values()].sort((a, b) => a.next - b.next)[0];
      if (!next || next.next > target) break;
      elapsed = next.next;
      timeouts.delete(next.id);
      next.callback();
      flushFrames();
    }
    elapsed = target;
    flushFrames();
  }
  function advanceMessages(count) {
    for (let index = 0; index < count; index += 1) {
      const next = [...timeouts.values()].sort((a, b) => a.next - b.next)[0];
      assert.ok(next, 'playback must schedule the next message');
      advance(next.next - elapsed);
    }
  }
  let randomSeed = 1;
  const math = Object.create(Math);
  math.random = () => {
    randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0;
    return randomSeed / 2 ** 32;
  };
  const context = vm.createContext({
    Math: math,
    document,
    location,
    URLSearchParams,
    ResizeObserver: class { observe() {} disconnect() {} },
    URL,
    window: {
      location, history, innerWidth: 1366, innerHeight: 900,
      Event,
      addEventListener(name, handler) {
        if (!windowListeners.has(name)) windowListeners.set(name, new Set());
        windowListeners.get(name).add(handler);
      },
      removeEventListener(name, handler) { windowListeners.get(name)?.delete(handler); },
      dispatchEvent(event) { windowListeners.get(event.type)?.forEach(handler => handler(event)); },
    },
    WebSocket: class {
      constructor() {
        assert.fail('preview must not connect');
      }
    },
    setTimeout(callback, delay) {
      const id = ++timerSequence;
      timeouts.set(id, { id, callback, delay, next: elapsed + delay });
      return id;
    },
    clearTimeout: (id) => timeouts.delete(id),
    requestAnimationFrame(callback) {
      const id = ++timerSequence;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  const read = (file) => fs.readFileSync(path.join(__dirname, '../../public/js/overlays', file), 'utf8');
  if (history.state) history.state = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(history.state))})`, context);
  context.window.parent = context.window;
  document.defaultView = context.window;
  const module = new vm.SourceTextModule(read('danmaku.js'), { context, identifier: path.resolve(__dirname, '../../public/js/overlays/danmaku.js') });
  const cache = new Map();
  await module.link((specifier, parent) => {
    if (specifier !== './danmaku-feed.js') {
      const file = path.resolve(path.dirname(parent.identifier), specifier);
      if (!cache.has(file)) cache.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file }));
      return cache.get(file);
    }
    return new vm.SyntheticModule(
      ['createDanmakuFeed'],
      function () {
        this.setExport('createDanmakuFeed', (_root, config) => {
          options.push(config);
          return {
            destroy() { destroyedFeeds.push(config); },
            render(items) {
              renders.push(items);
            },
            append(item) { appends.push(item); },
            setSpeedPixelsPerSecond(value) { config.speedPixelsPerSecond = value; },
            setFloatingDispersion(value) { config.floatingDispersion = value; },
            setRandomPlacement(value) { Object.assign(config, value); },
            setExpirationOptions(value) { Object.assign(config, value); },
          };
        });
      },
      { context },
    );
  });
  await module.evaluate();
  listeners.DOMContentLoaded();
  flushFrames();
  return { node, location, history, document, renders, appends, options, timeouts, frames, destroyedFeeds,
    advance, advanceMessages, flushFrames,
    setHidden(hidden) { document.hidden = hidden; listeners.visibilitychange?.(); },
    pagehide: () => windowListeners.get('pagehide').forEach((handler) => handler()) };
}

test('standalone parameters retain per-style lifetimes and effect history through switch, reset and reload', async () => {
  const effects = { outline: { showEntryMessages: true }, cream: { showEntryMessages: false } };
  const f = await fixture('?preview=1&style=outline&fullscreenDurationSeconds=12', { danmakuStyleParameters: effects });
  assert.equal(f.node('previewDuration').value, '12');
  const change = value => { f.node('previewDuration').value = value; f.node('previewDuration').events.change(); };
  change('3');
  assert.equal(f.options.at(-1).itemLifetimeMs, 3000);
  f.node('cream').events.click();
  assert.equal(f.node('previewDuration').value, '12');
  change('9');
  assert.equal(f.options.at(-1).itemLifetimeMs, 9000);
  f.node('outline').events.click();
  assert.equal(f.node('previewDuration').value, '3');
  f.node('previewAppearanceReset').events.click();
  assert.equal(f.options.at(-1).itemLifetimeMs, 6000);
  assert.equal(f.history.state.danmakuStyleOptions.cream.durationSeconds, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(f.history.state.danmakuStyleParameters)), effects);
  const restored = await fixture('?preview=1', f.history.state);
  assert.equal(restored.node('previewDuration').value, '6');
  assert.equal(restored.history.state.danmakuStyleOptions.cream.durationSeconds, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.history.state.danmakuStyleParameters)), effects);
});

test('preview welcome toggle adds only a simulated robot welcome instead of an entrance notice', async () => {
  for (const enabled of [undefined, false, true]) {
    const f = await fixture('?preview=1&style=signal', {
      danmakuStyleParameters: { signal: { showEntryMessages: enabled } },
    });
    f.advanceMessages(createDanmakuPreviewItems().length);
    assert.equal(f.appends.some(item => item.isWelcome === true), enabled !== false);
    assert.equal(f.appends.some(item => item.kind === 'entry'), false);
    if (enabled !== false) {
      const welcome = f.appends.find(item => item.isWelcome);
      assert.equal(welcome.kind, 'danmaku');
      assert.equal(welcome.name, 'LIRA 机器人');
      assert.equal(welcome.message, '欢迎 路过的咸鱼_07 来到直播间～');
    }
    f.pagehide();
  }
});

test('preview plays every sample once per round with one timer and stops on close', async () => {
  const f = await fixture();
  assert.equal(f.renders.at(-1).length, 0, 'examples must arrive incrementally instead of as a snapshot');
  assert.equal(f.appends.length, 1);
  assert.equal(f.timeouts.size, 1);
  f.advance(1599);
  assert.equal(f.appends.length, 1);
  f.advanceMessages(1);
  assert.equal(f.appends.length, 2);
  const sampleCount = createDanmakuPreviewItems().length + 1;
  f.advanceMessages(sampleCount * 2 - 2);
  const firstRound = f.appends.slice(0, sampleCount).map((item) => item.id.replace(/-\d+$/u, ''));
  const secondRound = f.appends.slice(sampleCount).map((item) => item.id.replace(/-\d+$/u, ''));
  assert.equal(new Set(firstRound).size, sampleCount, 'all examples appear before any repeats');
  assert.deepEqual([...firstRound].sort(), [...secondRound].sort());
  assert.equal(new Set(f.appends.map((item) => item.id)).size, sampleCount * 2);
  for (const control of ['previewRefresh', 'cream', 'glow', 'signal']) {
    f.node(control).events.click();
    assert.equal(f.timeouts.size, 1, 'restarting must replace the existing playback timer');
    f.flushFrames();
  }
  const count = f.appends.length;
  f.advanceMessages(1);
  assert.equal(f.appends.length, count + 1);
  f.node('previewRefresh').events.click();
  assert.equal(f.frames.size, 1);
  f.pagehide();
  assert.equal(f.timeouts.size, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.destroyedFeeds.at(-1), f.options.at(-1));
  f.advance(9000);
  assert.equal(f.appends.length, count + 1);
});

test('preview pauses while hidden and resumes without accumulating messages or timers', async () => {
  const f = await fixture();
  f.setHidden(true);
  assert.equal(f.timeouts.size, 0);
  f.advance(20000);
  assert.equal(f.appends.length, 1);
  f.node('cream').events.click();
  assert.equal(f.timeouts.size, 0);
  f.setHidden(false);
  f.flushFrames();
  assert.equal(f.appends.length, 2);
  assert.equal(f.timeouts.size, 1);
  f.advanceMessages(1);
  assert.equal(f.appends.length, 3);
  f.pagehide();
  f.setHidden(false);
  assert.equal(f.timeouts.size, 0, 'closing removes the visibility listener');
});

test('appearance edits preserve current messages and playback timing while explicit replay restarts', async () => {
  for (const style of ['starveil', 'signal', 'floating']) {
    const f = await fixture(`?preview=1&style=${style}`);
    f.advanceMessages(2);
    const originalFeed = f.options.at(-1);
    const messages = f.appends.length;
    const renders = f.renders.length;
    const timers = [...f.timeouts.keys()];
    const edits = [['previewBackgroundOpacity', '55'], ['previewTextColor', '#abcdef'], ['previewFontSize', '32']];
    if (style === 'starveil') edits.push(['previewDuration', '12'], ['previewExitDurationMs', '750']);
    for (const [id, value] of edits) {
      const control = f.node(id);
      control.min = '0'; control.max = '100'; control.value = value;
      control.events.change();
      f.flushFrames();
      assert.equal(f.options.at(-1), originalFeed, `${style}: ${id} keeps the feed`);
      assert.equal(f.appends.length, messages, 'editing must not introduce a new sample');
      assert.equal(f.renders.length, renders, 'editing must not clear existing messages');
      assert.deepEqual([...f.timeouts.keys()], timers, 'editing must not reset the next message timer');
    }
    f.node('previewRefresh').events.click();
    f.flushFrames();
    assert.notEqual(f.options.at(-1), originalFeed, 'explicit replay still recreates the feed');
    assert.equal(f.appends.length, messages + 1);
    assert.equal(f.timeouts.size, 1);
    f.pagehide();
  }
});

test('local preview applies per-style parameters without external image requests', async () => {
  const options = {
    signal: { fontSize: 42, fontFamily: 'serif', backgroundOpacity: 35, giftImage: 'gift', scrollDirection: 'down' },
    minimal: { fontSize: 24 },
  };
  const f = await fixture(`?preview=1&style=signal&styleOptions=${encodeURIComponent(JSON.stringify(options))}`);
  assert.equal(f.node('root').style['--danmaku-font-size'], '42px');
  assert.deepEqual(JSON.parse(JSON.stringify(f.history.state.danmakuStyleOptions)), options);
  const gift = createDanmakuPreviewItems().find(item => item.id === 'preview-gift-cheer');
  assert.equal(f.options.at(-1).resolveGiftImageUrl(gift.giftImageUrl), gift.giftImageUrl);
  f.node('minimal').events.click();
  assert.equal(f.node('root').style['--danmaku-font-size'], '24px');
  assert.equal(f.options.at(-1).resolveGiftImageUrl(gift.giftImageUrl), '');
});

test('preview resolves only its bundled gift images, even with legacy theme options', async () => {
  const options = { identity: { giftImage: 'theme' } };
  const f = await fixture(`?preview=1&style=identity&styleOptions=${encodeURIComponent(JSON.stringify(options))}`);
  const gift = createDanmakuPreviewItems('identity').find(item => item.kind === 'gift');
  assert.equal(f.options.at(-1).resolveGiftImageUrl(gift.giftImageUrl), gift.giftImageUrl);
  assert.equal(f.options.at(-1).resolveGiftImageUrl('/img/gift-placeholder.png'), '');
  assert.equal(f.options.at(-1).resolveGiftImageUrl('/img/overlays/danmaku-previews/gifts/unknown.webp'), '');
  assert.equal(f.options.at(-1).resolveGiftImageUrl('https://example.com/gift.webp'), '');
});

test('scaled appearance edits keep logical font sizes and reset only the selected style', async () => {
  const f = await fixture('?preview=1&style=signal');
  const preset = f.node('canvasPreset');
  preset.value = '3840x2160';
  preset.events.change({ target: preset });
  const fontSize = f.node('previewFontSize');
  assert.equal(fontSize.value, '60');
  fontSize.value = '80';
  fontSize.events.change();
  assert.equal(f.history.state.danmakuStyleOptions.signal.fontSize, 40);

  f.node('bubble').events.click();
  const color = f.node('previewTextColor');
  color.value = '#abcdef';
  color.events.change();
  assert.equal(f.history.state.danmakuStyleOptions.bubble.textColor, '#abcdef');
  f.node('previewAppearanceReset').events.click();
  assert.deepEqual(JSON.parse(JSON.stringify(f.history.state.danmakuStyleOptions)), {
    signal: { fontSize: 40 },
    bubble: {},
  });

  f.node('signal').events.click();
  assert.equal(fontSize.value, '80');
  fontSize.value = '97';
  fontSize.events.change();
  assert.equal(fontSize.value, '80');
  assert.equal(f.history.state.danmakuStyleOptions.signal.fontSize, 40);
});

test('random and floating motion controls reach the existing preview feed', async () => {
  const f = await fixture('?preview=1&style=outline');
  for (const [id, key, value] of [['previewCenterBias', 'centerBias', 45], ['previewDispersion', 'dispersion', 38]]) {
    const control = f.node(id);
    control.min = '1'; control.max = '50'; control.value = String(value);
    control.events.change();
    assert.equal(f.history.state.danmakuStyleOptions.outline[key], value);
    assert.equal(f.options.at(-1)[key], value);
  }
  f.node('floating').events.click();
  const originalFeed = f.options.at(-1);
  for (const [id, key, value] of [['previewFloatingSpeed', 'speedPixelsPerSecond', 360], ['previewFloatingDispersion', 'floatingDispersion', 100]]) {
    const control = f.node(id);
    control.min = '1'; control.max = '100'; control.value = '100';
    control.events.change();
    assert.equal(f.history.state.danmakuStyleOptions.floating[key], value);
    assert.equal(f.options.at(-1)[key], value);
    assert.equal(f.options.at(-1), originalFeed, 'motion edits keep the existing preview feed');
  }
});

test('resizing a fixed region preserves logical typography without replaying messages', async () => {
  const f = await fixture('?preview=1&style=signal');
  const playbackCount = f.appends.length;
  f.node('regionWidth').value = '280';
  f.node('regionWidth').events.change();
  f.node('previewFontSize').value = '20';
  f.node('previewFontSize').events.change();
  assert.equal(f.history.state.danmakuStyleOptions.signal.fontSize, 40);
  f.node('regionWidth').value = '560';
  f.node('regionWidth').events.change();
  assert.equal(f.node('previewFontSize').value, '40');
  assert.equal(f.appends.length, playbackCount, 'resizing must not replay or duplicate messages');
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
    '',
    'http://i0.hdslb.com/avatar.png',
    '/avatar.png',
    'https://hdslb.com.example.com/avatar.png',
    'https://example.com/avatar.png',
    'https://user:password@i0.hdslb.com/avatar.png',
  ]) {
    assert.equal(resolveAvatarUrl(invalid), '', invalid);
  }
  const html = fs.readFileSync(path.join(__dirname, '../../public/pages/overlays/danmaku.html'), 'utf8');
  assert.match(html, /<meta name="referrer" content="no-referrer"\s*\/>/u);
});
