'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');

const ROOT_DIR = path.join(__dirname, '..');

test('admin overlay links do not retain the old fixed port placeholder', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const displaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'),
    'utf8'
  );
  const settingsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings.js'),
    'utf8'
  );

  assert.doesNotMatch(html, /localhost:3000\/blindbox/);
  assert.doesNotMatch(displaySource, /localhost:3000/);
  assert.doesNotMatch(settingsSource, /localhost:3000/);
  assert.match(displaySource, /location\.origin/);
  assert.match(settingsSource, /location\.host/);
});

test('gift workspace rows keep their content height inside the scroll container', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const giftWorkspaceRule = source.match(/\.gift-workspace\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(giftWorkspaceRule, 'gift workspace styles should remain defined');
  assert.match(giftWorkspaceRule, /grid-template-rows:\s*repeat\(5, max-content\)/);
});

test('debug gift data attributes escape quotes, apostrophes, and backticks', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'debug-gifts.html'), 'utf8');
  const escapeHtmlSource = source.match(/function escHtml\(s\) \{[\s\S]*?\n\}/)?.[0];
  const escapeAttrSource = source.match(/function escAttr\(s\) \{[\s\S]*?\n\}/)?.[0];

  assert.ok(escapeHtmlSource, 'escHtml should remain defined');
  assert.ok(escapeAttrSource, 'escAttr should be defined for data attributes');

  const sandbox = {
    document: {
      createElement() {
        let text = '';
        return {
          set textContent(value) { text = String(value); },
          get innerHTML() {
            return text
              .replaceAll('&', '&amp;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;');
          }
        };
      }
    }
  };
  vm.runInNewContext(`${escapeHtmlSource}\n${escapeAttrSource}`, sandbox);

  assert.equal(
    sandbox.escAttr('"quoted\' `value`'),
    '&quot;quoted&#39; &#96;value&#96;'
  );
});

test('fullscreen resets lyric mode before rendering a different track', async () => {
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js')
  );
  const player = new FullscreenPlayer();
  let renderedMode = '';

  player.fsEl = { classList: { contains: () => true } };
  player.lyricMode = 'trans';
  player._lastLyricTrackId = 'old-track';
  player.lyricTogglesEl = { style: {} };
  player.renderTrackInfo = () => {};
  player.renderArtwork = () => {};
  player.applyBackgroundTheme = () => {};
  player.updateVinylAnimation = () => {};
  player.renderLyrics = () => { renderedMode = player.lyricMode; };

  player.render({ id: 'new-track', lyrics: { lines: [] } }, { paused: false });

  assert.equal(renderedMode, 'none');
  assert.equal(player.lyricMode, 'none');
  assert.equal(player._lastLyricTrackId, 'new-track');
});

test('liked tracks continue past fifty full pages', async () => {
  let requestCount = 0;
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      async fetch(_url, options) {
        const { offset } = JSON.parse(options.body);
        requestCount += 1;
        const tracks = offset < 5100
          ? Array.from({ length: 100 }, (_, index) => ({ id: `track-${offset + index}` }))
          : [];
        return response({ ok: true, data: { tracks } });
      }
    }
  );
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    readJsonResponse: async (result) => result.payload
  });

  const result = await loader._fetchLikedTracksAll('Liked');

  assert.equal(result.items.length, 5100);
  assert.equal(requestCount, 52);
});

test('liked tracks stop when a provider repeats a full page', async () => {
  let requestCount = 0;
  const repeatedTracks = Array.from({ length: 100 }, (_, index) => ({ id: `track-${index}` }));
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      async fetch() {
        requestCount += 1;
        return response({ ok: true, data: { tracks: repeatedTracks } });
      }
    }
  );
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    readJsonResponse: async (result) => result.payload
  });

  const result = await loader._fetchLikedTracksAll('Liked');

  assert.equal(result.items.length, 100);
  assert.equal(requestCount, 2);
});

test('queue overlay applies rule sizing and scrolls only overflowing super chats', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) { callback(); },
    document: {
      addEventListener() {},
      documentElement: {
        style: { setProperty(name, value) { styleValues.set(name, value); } }
      }
    }
  };
  vm.runInNewContext(source, sandbox);

  sandbox.setIdentityRuleThemeVars(sandbox.document.documentElement, { overlayRuleFontSize: 12 });
  assert.equal(styleValues.get('--identity-rule-font-size'), '24px');

  let longAnimation = null;
  const longText = {
    scrollWidth: 300,
    animate(keyframes, options) { longAnimation = { keyframes, options }; }
  };
  const shortText = { scrollWidth: 90, animate() { assert.fail('short text must not animate'); } };
  const containers = [
    { clientWidth: 100, querySelector: () => longText },
    { clientWidth: 100, querySelector: () => shortText }
  ];

  sandbox.scheduleIdentitySuperChatScroll({ querySelectorAll: () => containers });
  assert.ok(longAnimation);
  assert.equal(longAnimation.keyframes[1].transform, 'translateX(-200px)');
  const pauseMilliseconds = (
    longAnimation.keyframes[2].offset - longAnimation.keyframes[1].offset
  ) * longAnimation.options.duration;
  assert.ok(Math.abs(pauseMilliseconds - 1500) < 0.001);

  const timing = sandbox.bounceScrollTiming(12);
  const verticalPauseSeconds = (
    (timing.pauseEndPercent - timing.downPercent) / 100
  ) * timing.totalSeconds;
  assert.ok(Math.abs(verticalPauseSeconds - 1.5) < 0.000001);
});

test('identity queue has an independent scroll speed setting', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const formSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');

  assert.match(html, /id="identityQueueScrollSpeedRange"/);
  assert.match(html, /id="identityQueueScrollSpeed"/);
  assert.match(formSource, /identityQueueScrollSpeed:/);
  assert.match(defaultsSource, /identityQueueScrollSpeed: '80'/);
});

test('identity rule text scrolls independently only when it overflows', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) { callback(); },
    document: { addEventListener() {} }
  };
  vm.runInNewContext(source, sandbox);

  let longAnimation = null;
  const longClasses = new Set();
  const longText = {
    scrollWidth: 220,
    animate(keyframes, options) { longAnimation = { keyframes, options }; }
  };
  const shortText = {
    scrollWidth: 90,
    animate() { assert.fail('short rule text must not animate'); }
  };
  const longContainer = {
    clientWidth: 100,
    querySelector: () => longText,
    classList: { add(name) { longClasses.add(name); } }
  };
  const shortContainer = {
    clientWidth: 100,
    querySelector: () => shortText,
    classList: { add() {} }
  };

  sandbox.scheduleIdentityRuleScroll({
    querySelectorAll: () => [longContainer, shortContainer]
  });

  assert.ok(longAnimation);
  assert.equal(longAnimation.keyframes[1].transform, 'translateX(-120px)');
  assert.ok(longClasses.has('is-scrolling'));
  const pauseMilliseconds = (
    longAnimation.keyframes[2].offset - longAnimation.keyframes[1].offset
  ) * longAnimation.options.duration;
  assert.ok(Math.abs(pauseMilliseconds - 1500) < 0.001);
});

test('identity queue scrolls from actual overflow instead of a fixed row count', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: {
      addEventListener() {},
      getElementById() { return { textContent: '' }; },
      documentElement: {
        style: { setProperty(name, value) { styleValues.set(name, value); } }
      }
    }
  };
  vm.runInNewContext(source, sandbox);

  const classicContent = { innerHTML: '' };
  const classicSettings = {
    queueScrollMode: 'loop',
    queueScrollSpeed: '42',
    queueSongFontSize: '40'
  };
  sandbox.renderClassicQueue(
    classicSettings,
    { song_name: 'current' },
    Array.from({ length: 6 }, (_, index) => ({ song_name: `waiting-${index}` })),
    classicContent
  );
  assert.equal(styleValues.get('--classic-loop-distance'), '364px');
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds(classicSettings), 364, 307)}s`
  );

  const classes = new Set(['identity-list', 'paused']);
  let duplicatedHtml = '';
  const list = {
    scrollHeight: 500,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    },
    insertAdjacentHTML(_position, html) { duplicatedHtml += html; }
  };

  assert.equal(
    sandbox.configureIdentityVerticalScroll({ clientHeight: 300 }, list, {
      queueScrollMode: 'loop',
      queueScrollSpeed: '10',
      identityQueueScrollSpeed: '42'
    }, '<div>rows</div>', 4),
    true
  );
  assert.equal(styleValues.get('--identity-loop-distance'), '504px');
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds({ identityQueueScrollSpeed: '42' }, 'identityQueueScrollSpeed'), 504, 300)}s`
  );
  assert.equal(duplicatedHtml, '<div>rows</div>');
  assert.equal(classes.has('paused'), false);
  assert.equal(classes.has('scrolling'), true);

  const bounceClasses = new Set(['identity-list', 'paused']);
  const bounceList = {
    scrollHeight: 500,
    classList: {
      add(name) { bounceClasses.add(name); },
      remove(name) { bounceClasses.delete(name); }
    },
    insertAdjacentHTML() { assert.fail('bounce content must not be duplicated'); }
  };
  assert.equal(
    sandbox.configureIdentityVerticalScroll({ clientHeight: 300 }, bounceList, {
      queueScrollMode: 'bounce',
      queueScrollSpeed: '10',
      identityQueueScrollSpeed: '42'
    }, '<div>rows</div>', 4),
    true
  );
  assert.equal(styleValues.get('--identity-bounce-distance'), '200px');
  const bounceTiming = sandbox.bounceScrollTiming(
    sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds({ identityQueueScrollSpeed: '42' }, 'identityQueueScrollSpeed'), 200, 300),
    sandbox.scrollTravelSeconds(3, 200, 300)
  );
  assert.equal(styleValues.get('--scroll-seconds'), `${bounceTiming.totalSeconds}s`);
  assert.equal(bounceClasses.has('paused'), false);
  assert.equal(bounceClasses.has('scrolling-bounce'), true);

  const fittingList = {
    scrollHeight: 280,
    classList: { add() {}, remove() {} },
    insertAdjacentHTML() { assert.fail('fitting content must not be duplicated'); }
  };
  assert.equal(
    sandbox.configureIdentityVerticalScroll({ clientHeight: 300 }, fittingList, {}, '', 4),
    false
  );

  const shortDistance = 200;
  const longDistance = 800;
  const shortSeconds = sandbox.scrollTravelSeconds(12, shortDistance, 300);
  const longSeconds = sandbox.scrollTravelSeconds(12, longDistance, 300);
  assert.ok(Math.abs((shortDistance / shortSeconds) - (longDistance / longSeconds)) < 0.001);
});

test('song board scroll speed stays constant as content grows', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: {
      addEventListener() {},
      documentElement: {
        style: { setProperty(name, value) { styleValues.set(name, value); } }
      }
    }
  };
  vm.runInNewContext(source, sandbox);

  const classes = new Set(['song-scroll-list', 'paused']);
  let duplicatedHtml = '';
  const list = {
    scrollHeight: 600,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    },
    insertAdjacentHTML(_position, html) { duplicatedHtml += html; }
  };
  const settings = { scrollSeconds: '80' };

  assert.equal(sandbox.configureSongScroll({ clientHeight: 300 }, list, settings, '<div>songs</div>'), true);
  const loopDistance = 608;
  const travelSeconds = sandbox.scrollTravelSeconds(
    sandbox.scrollSpeedToDuration(80),
    loopDistance,
    300
  );
  assert.equal(styleValues.get('--song-loop-distance'), `${loopDistance}px`);
  assert.equal(styleValues.get('--scroll-seconds'), `${travelSeconds}s`);
  assert.equal(duplicatedHtml, '<div>songs</div>');
  assert.equal(classes.has('paused'), false);

  const longerDistance = loopDistance * 2;
  const longerSeconds = sandbox.scrollTravelSeconds(sandbox.scrollSpeedToDuration(80), longerDistance, 300);
  assert.ok(Math.abs((loopDistance / travelSeconds) - (longerDistance / longerSeconds)) < 0.001);
});

async function loadModuleExports(entryPath, globals = {}) {
  const context = vm.createContext({
    console,
    fetch: globals.fetch,
    window: {},
    ...globals
  });
  const modules = new Map();

  async function load(filePath) {
    const identifier = pathToFileURL(filePath).href;
    if (modules.has(identifier)) return modules.get(identifier);
    const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
      context,
      identifier
    });
    modules.set(identifier, module);
    await module.link((specifier, referencingModule) => {
      const dependencyUrl = new URL(specifier, referencingModule.identifier);
      return load(fileURLToPath(dependencyUrl));
    });
    return module;
  }

  const module = await load(entryPath);
  await module.evaluate();
  return module.namespace;
}

function response(payload) {
  return { ok: payload.ok !== false, payload };
}
