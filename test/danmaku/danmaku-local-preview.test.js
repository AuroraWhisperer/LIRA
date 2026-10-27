const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDanmakuPreviewItems } = require('../../public/js/overlays/danmaku-preview-samples.js');

const styles = ['bubble', 'signal', 'minimal', 'ranked', 'transparent', 'identity', 'sketch', 'prismatic', 'harbor', 'snowfox', 'ripploid', 'twitter', 'spooky', 'starlight', 'moonlit', 'outline', 'mist', 'whiteframe', 'cream', 'glow', 'starveil'];
const randomStyles = ['outline', 'mist', 'whiteframe', 'cream', 'glow', 'starveil'];

async function fixture(search = '?preview=1', savedStyle) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        textContent: '',
        hidden: true,
        dataset: {},
        options: [],
        append(option) { this.options.push(option); },
        events: {},
        clientWidth: 1000,
        clientHeight: 800,
        style: {
          setProperty(name, value) {
            this[name] = value;
          },
        },
        setAttribute(name, value) {
          this[name] = value;
        },
        addEventListener(name, handler) {
          this.events[name] = handler;
        },
      });
    return nodes.get(id);
  };
  const buttons = [...styles, 'floating', 'comet'].map((style) => {
    const button = node(style);
    button.dataset.previewStyle = style;
    button.querySelector = () => ({ textContent: `${style} description`, firstChild: { textContent: style } });
    return button;
  });
  node('danmakuPreviewControls').querySelectorAll = (selector) => selector === '[data-preview-style]' ? buttons : [];
  const listeners = {};
  const document = {
    hidden: false,
    getElementById: node,
    createElement: () => ({}),
    addEventListener(name, handler) {
      listeners[name] = handler;
    },
    removeEventListener(name, handler) {
      if (listeners[name] === handler) delete listeners[name];
    },
    documentElement: node('root'),
    body: { dataset: {}, classList: { add() {}, toggle() {} } },
  };
  const location = new URL(`http://127.0.0.1:3000/danmaku${search}`);
  const history = {
    state: savedStyle ? { danmakuPreviewStyle: savedStyle } : null,
    replaceState(state, _title, url) {
      this.state = state;
      location.href = new URL(url, location).href;
    },
  };
  const renders = [], appends = [], options = [], destroyedFeeds = [];
  const timeouts = new Map();
  const appendTimes = [];
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
            append(item) { appends.push(item); appendTimes.push(elapsed); },
            setSpeedPixelsPerSecond(value) { config.speedPixelsPerSecond = value; },
            setFloatingDispersion(value) { config.floatingDispersion = value; },
            setRandomPlacement(value) { Object.assign(config, value); },
          };
        });
      },
      { context },
    );
  });
  await module.evaluate();
  listeners.DOMContentLoaded();
  flushFrames();
  return { node, location, history, document, renders, appends, appendTimes, options, timeouts, frames, destroyedFeeds,
    advance, advanceMessages, flushFrames,
    setHidden(hidden) { document.hidden = hidden; listeners.visibilitychange?.(); },
    pagehide: () => windowListeners.get('pagehide').forEach((handler) => handler()) };
}

test('all local styles replay every example through the live feed without connecting', async () => {
  const f = await fixture('?preview=1&style=cream&fullscreenDurationSeconds=12');
  const url = 'http://127.0.0.1:3000/danmaku?preview=1';
  assert.equal(f.location.href, url);
  assert.equal(f.document.body.dataset.style, 'cream');
  for (const style of styles) {
    const start = f.appends.length;
    const fullscreen = ['outline', 'mist', 'whiteframe', 'cream', 'glow', 'starveil'].includes(style);
    const expectedSamples = createDanmakuPreviewItems(style).filter(item => style === 'mist' || !fullscreen || item.kind !== 'superchat');
    const sampleCount = expectedSamples.length;
    f.node(style).events.click();
    f.flushFrames();
    f.advanceMessages(sampleCount - 1);
    assert.equal(f.document.body.dataset.style, style);
    assert.equal(f.location.href, url);
    assert.equal(f.history.state.danmakuPreviewStyle, style);
    assert.equal(f.node(style)['aria-pressed'], 'true');
    const items = f.appends.slice(start);
    assert.equal(items.length, sampleCount);
    const members = items.filter((item) => item.medalName);
    assert.deepEqual(
      Array.from(members, (item) => item.guardLevel || 0).sort(),
      [0, 1, 2, 3],
    );
    assert.ok(members.every((item) => item.message.includes('[打call]') && item.emotes.length));
    assert.ok(members.every((item) => item.emotes[0].kind === 'inline'));
    assert.ok(items.some((item) => item.message === '[打call]'));
    assert.equal(items.find((item) => item.id.startsWith('preview-emote-')).isStreamer, true);
    assert.equal(items.find((item) => item.id.startsWith('preview-emote-')).emotes[0].kind, 'sticker');
    assert.ok(members.every((item) => item.isStreamer !== true));
    assert.ok(items.some((item) => !item.kind && !item.medalName && !item.isStreamer));
    assert.ok(items.some((item) => item.kind === 'gift' && item.giftCount === 10));
    assert.deepEqual(Array.from(items, item => item.id.replace(/-\d+$/u, '')).sort(), expectedSamples.map(item => item.id).sort());
    if (style === 'moonlit') {
      assert.ok(items[0].kind === 'gift' && !items[0].giftGuardLevel, 'ordinary gift thanks appears immediately');
      assert.equal(items[1].giftGuardLevel, 3, 'guard thanks follows the ordinary gift');
      assert.equal(new Set(items.map((item) => item.id.replace(/-\d+$/u, ''))).size, sampleCount);
      assert.deepEqual(Array.from(items.filter((item) => item.giftGuardLevel), (item) => item.giftGuardLevel).sort(), [1, 2, 3]);
    }
    assert.equal(items.find((item) => item.kind === 'gift' && item.giftCount === 10).giftTotalPrice, 1);
    assert.equal(f.options.at(-1).showGiftTotal, ['mist', 'harbor', 'transparent', 'identity', 'whiteframe', 'cream', 'moonlit', 'starlight', 'sketch', 'prismatic', 'snowfox', 'ripploid', 'twitter', 'spooky'].includes(style));
    assert.ok(items.every((item) => !item.id.startsWith('preview-thanks')));
    assert.equal(f.options.at(-1).resolveEmoteUrl(members[0].emotes[0].url), '/img/overlays/danmaku-previews/dacall.png');
    const superChats = items.filter((item) => item.kind === 'superchat');
    if (!fullscreen || style === 'mist') {
      assert.deepEqual([...new Set(Array.from(superChats, item => item.price))].sort((a, b) => a - b), [2, 30, 50, 100, 500, 1000, 2000]);
      assert.ok(superChats.every((item) => item.message));
      assert.ok(superChats.some((item) => item.message.includes('\n')));
      assert.equal(f.options.at(-1).style, style);
    }
    if (fullscreen) {
      if (style !== 'mist') assert.equal(superChats.length, 0);
      assert.notEqual(f.options.at(-1).expireItems, false);
      assert.equal(f.options.at(-1).itemLifetimeMs, 12000);
      assert.equal(f.options.at(-1).layout, 'fullscreen-random', 'preview uses the same region layout as live output');
      assert.equal(f.options.at(-1).showAvatar, ['cream', 'mist'].includes(style));
    }
  }
});

test('Twitter preview opens with chat, gift, membership and SC and uses only a synthetic room owner', async () => {
  const f = await fixture('?preview=1&style=twitter');
  f.advanceMessages(3);
  assert.deepEqual(f.appends.map((item) => item.kind || 'chat'), ['chat', 'gift', 'gift', 'superchat']);
  assert.equal(f.appends[1].giftGuardLevel, undefined);
  assert.equal(f.appends[2].giftGuardLevel, 3);
  assert.equal(f.node('twitterProfileName').textContent, '合成房主');
  assert.equal(f.node('twitterProfileUid').textContent, '@10001');
  assert.equal(f.node('twitterProfileAvatar').src, '/img/overlays/danmaku-ranked/viewer.webp');
  assert.equal(f.options.at(-1).resolveGiftImageUrl(f.appends[1].giftImageUrl), f.appends[1].giftImageUrl);
  assert.equal(f.options.at(-1).showGiftTotal, true);
  f.pagehide();
});

test('prismatic preview preserves its opening sequence and room identities for a complete round', async () => {
  const f = await fixture('?preview=1&style=prismatic');
  const sampleCount = createDanmakuPreviewItems('prismatic').length;
  f.advanceMessages(sampleCount - 1);
  const samples = f.appends;
  const ids = samples.map((item) => item.id.replace(/-\d+$/u, ''));
  assert.equal(samples.length, sampleCount);
  assert.deepEqual(ids.slice(0, 3), ['preview-4714', 'preview-emote', 'preview-gift-10']);
  assert.equal(new Set(ids).size, sampleCount, 'each sample appears once before the next round');
  assert.deepEqual(Array.from(samples.filter((item) => item.giftGuardLevel), (item) => item.giftGuardLevel).sort(), [1, 2, 3]);
  assert.equal(samples.find((item) => item.giftGuardLevel === 3).guardAccompanyDays, 360);
  const longSuperChat = samples.find((item) => item.id.startsWith('preview-superchat-2000-'));
  assert.equal(Array.from(longSuperChat.message).length, 40, 'the longest SC stays in the round');

  for (const [id, guard] of [['preview-1091', 1], ['preview-1822', 2], ['preview-4714', 3], ['preview-565', 0]]) {
    const sample = samples.find((item) => item.id.startsWith(`${id}-`));
    assert.equal(sample.roomGuardLevel, guard, id);
    assert.equal(sample.roomMedal.name, '粉丝团灯牌', id);
    assert.equal(sample.roomMedal.guardLevel, guard, id);
    assert.ok(sample.roomMedal.level > 0 && sample.honorLevel > 0, id);
    assert.equal(sample.roomMedal.colorText, '#FFFFFF', id);
    assert.ok(sample.avatarUrl, id);
  }
  f.pagehide();
});

test('preview mixes every sample at varied intervals, reshuffles each round and stops on close', async () => {
  const f = await fixture();
  assert.equal(f.renders.at(-1).length, 0, 'examples must arrive incrementally instead of as a snapshot');
  assert.equal(f.appends.length, 1);
  assert.equal(f.timeouts.size, 1);
  f.advance(1599);
  assert.equal(f.appends.length, 1);
  f.advanceMessages(1);
  assert.equal(f.appends.length, 2);
  const sampleCount = createDanmakuPreviewItems().length;
  f.advanceMessages(sampleCount * 2 - 2);
  const firstRound = f.appends.slice(0, sampleCount).map((item) => item.id.replace(/-\d+$/u, ''));
  const secondRound = f.appends.slice(sampleCount).map((item) => item.id.replace(/-\d+$/u, ''));
  assert.equal(new Set(firstRound).size, sampleCount, 'all examples appear before any repeats');
  assert.deepEqual([...firstRound].sort(), [...secondRound].sort());
  assert.notDeepEqual(firstRound, secondRound, 'later rounds must not repeat the same order');
  const kinds = f.appends.slice(0, sampleCount).map((item) => item.kind || 'chat');
  assert.deepEqual(new Set(kinds), new Set(['chat', 'gift', 'superchat']));
  assert.ok(kinds.some((kind, index) => kind === 'superchat' && kinds[index + 1] === 'chat'));
  const delays = f.appendTimes.slice(1).map((time, index) => time - f.appendTimes[index]);
  assert.ok(delays.every((delay) => delay >= 1600 && delay <= 4400));
  assert.ok(new Set(delays).size > 1, 'arrivals must vary rather than use a fixed interval');
  assert.equal(new Set(f.appends.map((item) => item.id)).size, sampleCount * 2);
  assert.ok(f.appends.every((item) => Number.isFinite(item.timestamp) && item.timestamp > 0));
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
    for (const [id, value] of [['previewBackgroundOpacity', '55'], ['previewTextColor', '#abcdef'], ['previewFontSize', '32']]) {
      const control = f.node(id);
      control.min = '0'; control.max = '100'; control.value = value;
      control.events.change();
      f.flushFrames();
      assert.equal(f.options.at(-1), originalFeed, `${style}: ${id} keeps the feed`);
      assert.equal(f.appends.length, messages, 'editing must not introduce a new sample');
      assert.equal(f.renders.length, renders, 'editing must not clear existing messages');
      assert.deepEqual([...f.timeouts.keys()], timers, 'editing must not reset the next message timer');
    }
    assert.equal(f.node('root').style['--danmaku-background-opacity'], '0.55');
    assert.equal(f.node('root').style['--danmaku-text-color'], '#abcdef');
    f.node('previewRefresh').events.click();
    f.flushFrames();
    assert.notEqual(f.options.at(-1), originalFeed, 'explicit replay still recreates the feed');
    assert.equal(f.appends.length, messages + 1);
    assert.equal(f.timeouts.size, 1);
    f.pagehide();
  }
});

test('Twitter footer preview edits literal Unicode text, rejects overlong values and restores the default', async () => {
  const f = await fixture('?preview=1&style=twitter');
  assert.equal(f.node('previewComposerTextField').hidden, false);
  assert.equal(f.node('twitterComposerText').textContent, '欢迎来到直播间 ✨');
  const control = f.node('previewComposerText');
  control.value = '<b>你好</b> 👨‍👩‍👧‍👦';
  control.events.input();
  assert.equal(f.node('previewComposerTextCount').textContent, '11/20');
  const before = f.appends.length;
  control.events.change();
  assert.equal(f.node('twitterComposerText').textContent, '<b>你好</b> 👨‍👩‍👧‍👦');
  assert.equal(f.appends.length, before, 'editing a footer must not restart message playback');
  control.value = '字'.repeat(21);
  control.events.change();
  assert.equal(f.node('twitterComposerText').textContent, '<b>你好</b> 👨‍👩‍👧‍👦');
  f.node('previewAppearanceReset').events.click();
  assert.equal(f.node('twitterComposerText').textContent, '欢迎来到直播间 ✨');
  f.node('previewComposerText').value = '中英 Hello ♥';
  f.node('previewComposerText').events.change();
  f.node('signal').events.click();
  assert.equal(f.node('previewComposerTextField').hidden, true);
  f.node('twitter').events.click();
  assert.equal(f.node('twitterComposerText').textContent, '中英 Hello ♥');
  f.pagehide();
});

test('Twitter preview layout and event colors edit in place and restore only its own options', async () => {
  const f = await fixture('?preview=1&style=twitter');
  const messages = f.appends.length;
  const renders = f.renders.length;
  const change = (id, value) => { f.node(id).value = value; f.node(id).events.change(); };
  change('previewTwitterHeader', 'hide');
  change('previewTwitterComposer', 'hide');
  change('previewTwitterActions', 'hide');
  change('previewTwitterColor50', '#12345680');
  assert.equal(f.document.body.dataset.twitterHeader, 'hide');
  assert.equal(f.node('previewComposerTextField').hidden, true);
  assert.equal(f.node('root').style['--twitter-event-color-50'], '#12345680');
  assert.equal(f.appends.length, messages);
  assert.equal(f.renders.length, renders);
  f.node('signal').events.click();
  assert.equal(f.node('previewTwitterHeaderField').hidden, true);
  assert.equal(f.node('previewTwitterColors').hidden, true);
  assert.equal(f.node('root').style['--twitter-event-color-50'], '');
  change('previewFontSize', '36');
  f.node('twitter').events.click();
  assert.equal(f.node('previewTwitterColor50').value, '#12345680');
  f.node('previewAppearanceReset').events.click();
  assert.equal(f.node('previewTwitterHeader').value, 'show');
  assert.equal(f.node('previewTwitterComposer').value, 'show');
  assert.equal(f.node('previewTwitterActions').value, 'show');
  assert.equal(f.node('previewTwitterColor50').value, '#f9c844');
  f.node('signal').events.click();
  assert.equal(f.node('previewFontSize').value, '36');
  f.pagehide();
});

test('local preview applies per-style parameters without external image requests', async () => {
  const options = {
    signal: { fontSize: 42, fontFamily: 'serif', backgroundOpacity: 35, giftImage: 'gift', scrollDirection: 'down' },
    minimal: { fontSize: 24 },
  };
  const f = await fixture(`?preview=1&style=signal&styleOptions=${encodeURIComponent(JSON.stringify(options))}`);
  assert.equal(f.node('root').style['--danmaku-font-size'], '42px');
  assert.equal(f.document.body.dataset.scrollDirection, 'down');
  assert.equal(f.node('root').style['--danmaku-background-opacity'], '0.35');
  assert.deepEqual(JSON.parse(JSON.stringify(f.history.state.danmakuStyleOptions)), options);
  const gift = createDanmakuPreviewItems().find(item => item.id === 'preview-gift-cheer');
  assert.equal(f.options.at(-1).resolveGiftImageUrl(gift.giftImageUrl), gift.giftImageUrl);
  f.node('minimal').events.click();
  assert.equal(f.node('root').style['--danmaku-font-size'], '24px');
  assert.equal(f.document.body.dataset.customBackground, 'false');
  assert.equal(f.document.body.dataset.scrollDirection, 'up');
  assert.equal(f.options.at(-1).resolveGiftImageUrl(gift.giftImageUrl), '');
  f.node('signal').events.click();
  assert.equal(f.document.body.dataset.scrollDirection, 'down');
  f.node('outline').events.click();
  assert.equal(f.document.body.dataset.scrollDirection, 'up');
});

test('RIPPLOID preview edits independent tier colors without replaying or leaking them', async () => {
  const f = await fixture('?preview=1&style=ripploid');
  assert.equal(f.node('previewRipploidColors').hidden, false);
  assert.equal(f.node('previewBubbleColorLabel').textContent, '聊天主色');
  assert.equal(f.node('previewFontSize').value, '24');
  assert.equal(f.document.body.dataset.customSize, 'false');
  const originalFeed = f.options.at(-1);
  const appendCount = f.appends.length;
  for (const [id, key, variable, value] of [
    ['previewGiftColor50', 'giftColor50', '--ripploid-gift-color50', '#123456'],
    ['previewGuardColorAdmiral', 'guardColorAdmiral', '--ripploid-guard-color-admiral', '#654321'],
    ['previewSuperchatColor2000', 'superchatColor2000', '--ripploid-superchat-color2000', '#abcdef'],
  ]) {
    const control = f.node(id);
    control.value = value;
    control.events.change();
    assert.equal(f.history.state.danmakuStyleOptions.ripploid[key], value);
    assert.equal(f.node('root').style[variable], value);
    assert.equal(f.options.at(-1), originalFeed);
    assert.equal(f.appends.length, appendCount);
  }
  f.node('previewBubbleColorMode').value = 'custom';
  f.node('previewBubbleColorMode').events.change();
  assert.equal(f.history.state.danmakuStyleOptions.ripploid.bubbleColor, '#eb945e');
  f.node('snowfox').events.click();
  assert.equal(f.node('previewRipploidColors').hidden, true);
  assert.equal(f.node('root').style['--ripploid-gift-color50'], '');
  f.node('ripploid').events.click();
  assert.equal(f.node('previewGiftColor50').value, '#123456');
  f.node('previewAppearanceReset').events.click();
  assert.deepEqual(JSON.parse(JSON.stringify(f.history.state.danmakuStyleOptions.ripploid)), {});
  assert.equal(f.node('root').style['--ripploid-gift-color50'], '#f39749');
  f.pagehide();
});

for (const style of ['identity', 'transparent', 'outline', 'bubble', 'cream', 'twitter']) test(`${style} preview resolves matching local WebP gifts even with legacy theme options`, async () => {
  const options = { [style]: { giftImage: 'theme' } };
  const f = await fixture(`?preview=1&style=${style}&styleOptions=${encodeURIComponent(JSON.stringify(options))}`);
  assert.equal(f.node('previewGiftField').hidden, true);
  if (style === 'identity') assert.equal(f.options.at(-1).showGiftTotal, true);
  const gifts = createDanmakuPreviewItems(style).filter(item => item.kind === 'gift');
  assert.equal(new Set(gifts.map(item => item.giftImageUrl)).size, gifts.length);
  for (const gift of gifts) {
    assert.equal(f.options.at(-1).resolveGiftImageUrl(gift.giftImageUrl), gift.giftImageUrl);
    const bytes = fs.readFileSync(path.join(__dirname, '../../public', gift.giftImageUrl));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  }
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
  assert.match(f.node('previewSaveState').textContent, /请输入 36～96 之间的整数/);
});

test('spooky preview preserves custom colors across themes and restores only palette overrides', async () => {
  const f = await fixture('?preview=1&style=spooky');
  const change = (id, value) => {
    const control = f.node(id);
    if (id.endsWith('Opacity')) { control.min = '0'; control.max = '100'; }
    control.value = value; control.events.change(); f.flushFrames();
  };
  const saved = () => JSON.parse(JSON.stringify(f.history.state.danmakuStyleOptions));
  assert.equal(f.node('previewTextColorMode').value, 'default');
  assert.equal(f.node('previewTextColorField').hidden, true);
  change('previewFontSize', '24');
  change('previewSpookyFrame', 'hide');
  for (const [key, value] of [['SpookyFrameColor', '#123456'], ['SpookyMessageColor', '#234567'], ['SpookyEventColor', '#345678'], ['SpookyAccentColor', '#456789'], ['TextColor', '#fce6fa']]) {
    change(`preview${key}Mode`, 'custom');
    change(`preview${key}`, value);
  }
  for (const [key, value] of [['SpookyFrameOpacity', '0'], ['SpookyMessageOpacity', '40'], ['SpookyEventOpacity', '75']]) change(`preview${key}`, value);
  const renders = f.renders.length;
  const timers = [...f.timeouts.keys()];
  change('previewSpookyTheme', 'autumn');
  assert.equal(saved().spooky.textColor, '#fce6fa');
  assert.equal(saved().spooky.spookyMessageColor, '#234567');
  assert.equal(saved().spooky.spookyFrameOpacity, 0);
  change('previewSpookyMessageColorMode', 'default');
  assert.equal(Object.hasOwn(saved().spooky, 'spookyMessageColor'), false);
  assert.equal(saved().spooky.spookyMessageOpacity, 40, 'following a theme color preserves independent alpha');
  assert.equal(f.node('previewSpookyMessageColor').value, '#592929');
  change('previewSpookyEventOpacity', '101');
  assert.equal(saved().spooky.spookyEventOpacity, 75, 'out-of-range alpha is rejected');
  f.node('signal').events.click();
  change('previewTextColor', '#abcdef');
  f.node('spooky').events.click();
  const layout = JSON.stringify(f.history.state.danmakuLayout);
  f.node('previewSpookyResetColors').events.click();
  assert.deepEqual(saved(), { spooky: { fontSize: 24, spookyFrame: 'hide', spookyTheme: 'autumn' }, signal: { textColor: '#abcdef' } });
  assert.equal(f.node('previewTextColor').value, '#fff1d1');
  assert.equal(f.node('previewTextColorMode').value, 'default');
  assert.equal(JSON.stringify(f.history.state.danmakuLayout), layout);
  assert.equal(f.node('previewSpookyResetColors').disabled, true);
  assert.equal(f.renders.length, renders + 2, 'only the two explicit style switches restart playback');
  assert.equal(timers.length, f.timeouts.size);
});

test('preview edge fading edits and resets each fixed style without leaking to random layouts', async () => {
  const f = await fixture('?preview=1&style=prismatic');
  const select = f.node('previewEdgeFade');
  assert.equal(select.value, 'both');
  assert.equal(f.node('previewEdgeFadeField').hidden, false);
  select.value = 'none';
  select.events.change();
  assert.equal(f.history.state.danmakuStyleOptions.prismatic.edgeFade, 'none');
  assert.equal(f.document.body.dataset.edgeFade, 'none');
  for (const edge of ['top', 'bottom']) {
    select.value = edge;
    select.events.change();
    for (const direction of ['up', 'down']) {
      f.node('previewScrollDirection').value = direction;
      f.node('previewScrollDirection').events.change();
      assert.equal(select.value, edge);
      assert.equal(f.history.state.danmakuStyleOptions.prismatic.edgeFade, edge);
      assert.equal(f.document.body.dataset.edgeFade, edge);
    }
  }
  select.value = 'none';
  select.events.change();
  f.node('signal').events.click();
  assert.equal(select.value, 'top');
  f.node('prismatic').events.click();
  assert.equal(select.value, 'none');
  f.node('previewAppearanceReset').events.click();
  assert.equal(select.value, 'both');
  assert.equal(f.document.body.dataset.edgeFade, 'both');
  f.node('outline').events.click();
  assert.equal(f.node('previewEdgeFadeField').hidden, true);
  assert.equal(f.document.body.dataset.edgeFade, 'none');
});

test('preview entrance choices persist per style and leave existing messages running', async () => {
  const f = await fixture('?preview=1&style=whiteframe');
  const select = f.node('previewEntranceAnimation');
  for (const style of ['whiteframe', 'glow', 'starveil']) {
    f.node(style).events.click();
    assert.equal(f.node('previewEntranceAnimationField').hidden, false);
    assert.equal(select.value, 'fade');
    const originalFeed = f.options.at(-1);
    const appendCount = f.appends.length;
    select.value = 'rise';
    select.events.change();
    assert.equal(f.history.state.danmakuStyleOptions[style].entranceAnimation, 'rise');
    assert.equal(f.options.at(-1), originalFeed, 'changing the entrance keeps the current feed');
    assert.equal(f.appends.length, appendCount, 'changing the entrance must not replay existing messages');
  }
  for (const style of ['whiteframe', 'glow', 'starveil']) {
    f.node(style).events.click();
    assert.equal(select.value, 'rise');
  }
  f.node('previewAppearanceReset').events.click();
  assert.equal(select.value, 'fade');
  assert.equal(f.history.state.danmakuStyleOptions.whiteframe.entranceAnimation, 'rise');
  assert.equal(f.history.state.danmakuStyleOptions.glow.entranceAnimation, 'rise');
  assert.deepEqual(JSON.parse(JSON.stringify(f.history.state.danmakuStyleOptions.starveil)), {});
  for (const style of styles.filter(style => !['whiteframe', 'glow', 'starveil'].includes(style)).concat(['floating', 'comet'])) {
    f.node(style).events.click();
    assert.equal(f.node('previewEntranceAnimationField').hidden, true, style);
  }
});

test('starlight decoration choices update existing preview messages and reset independently', async () => {
  const f = await fixture('?preview=1&style=starlight');
  const select = f.node('previewDecorationShape');
  assert.equal(f.node('previewDecorationShapeField').hidden, false);
  assert.equal(select.value, 'sparkle');
  const originalFeed = f.options.at(-1);
  const appendCount = f.appends.length;
  for (const shape of ['heart', 'square', 'star', 'flower', 'moon', 'bow', 'sparkle']) {
    select.value = shape;
    select.events.change();
    assert.equal(f.history.state.danmakuStyleOptions.starlight.decorationShape, shape);
    assert.equal(f.document.body.dataset.decorationShape, shape);
    assert.equal(f.options.at(-1), originalFeed);
    assert.equal(f.appends.length, appendCount, 'shape changes must not replay messages');
  }
  select.value = 'heart';
  select.events.change();
  f.node('signal').events.click();
  assert.equal(f.node('previewDecorationShapeField').hidden, true);
  assert.equal(f.document.body.dataset.decorationShape, 'sparkle');
  f.node('starlight').events.click();
  assert.equal(select.value, 'heart');
  f.node('previewAppearanceReset').events.click();
  assert.equal(select.value, 'sparkle');
  assert.equal(f.document.body.dataset.decorationShape, 'sparkle');
});

test('random position controls reach the preview feed, reject invalid edits and reset per style', async () => {
  const f = await fixture('?preview=1&style=outline');
  assert.equal(f.node('previewCenterBiasField').hidden, false);
  for (const [id, key, value] of [['previewCenterBias', 'centerBias', 45], ['previewDispersion', 'dispersion', 38]]) {
    const control = f.node(id);
    control.min = '1'; control.max = '50'; control.value = String(value);
    control.events.change();
    assert.equal(f.history.state.danmakuStyleOptions.outline[key], value);
    assert.equal(f.options.at(-1)[key], value);
    control.value = '51';
    control.events.change();
    assert.equal(control.value, String(value));
  }
  f.node('cream').events.click();
  assert.equal(f.node('previewCenterBias').value, '1');
  f.node('outline').events.click();
  assert.equal(f.node('previewCenterBias').value, '45');
  f.node('previewAppearanceReset').events.click();
  assert.equal(f.node('previewCenterBias').value, '1');
  assert.equal(f.options.at(-1).dispersion, 1);
  f.node('signal').events.click();
  assert.equal(f.node('previewCenterBiasField').hidden, true);
  assert.equal(f.node('previewDispersionField').hidden, true);
});

test('floating preview controls save mapped speed and dispersion independently and restore defaults', async () => {
  const f = await fixture('?preview=1&style=floating');
  for (const style of ['floating', 'comet']) {
    f.node(style).events.click();
    assert.equal(f.node('previewFloatingSpeed').value, '50');
    assert.equal(f.node('previewFloatingDispersion').value, '50');
    assert.equal(f.node('previewFloatingDispersionField').hidden, false);
    const originalFeed = f.options.at(-1);
    for (const [id, key, value] of [['previewFloatingSpeed', 'speedPixelsPerSecond', 360], ['previewFloatingDispersion', 'floatingDispersion', 100]]) {
      const control = f.node(id);
      control.min = '1'; control.max = '100'; control.value = '100';
      control.events.input();
      assert.equal(f.history.state.danmakuStyleOptions[style]?.[key], undefined, 'dragging only updates the readout');
      assert.match(f.node(`${id}Value`).textContent, /^100/);
      control.events.change();
      assert.equal(f.history.state.danmakuStyleOptions[style][key], value);
      assert.equal(f.options.at(-1)[key], value);
      assert.equal(f.options.at(-1), originalFeed, 'motion edits keep the existing preview feed');
      control.value = '101'; control.events.change();
      assert.equal(control.value, '100');
    }
  }
  f.node('floating').events.click();
  assert.equal(f.node('previewFloatingDispersion').value, '100');
  f.node('previewAppearanceReset').events.click();
  assert.equal(f.options.at(-1).speedPixelsPerSecond, 120);
  assert.equal(f.options.at(-1).floatingDispersion, 50);
  f.node('signal').events.click();
  assert.equal(f.node('previewFloatingDispersionField').hidden, true);
});

test('fixed canvas regions scale all content with width while height controls message capacity', async () => {
  for (const style of styles.filter((style) => !randomStyles.includes(style))) {
    const f = await fixture(`?preview=1&style=${style}`);
    const variables = f.node('root').style;
    const width = Number(f.node('regionWidth').value);
    const fontSize = Number(f.node('previewFontSize').value);
    const contentWidth = Number.parseFloat(variables['--region-content-width']);
    const contentHeight = Number.parseFloat(variables['--region-content-height']);
    const resize = (field, value) => {
      f.node(field).value = String(value);
      f.node(field).events.change();
    };
    const playbackCount = f.appends.length;
    resize('regionWidth', width / 2);
    assert.equal(variables['--content-scale'], '0.5', style);
    assert.equal(Number.parseFloat(variables['--region-content-width']), contentWidth, style);
    assert.equal(Number.parseFloat(variables['--region-content-height']), contentHeight * 2, style);
    assert.equal(Number(f.node('previewFontSize').value), Math.round(fontSize / 2), style);
    assert.ok(460 * Number(variables['--region-card-scale']) <= contentWidth - 24 + 0.001, style);
    resize('regionHeight', Number(f.node('regionHeight').value) / 2);
    assert.equal(variables['--content-scale'], '0.5', style);
    assert.equal(Number.parseFloat(variables['--region-content-height']), contentHeight, style);
    resize('regionWidth', width);
    assert.equal(variables['--content-scale'], '1', style);
    assert.equal(Number(f.node('previewFontSize').value), fontSize, style);
    assert.equal(f.appends.length, playbackCount, 'resizing must not replay or duplicate messages');
  }
});

test('resizing a fixed region preserves logical typography and random regions retain their layout scale', async () => {
  const f = await fixture('?preview=1&style=signal');
  f.node('regionWidth').value = '280';
  f.node('regionWidth').events.change();
  f.node('previewFontSize').value = '20';
  f.node('previewFontSize').events.change();
  assert.equal(f.history.state.danmakuStyleOptions.signal.fontSize, 40);
  f.node('regionWidth').value = '560';
  f.node('regionWidth').events.change();
  assert.equal(f.node('previewFontSize').value, '40');
  for (const style of randomStyles) {
    f.node(style).events.click();
    f.node('regionWidth').value = '960';
    f.node('regionWidth').events.change();
    assert.equal(f.node('root').style['--content-scale'], '1', style);
    assert.equal(f.node('root').style['--region-content-width'], '960px', style);
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
