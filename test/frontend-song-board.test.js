'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');
const {
  createLyricToggleButton,
  loadModuleExports,
  response
} = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('song list exposes a display board font size control', () => {
  const html = readAdminHtml();
  const displaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'), 'utf8');
  const overlaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');
  const themePage = html.match(/<div id="themePage"[\s\S]*?<div id="displayPage"/)?.[0];

  assert.ok(themePage);
  assert.doesNotMatch(themePage, /songBoardFontSize/);
  assert.match(html, /id="displayPage"[\s\S]*id="songBoardFontSize"[^>]*min="10"[^>]*max="80"[^>]*value="50"/);
  assert.match(displaySource, /songBoardFontSize: value\('songBoardFontSize'\)/);
  assert.match(overlaySource, /Math\.max\(10, Math\.min\(80, Number\(settings\.songBoardFontSize\) \|\| 50\)\)/);
  assert.match(overlayStyles, /\.song-board \{[\s\S]*font-size: calc\(16px \* var\(--overlay-font-scale, 1\)\)/);
  assert.match(overlayStyles, /\.song-board \.overlay-content \{[\s\S]*padding: clamp\(5px, calc\(8px \* var\(--overlay-font-scale, 1\)\), 18px\)/);
  assert.match(overlayStyles, /\.song-board \.overlay-title \{[\s\S]*var\(--overlay-title-font-size, 15px\) \* var\(--overlay-font-scale, 1\)/);
  assert.match(defaultsSource, /songBoardFontSize: '50'/);
});

test('song board keeps song names readable in narrow browser sources', async () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const songModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'),
    {
      document: { addEventListener() {} },
      location: { protocol: 'http:', host: 'localhost', search: '' },
      URLSearchParams,
      WebSocket: function WebSocket() {}
    }
  );

  const listRule = overlayStyles.match(/\.song-scroll-list\s*\{[^}]*\}/)?.[0];
  const cardRule = [...overlayStyles.matchAll(/\.song-card\s*\{[^}]*\}/g)]
    .map((match) => match[0])
    .find((rule) => /display:\s*flex/.test(rule));
  const nameRule = overlayStyles.match(/\.song-card strong\s*\{[^}]*\}/)?.[0];
  const artistRule = overlayStyles.match(/\.song-card span\s*\{[^}]*\}/)?.[0];
  const headerRule = overlayStyles.match(/\.song-board \.overlay-header\s*\{[^}]*\}/)?.[0];
  assert.ok(listRule);
  assert.ok(cardRule);
  assert.ok(nameRule);
  assert.ok(artistRule);
  assert.ok(headerRule);
  assert.match(listRule, /grid-auto-rows:\s*max-content/);
  assert.match(cardRule, /display:\s*flex/);
  assert.doesNotMatch(cardRule, /grid-template-columns/);
  assert.match(nameRule, /flex:\s*1 1 auto/);
  assert.match(nameRule, /min-width:\s*0/);
  assert.match(headerRule, /clamp\(4px, calc\(6px \* var\(--overlay-font-scale, 1\)\), 8px\)/);
  assert.match(artistRule, /max-width:\s*min\(32\.4%, 9em\)/);
  assert.match(artistRule, /font-size:\s*calc\(10\.5px \* var\(--overlay-font-scale, 1\)\)/);
  assert.doesNotMatch(artistRule, /letter-spacing/);
  assert.match(artistRule, /text-overflow:\s*ellipsis/);
  assert.match(artistRule, /white-space:\s*nowrap/);
  assert.match(overlayStyles, /@media \(max-width: 360px\)\s*\{[\s\S]*?-webkit-line-clamp:\s*2/);
  assert.match(overlayStyles, /@media \(max-width: 280px\)\s*\{[\s\S]*?\.song-card span\s*\{[\s\S]*?display:\s*none/);

  const flatRecords = songModule.buildSongRecords([
    { id: 1, name: 'A "song"', artist: 'Artist & guests / Guest Two / Guest Three' }
  ], 'length');
  assert.equal(flatRecords.length, 1);
  assert.equal(flatRecords[0].song.name, 'A "song"');
  assert.equal(flatRecords[0].artist, 'Artist & guests');

  const artistRecords = songModule.buildSongRecords([
    { id: 1, name: 'First', artist: 'Lead / Guest Two' },
    { id: 2, name: 'Second', artist: 'Lead / Guest Three' }
  ], 'artist');
  assert.deepEqual(
    Array.from(artistRecords, (record) => record.type),
    ['heading', 'song', 'song']
  );
  assert.equal(artistRecords[0].label, 'Lead');
  assert.match(source, /\.textContent\s*=/);
  assert.doesNotMatch(source, /list\.innerHTML\s*=\s*html/);
});

test('song display board keeps one viewport above and one and a half below', async () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'songs.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  const styles = readCssBundle('public', 'css', 'overlays', 'base.css');
  assert.match(html, /<script type="module" src="\/js\/overlays\/songs\.js\?v=[^"]+"><\/script>/);
  assert.match(source, /new SongVirtualScroller\(\{[\s\S]*beforeViewports: 1,[\s\S]*afterViewports: 1\.5/);
  assert.match(source, /new ResizeObserver\(\(\) => scheduleRelayout\(\{ delay: 120 \}\)\)/);
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
      return this.parentElement.offsetTop + this.parentElement.children
        .slice(0, index)
        .reduce((total, node) => total + node.offsetHeight + this.parentElement.gap, 0);
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
      return this.children.reduce((total, node) => total + node.offsetHeight, 0)
        + (this.children.length - 1) * this.gap;
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
      this.children.forEach((node) => { node.parentElement = null; });
      this.children = [];
      nodes.forEach((node) => this.append(node));
    }
  }

  const {
    SongVirtualScroller,
    bufferPixels,
    pixelsPerSecond,
    wrapIndex
  } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'song-virtual-scroller.js')
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
      this.currentScrollTop = Math.min(
        Math.max(0, value),
        Math.max(0, content.scrollHeight - this.clientHeight)
      );
    }
  };
  const records = Array.from({ length: 1000 }, (_, index) => ({ key: `song:${index}` }));
  const scroller = new SongVirtualScroller({
    viewport,
    content,
    createNode: (record) => new FakeNode(20, record.key),
    requestFrame() { return 1; },
    cancelFrame() {}
  });

  scroller.setRecords(records, { key: 'song:500', offset: 5 });
  assert.equal(scroller.beforeViewports, 1);
  assert.equal(scroller.afterViewports, 1.5);
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
    requestFrame() { return 1; },
    cancelFrame() {}
  });
  shortScroller.setRecords(records.slice(0, 2));
  assert.equal(shortContent.children.length, 2);
  assert.equal(shortScroller.isScrollable, false);
});

test('song board scroll speed stays constant as content grows', async () => {
  const adminHtml = readAdminHtml();
  assert.match(adminHtml, /id="scrollSecondsRange" class="parameter-range" type="range" min="1" max="100"/);
  assert.match(adminHtml, /id="scrollSeconds" type="number" min="1" max="100"/);
  const songModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'),
    {
      document: { addEventListener() {} },
      location: { protocol: 'http:', host: 'localhost', search: '' },
      URLSearchParams,
      WebSocket: function WebSocket() {}
    }
  );
  const { pixelsPerSecond } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'song-virtual-scroller.js')
  );

  assert.equal(songModule.scrollSpeedToDuration(1), '20.557851');
  assert.equal(songModule.scrollSpeedToDuration(100), '2.000000');
  assert.equal(songModule.scrollSpeedToDuration(200), '2.000000');

  const rates = Array.from({ length: 100 }, (_, index) => index + 1).map((speed) => (
    1 / Number(songModule.scrollSpeedToDuration(speed))
  ));
  const rateSteps = rates.slice(1).map((rate, index) => rate - rates[index]);
  assert.ok(rateSteps.every((step) => Math.abs(step - rateSteps[0]) < 0.000001));

  const secondsPerViewport = Number(songModule.scrollSpeedToDuration(80));
  const rate = pixelsPerSecond(300, secondsPerViewport);
  assert.equal(rate, 300 / secondsPerViewport);
  assert.ok(Math.abs(((rate * 2) / 2) - ((rate * 20) / 20)) < 0.000001);
});
