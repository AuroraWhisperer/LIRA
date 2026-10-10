const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDanmakuPreviewItems } = require('../../public/js/overlays/danmaku-preview-samples.js');

const styles = ['bubble', 'signal', 'minimal', 'ranked', 'transparent', 'identity', 'sketch', 'prismatic', 'starlight', 'moonlit', 'outline', 'whiteframe', 'cream', 'glow', 'starveil'];
const randomStyles = ['outline', 'whiteframe', 'cream', 'glow', 'starveil'];

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
  const buttons = styles.map((style) => {
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
    const fullscreen = ['outline', 'whiteframe', 'cream', 'glow', 'starveil'].includes(style);
    const expectedSamples = createDanmakuPreviewItems(style).filter(item => !fullscreen || item.kind !== 'superchat');
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
    assert.equal(f.options.at(-1).showGiftTotal, ['transparent', 'whiteframe', 'cream', 'moonlit', 'starlight', 'sketch', 'prismatic'].includes(style));
    assert.ok(items.every((item) => !item.id.startsWith('preview-thanks')));
    assert.equal(f.options.at(-1).resolveEmoteUrl(members[0].emotes[0].url), '/img/overlays/danmaku-previews/dacall.png');
    const superChats = items.filter((item) => item.kind === 'superchat');
    if (!fullscreen) {
      assert.deepEqual([...new Set(Array.from(superChats, item => item.price))].sort((a, b) => a - b), [2, 30, 50, 100, 500, 1000, 2000]);
      assert.ok(superChats.every((item) => item.message));
      assert.ok(superChats.some((item) => item.message.includes('\n')));
      assert.equal(f.options.at(-1).style, style);
    }
    if (fullscreen) {
      assert.equal(superChats.length, 0);
      assert.notEqual(f.options.at(-1).expireItems, false);
      assert.equal(f.options.at(-1).itemLifetimeMs, 12000);
      assert.equal(f.options.at(-1).layout, 'fullscreen-random', 'preview uses the same region layout as live output');
      assert.equal(f.options.at(-1).showAvatar, style === 'cream');
    }
  }
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
  f.advance(799);
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
  assert.ok(delays.every((delay) => delay >= 800 && delay <= 2200));
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
  assert.equal(f.options.at(-1).resolveGiftImageUrl('/img/gift-placeholder.png'), '/img/gift-placeholder.png');
  f.node('minimal').events.click();
  assert.equal(f.node('root').style['--danmaku-font-size'], '24px');
  assert.equal(f.document.body.dataset.customBackground, 'false');
  assert.equal(f.document.body.dataset.scrollDirection, 'up');
  assert.equal(f.options.at(-1).resolveGiftImageUrl('/img/gift-placeholder.png'), '');
  f.node('signal').events.click();
  assert.equal(f.document.body.dataset.scrollDirection, 'down');
  f.node('outline').events.click();
  assert.equal(f.document.body.dataset.scrollDirection, 'up');
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
