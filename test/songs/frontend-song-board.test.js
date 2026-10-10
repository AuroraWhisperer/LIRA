'use strict';

const { readAdminFragmentHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('../helpers/css-bundle');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');
const { createLyricToggleButton, loadModuleExports, response } = require('../helpers/frontend-modules');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');

const ROOT_DIR = path.join(__dirname, '../..');

test('display overlay URLs use explicit settings capabilities without the legacy registry', async () => {
  const nodes = new Map(
    [
      'queueUrl',
      'songsUrl',
      'lyricsUrl',
      'liveDanmakuUrl',
      'localDanmakuUrl',
      'liveCanvasUrl',
      'liveCanvasSourceStatus',
      'liveCanvasPreview',
      'copyLiveCanvasUrl',
      'liveBlindboxUrl',
      'liveGamesUrl',
      'liveWheelUrl',
      'liveInteractionsUrl',
      'liveGiftFeedUrl',
      'liveGiftWishUrl',
      'liveOvertimeUrl',
      'liveGiftEffectsUrl',
      'liveOpeningUrl',
      'liveClockUrl',
      'webSongPageUrl',
      'blindboxOverlayUrl',
    ].map((id) => [id, { addEventListener() {} }]),
  );
  const copyButton = { addEventListener() {}, removeEventListener() {} };
  const window = { addEventListener() {} };
  const { display } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/display.js'), {
    window,
    location: { protocol: 'http:', hostname: 'localhost', port: '3012' },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: (id) => nodes.get(id) || null,
      querySelectorAll: () => [],
      querySelector: () => copyButton,
    },
    fetch: async () => ({ ok: true, text: async () => JSON.stringify({ ok: true, data: { gifts: [] } }) }),
  });
  window.AdminApp = {};
  display.initOverlayUrls();
  assert.equal(nodes.get('songsUrl').textContent, 'http://127.0.0.1:3012/songlist');
  assert.equal(nodes.get('liveGiftWishUrl').textContent, 'http://127.0.0.1:3012/gift-wishes');
  assert.equal(nodes.get('blindboxOverlayUrl').textContent, 'http://127.0.0.1:3012/blindbox');
  assert.equal(copyButton.disabled, true);
});

for (const initialProfile of ['older response', 'initial rejection', 'late rejection']) {
  test('web song page follows the current account with ' + initialProfile, async () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'public/pages/admin/song/overlay-addresses.html'), 'utf8');
    const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, { addEventListener() {} }]));
    nodes.set('blindboxOverlayUrl', {});
    const buttons = new Map();
    const listeners = new Set();
    const pagehide = [];
    let resolveProfile;
    let rejectProfile;
    const profile = new Promise((resolve, reject) => {
      resolveProfile = resolve;
      rejectProfile = reject;
    });
    const bridge = {
      getState: () => profile,
      getOverlaySettings: async () => ({ ok: false }),
      onStateChanged(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const { display } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/display.js'), {
      URL,
      window: {
        liraLicense: bridge,
        addEventListener(name, listener) {
          if (name === 'pagehide') pagehide.push(listener);
        },
        removeEventListener() {},
      },
      location: { protocol: 'http:', hostname: 'localhost', port: '3012' },
      document: {
        readyState: 'loading',
        addEventListener() {},
        getElementById: (id) => nodes.get(id) || null,
        querySelectorAll: () => [],
        querySelector(selector) {
          if (!buttons.has(selector)) buttons.set(selector, { addEventListener() {}, removeEventListener() {} });
          return buttons.get(selector);
        },
      },
      fetch: async () => ({ ok: true, text: async () => JSON.stringify({ ok: true, data: { gifts: [] } }) }),
    });
    const account = (url) => ({ state: 'authorized', streamer: { accountName: 'demo', songPageUrl: url } });
    const emit = (snapshot) => listeners.forEach((listener) => listener(snapshot));
    display.initOverlayUrls();
    const copy = buttons.get('[data-copy-url="webSongPageUrl"]');
    const open = buttons.get('[data-open-url="webSongPageUrl"]');
    assert.equal(copy.disabled, true);
    assert.equal(open.disabled, true);
    if (initialProfile === 'initial rejection') {
      rejectProfile(new Error('profile unavailable'));
      await new Promise(setImmediate);
      assert.equal(copy.disabled, true);
      assert.equal(open.disabled, true);
    }
    emit(account('https://current.example.test/'));
    if (initialProfile === 'older response') resolveProfile(account('https://old.example.test/'));
    if (initialProfile === 'late rejection') rejectProfile(new Error('profile unavailable'));
    await new Promise(setImmediate);
    assert.equal(nodes.get('webSongPageUrl').textContent, 'https://current.example.test/');
    assert.equal(copy.disabled, false);
    assert.equal(open.disabled, false);
    emit({ state: 'needs_activation' });
    assert.equal(copy.disabled, true);
    assert.equal(open.disabled, true);
    assert.doesNotMatch(nodes.get('webSongPageUrl').textContent, /current\.example/);
    for (const url of ['javascript:alert(1)', 'http://example.test/', 'https://user:secret@example.test/', 'invalid']) {
      emit(account(url));
      assert.equal(open.disabled, true, url);
      assert.equal(copy.disabled, true, url);
    }
    pagehide.forEach((listener) => listener());
    assert.equal(listeners.size, 0);
  });
}

test('song list exposes a display board font size control', async () => {
  const html = readAdminFragmentHtml('pages/admin/song/song-board.html');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const themePage = readAdminFragmentHtml('pages/admin/song/queue-theme.html');

  assert.match(themePage, /<div id="themePage"/);
  assert.match(html, /<div id="displayPage"/);
  assert.doesNotMatch(themePage, /songBoardFontSize/);
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\sid\s*=\s*["']songBoardFontSize["']/.test(tag));
  assert.equal(inputs.length, 1);
  assert.match(inputs[0], /\smin\s*=\s*["']10["']/);
  assert.match(inputs[0], /\smax\s*=\s*["']80["']/);
  const form = {
    querySelector: (selector) => ({ value: selector === '[id="songBoardFontSize"]' ? '42' : '', checked: true }),
  };
  const { collectSongBoardSettings } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/song-board-settings.js'));
  assert.equal(collectSongBoardSettings(form).songBoardFontSize, '42');
  const boardRule = overlayStyles.match(/\.song-board\s*\{[^}]*\}/)?.[0];
  assert.ok(boardRule);
  assert.match(boardRule, /font-size:[^;]*var\(--overlay-font-scale\b/);
  const baseFontSize = Number(boardRule.match(/font-size:[^;]*?([\d.]+)px/)?.[1]);
  assert.ok(baseFontSize > 0);
  const titleRule = overlayStyles.match(/\.song-board \.overlay-title\s*\{[^}]*\}/)?.[0];
  assert.ok(titleRule);
  assert.match(titleRule, /var\(--overlay-title-font-size\b/);
  assert.match(titleRule, /var\(--overlay-font-scale\b/);

  const values = new Map();
  const sandbox = {
    window: {},
    URLSearchParams,
    location: { search: '' },
    document: {
      addEventListener() {},
      documentElement: {
        style: {
          setProperty: (name, value) => values.set(name, value),
          removeProperty: (name) => values.delete(name),
        },
      },
      querySelector: () => ({ classList: { toggle() {} }, style: {} }),
      getElementById: () => null,
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT_DIR, 'public/js/overlays/overlay-utils.js'), 'utf8'), sandbox);
  vm.runInNewContext(readJsModuleBundle('public', 'js', 'overlays', 'songs.js'), sandbox);
  for (const [input, expected] of [['10', 10], ['36', 36], ['80', 80], ['4', 10], ['99', 80], ['invalid', 28]]) {
    sandbox.applyTheme({ songBoardFontSize: input });
    assert.equal(Number(values.get('--overlay-font-scale')) * baseFontSize, expected, input);
  }
  sandbox.applyTheme({ songBoardFontSize: DEFAULT_SETTINGS.songBoardFontSize });
  assert.equal(
    Number(values.get('--overlay-font-scale')) * baseFontSize,
    28,
    'the stored default must match the overlay fallback size',
  );
});

test('song board keeps song names readable in narrow browser sources', async () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const songModule = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), {
    document: { addEventListener() {} },
    location: { protocol: 'http:', host: 'localhost', search: '' },
    URLSearchParams,
    WebSocket: function WebSocket() {},
  });

  const listRule = overlayStyles.match(/\.song-scroll-list\s*\{[^}]*\}/)?.[0];
  const nameRule = overlayStyles.match(/\.song-card strong\s*\{[^}]*\}/)?.[0];
  const artistRule = overlayStyles.match(/\.song-card span\s*\{[^}]*\}/)?.[0];
  assert.ok(listRule);
  assert.ok(nameRule);
  assert.ok(artistRule);
  assert.match(listRule, /grid-auto-rows:\s*max-content/);
  assert.match(nameRule, /flex:\s*1 1 auto/);
  assert.match(nameRule, /min-width:\s*0/);
  assert.match(artistRule, /text-overflow:\s*ellipsis/);
  assert.match(artistRule, /white-space:\s*nowrap/);

  const flatRecords = songModule.buildSongRecords(
    [
      {
        id: 1,
        name: 'A "song"',
        artist: 'Artist & guests / Guest Two / Guest Three',
      },
    ],
    'length',
  );
  assert.equal(flatRecords.length, 1);
  assert.equal(flatRecords[0].song.name, 'A "song"');
  assert.equal(flatRecords[0].artist, 'Artist & guests');

  const artistRecords = songModule.buildSongRecords(
    [
      { id: 1, name: 'First', artist: 'Lead / Guest Two' },
      { id: 2, name: 'Second', artist: 'Lead / Guest Three' },
    ],
    'artist',
  );
  assert.deepEqual(
    Array.from(artistRecords, (record) => record.type),
    ['heading', 'song', 'song'],
  );
  assert.equal(artistRecords[0].label, 'Lead');
  assert.match(source, /\.textContent\s*=/);
  assert.doesNotMatch(source, /list\.innerHTML\s*=\s*html/);
});

test('song display board bounds rendered rows and preserves the scroll anchor', async () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'songs.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  const styles = readCssBundle('public', 'css', 'overlays', 'base.css');
  assert.match(html, /<script type="module" src="\/js\/overlays\/songs\.js\?v=[^"]+"><\/script>/);
  assert.match(source, /new SongVirtualScroller\s*\(/);
  assert.match(source, /new ResizeObserver\s*\([\s\S]*?\bscheduleRelayout\b/);
  assert.doesNotMatch(styles, /@keyframes song-scroll/);
  assert.doesNotMatch(source, /insertAdjacentHTML|\.innerHTML\s*=/);

  class FakeNode {
    constructor(height, key) {
      this.dataset = { key };
      this.height = height;
      this.parentElement = null;
    }

    get offsetHeight() {
      return this.height;
    }

    get offsetTop() {
      if (!this.parentElement) return 0;
      const index = this.parentElement.children.indexOf(this);
      return (
        this.parentElement.offsetTop +
        this.parentElement.children
          .slice(0, index)
          .reduce((total, node) => total + node.offsetHeight + this.parentElement.gap, 0)
      );
    }

    remove() {
      const index = this.parentElement?.children.indexOf(this) ?? -1;
      if (index >= 0) this.parentElement.children.splice(index, 1);
      this.parentElement = null;
    }
  }

  class FakeContent {
    constructor(gap = 8) {
      this.children = [];
      this.gap = gap;
      this.offsetTop = 50;
    }

    get firstElementChild() {
      return this.children[0] ?? null;
    }

    get lastElementChild() {
      return this.children.at(-1) ?? null;
    }

    get scrollHeight() {
      if (this.children.length === 0) return 0;
      return (
        this.children.reduce((total, node) => total + node.offsetHeight, 0) + (this.children.length - 1) * this.gap
      );
    }

    append(node) {
      node.parentElement = this;
      this.children.push(node);
    }

    prepend(node) {
      node.parentElement = this;
      this.children.unshift(node);
    }

    replaceChildren(...nodes) {
      this.children.forEach((node) => {
        node.parentElement = null;
      });
      this.children = [];
      nodes.forEach((node) => this.append(node));
    }
  }

  const { SongVirtualScroller, bufferPixels, pixelsPerSecond, wrapIndex } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'song-virtual-scroller.js'),
  );
  assert.equal(wrapIndex(-1, 5), 4);
  assert.equal(wrapIndex(5, 5), 0);
  assert.equal(pixelsPerSecond(300, 12), 25);
  assert.deepEqual(Array.from(bufferPixels(100, 1, 1.5)), [100, 150]);

  const content = new FakeContent();
  const viewport = {
    clientHeight: 100,
    currentScrollTop: 0,
    get scrollTop() {
      return this.currentScrollTop;
    },
    set scrollTop(value) {
      this.currentScrollTop = Math.min(Math.max(0, value), Math.max(0, content.scrollHeight - this.clientHeight));
    },
  };
  const records = Array.from({ length: 1000 }, (_, index) => ({
    key: `song:${index}`,
  }));
  const scroller = new SongVirtualScroller({
    viewport,
    content,
    createNode: (record) => new FakeNode(20, record.key),
    requestFrame() {
      return 1;
    },
    cancelFrame() {},
  });

  scroller.setRecords(records, { key: 'song:500', offset: 5 });
  assert.ok(content.children.length < 40, `expected a bounded DOM, got ${content.children.length} nodes`);
  assert.ok(viewport.scrollTop >= 100);
  assert.equal(scroller.captureAnchor().key, 'song:500');

  const originalCount = content.children.length;
  scroller.advanceBy(250);
  assert.ok(content.children.length <= originalCount + 1);
  assert.notEqual(scroller.captureAnchor().key, 'song:500');

  const shortContent = new FakeContent();
  const shortScroller = new SongVirtualScroller({
    viewport: { clientHeight: 100, scrollTop: 0 },
    content: shortContent,
    createNode: (record) => new FakeNode(20, record.key),
    requestFrame() {
      return 1;
    },
    cancelFrame() {},
  });
  shortScroller.setRecords(records.slice(0, 2));
  assert.equal(shortContent.children.length, 2);
  assert.equal(shortScroller.isScrollable, false);
});

test('song board scroll speed stays constant as content grows', async () => {
  const adminHtml = readAdminFragmentHtml('pages/admin/song/song-board.html');
  assert.match(
    adminHtml,
    /<input\b(?=[^>]*\bid="scrollSecondsRange")[^>]*\bclass="parameter-range parameter-range--tempo"[^>]*\btype="range"[^>]*\bmin="1"[^>]*\bmax="100"[^>]*>/s,
  );
  assert.match(adminHtml, /id="scrollSeconds" type="number" min="1" max="100"/);
  const songModule = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), {
    document: { addEventListener() {} },
    location: { protocol: 'http:', host: 'localhost', search: '' },
    URLSearchParams,
    WebSocket: function WebSocket() {},
  });
  const { pixelsPerSecond } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'song-virtual-scroller.js'),
  );

  assert.equal(songModule.scrollSpeedToDuration(1), '20.557851');
  assert.equal(songModule.scrollSpeedToDuration(100), '2.000000');
  assert.equal(songModule.scrollSpeedToDuration(200), '2.000000');

  const rates = Array.from({ length: 100 }, (_, index) => index + 1).map(
    (speed) => 1 / Number(songModule.scrollSpeedToDuration(speed)),
  );
  const rateSteps = rates.slice(1).map((rate, index) => rate - rates[index]);
  assert.ok(rateSteps.every((step) => Math.abs(step - rateSteps[0]) < 0.000001));

  const secondsPerViewport = Number(songModule.scrollSpeedToDuration(80));
  const rate = pixelsPerSecond(300, secondsPerViewport);
  assert.equal(rate, 300 / secondsPerViewport);
  assert.ok(Math.abs((rate * 2) / 2 - (rate * 20) / 20) < 0.000001);
});
