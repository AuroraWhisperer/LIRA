'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const {
  readJsModuleBundle: readRawJsModuleBundle,
} = require('./helpers/js-module-bundle');

const ROOT_DIR = path.join(__dirname, '..');

function readJsModuleBundle(...relativeSegments) {
  return readRawJsModuleBundle(...relativeSegments).replace(
    /^\s*(?:export\s+)?\{\s*applyTheme,\s*setIdentityRuleThemeVars\s*\}\s+from\s+['"]\.\/queue-theme\.js['"];\s*/gm,
    '',
  );
}

test('identity content scrolls as one stream only when its rendered width overflows', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) {
      callback();
    },
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(source, sandbox);

  let longAnimation = null;
  const longClasses = new Set();
  const shortClasses = new Set(['has-horizontal-overflow']);
  const longText = {
    scrollWidth: 300,
    animate(keyframes, options) {
      longAnimation = { keyframes, options };
    },
  };
  const shortText = {
    scrollWidth: 90,
    animate() {
      assert.fail('fitting song text must not animate');
    },
  };
  const containers = [
    {
      clientWidth: 100,
      classList: {
        toggle(name, enabled) {
          if (enabled) longClasses.add(name);
          else longClasses.delete(name);
        },
      },
      querySelector: () => longText,
    },
    {
      clientWidth: 100,
      classList: {
        toggle(name, enabled) {
          if (enabled) shortClasses.add(name);
          else shortClasses.delete(name);
        },
      },
      querySelector: () => shortText,
    },
  ];

  sandbox.scheduleIdentityContentScroll({ querySelectorAll: () => containers });

  assert.ok(longAnimation);
  assert.deepEqual(
    Array.from(longAnimation.keyframes, (frame) => frame.transform),
    [
      'translateX(0)',
      'translateX(0)',
      'translateX(-200px)',
      'translateX(-200px)',
      'translateX(0)',
    ],
  );
  assert.equal(longClasses.has('has-horizontal-overflow'), true);
  assert.equal(shortClasses.has('has-horizontal-overflow'), false);
  assert.match(
    overlayStyles,
    /\.identity-content-wrapper\.has-horizontal-overflow\s*\{[^}]*justify-content:\s*flex-start/,
  );
  assert.match(
    overlayStyles,
    /\.identity-content-wrapper\.has-horizontal-overflow > \.identity-content\s*\{[^}]*margin-inline:\s*0/,
  );
  assert.equal(
    Math.round(
      (longAnimation.keyframes[1].offset - longAnimation.keyframes[0].offset) *
        longAnimation.options.duration,
    ),
    1000,
  );
  assert.equal(
    Math.round(
      (longAnimation.keyframes[3].offset - longAnimation.keyframes[2].offset) *
        longAnimation.options.duration,
    ),
    1000,
  );
  assert.doesNotMatch(sandbox.renderIdentityRow({ song_name: '1' }, 0), / • /);
  assert.match(source, /\.identity-content-wrapper, \.storybook-info-viewport/);
  assert.match(source, /\.identity-content, \.storybook-info/);
});

test('identity queue keeps song and requester fields in one continuous stream', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) {
      callback();
    },
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(source, sandbox);

  const row = sandbox.renderIdentityRow(
    {
      song_name: '米粒bb万岁万万岁',
      requester_name: '很长的点歌人',
      requester_guard_level: 2,
      requester_medal_name: '灯牌',
      requester_medal_level: 26,
    },
    0,
  );
  assert.match(
    row,
    /identity-content-wrapper[\s\S]*identity-content[\s\S]*identity-song[\s\S]*identity-requester[\s\S]*identity-badge[\s\S]*identity-medal/,
  );
  assert.doesNotMatch(
    row,
    /identity-song-wrapper|identity-details-wrapper|identity-details/,
  );
  assert.match(
    row,
    /identity-requester">[^<]*<\/span>\s*<span class="identity-badge[^"]*">[^<]*<\/span>\s*<span class="identity-medal">[^<]*<\/span>\s*<\/span>\s*<\/span>/,
    'badge and medal stay inside the same fading scroll wrapper as the song and requester',
  );
  const contentWrapperRule = overlayStyles.match(
    /\.identity-content-wrapper\s*\{[^}]*\}/,
  )?.[0];
  const contentRule = overlayStyles.match(
    /\.identity-content\s*\{[^}]*\}/,
  )?.[0];
  assert.ok(contentWrapperRule);
  assert.ok(contentRule);
  assert.match(contentWrapperRule, /flex:\s*1 1 auto/);
  assert.match(contentWrapperRule, /overflow:\s*hidden/);
  assert.doesNotMatch(contentWrapperRule, /mask-image/);
  assert.match(contentRule, /display:\s*inline-flex/);
  assert.match(contentRule, /min-width:\s*max-content/);
  assert.match(contentRule, /gap:\s*max\(4px,\s*0\.3em\)/);
  assert.doesNotMatch(
    overlayStyles,
    /\.identity-song-wrapper|\.identity-details-wrapper|\.identity-details/,
  );
  assert.doesNotMatch(overlayStyles, /transform:\s*translateX\(-52px\)/);

  let longAnimation = null;
  const longContent = {
    scrollWidth: 300,
    animate(keyframes, options) {
      longAnimation = { keyframes, options };
    },
  };
  const shortContent = {
    scrollWidth: 90,
    animate() {
      assert.fail('fitting identity content must not animate');
    },
  };
  const containers = [
    { clientWidth: 100, querySelector: () => longContent },
    { clientWidth: 100, querySelector: () => shortContent },
  ];

  sandbox.scheduleIdentityContentScroll({ querySelectorAll: () => containers });

  assert.ok(longAnimation);
  assert.deepEqual(
    Array.from(longAnimation.keyframes, (frame) => frame.transform),
    [
      'translateX(0)',
      'translateX(0)',
      'translateX(-200px)',
      'translateX(-200px)',
      'translateX(0)',
    ],
  );
  assert.equal(
    Math.round(
      (longAnimation.keyframes[1].offset - longAnimation.keyframes[0].offset) *
        longAnimation.options.duration,
    ),
    1000,
  );
  assert.equal(
    Math.round(
      (longAnimation.keyframes[3].offset - longAnimation.keyframes[2].offset) *
        longAnimation.options.duration,
    ),
    1000,
  );
});

test('identity queue shows the actual room medal name for a requester without guard status', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(source, sandbox);

  const imillyRow = sandbox.renderIdentityRow(
    {
      song_name: '测试歌曲',
      requester_name: '点歌人',
      requester_guard_level: 0,
      requester_medal_name: 'imilly',
      requester_medal_level: 26,
    },
    0,
  );
  const otherRoomRow = sandbox.renderIdentityRow(
    {
      song_name: '测试歌曲',
      requester_name: '点歌人',
      requester_guard_level: 0,
      requester_medal_name: '其他灯牌',
      requester_medal_level: 12,
    },
    0,
  );

  assert.match(imillyRow, /identity-badge identity-fan">imilly</);
  assert.doesNotMatch(imillyRow, /舰长/);
  assert.match(otherRoomRow, /identity-badge identity-fan">其他灯牌</);
  assert.doesNotMatch(otherRoomRow, /imilly/);
});

test('overlay utility helpers preserve shared formatting behavior', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'overlay-utils.js'),
    'utf8',
  );
  const sandbox = {
    URLSearchParams,
    location: { search: '?quality=low' },
    window: {},
  };

  vm.runInNewContext(source, sandbox);
  const utils = sandbox.window.OverlayUtils;

  assert.equal(
    utils.escapeHtml('"quoted" & <tag>'),
    '&quot;quoted&quot; &amp; &lt;tag&gt;',
  );
  const rgb = utils.hexToRgb('#abc');
  assert.equal(rgb.r, 170);
  assert.equal(rgb.g, 187);
  assert.equal(rgb.b, 204);
  assert.equal(utils.hexToRgba('#123456', 2), 'rgba(18, 52, 86, 1)');
  assert.equal(
    utils.withMultilingualFallback('Noto Sans'),
    'Noto Sans, "Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif',
  );
  assert.equal(utils.scrollTravelSeconds(12, 800, 300), 32);
  assert.equal(
    utils.overlayLowPowerEnabled({ overlayLowPowerMode: 'false' }),
    true,
  );
});

test('identity rule text scrolls independently only when it overflows', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) {
      callback();
    },
    document: { addEventListener() {} },
  };
  vm.runInNewContext(source, sandbox);

  let longAnimation = null;
  const longClasses = new Set();
  const longText = {
    scrollWidth: 220,
    animate(keyframes, options) {
      longAnimation = { keyframes, options };
    },
  };
  const shortText = {
    scrollWidth: 90,
    animate() {
      assert.fail('short rule text must not animate');
    },
  };
  const longContainer = {
    clientWidth: 100,
    querySelector: () => longText,
    classList: {
      add(name) {
        longClasses.add(name);
      },
    },
  };
  const shortContainer = {
    clientWidth: 100,
    querySelector: () => shortText,
    classList: { add() {} },
  };

  sandbox.scheduleIdentityRuleScroll({
    querySelectorAll: () => [longContainer, shortContainer],
  });

  assert.ok(longAnimation);
  assert.equal(longAnimation.keyframes[1].transform, 'translateX(-120px)');
  assert.ok(longClasses.has('is-scrolling'));
  const pauseMilliseconds =
    (longAnimation.keyframes[2].offset - longAnimation.keyframes[1].offset) *
    longAnimation.options.duration;
  assert.ok(Math.abs(pauseMilliseconds - 1500) < 0.001);
});

test('classic queue uses calculated row height and sizes indexes with song text', () => {
  const overlaySource = readJsModuleBundle(
    'public',
    'js',
    'overlays',
    'queue.js',
  );
  const styles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const waitingRule = styles.match(/\.overlay-waiting\s*\{[\s\S]*?\n\}/)?.[0];
  const windowRule = styles.match(
    /\.classic-list-window\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const indexRule = styles.match(
    /\.overlay-waiting-row \.index\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(waitingRule, 'classic queue list styles should remain defined');
  assert.ok(windowRule, 'classic queue viewport styles should remain defined');
  assert.ok(indexRule, 'classic queue index styles should remain defined');
  assert.doesNotMatch(waitingRule, /--classic-row-height/);
  assert.doesNotMatch(windowRule, /--classic-row-height/);
  assert.match(
    indexRule,
    /font-size:\s*var\(--overlay-waiting-font-size,\s*13px\)/,
  );
  assert.match(overlaySource, /setTimeout\(relayoutQueue, 100\)/);
  assert.doesNotMatch(
    overlaySource,
    /overlayResizeTimer = setTimeout\(render, 100\)/,
  );
  assert.match(overlaySource, /data-loop-clone/);
  assert.match(styles, /--overlay-edge:\s*clamp\(0px,\s*2vmin,\s*16px\)/);
  assert.match(styles, /\.queue-classic\s*\{[\s\S]*?width:\s*405px/);
  assert.match(styles, /\.queue-identity\s*\{[\s\S]*?width:\s*430px/);
  assert.match(
    styles,
    /\.queue-classic\s*\{[\s\S]*?transform:\s*scale\(var\(--queue-panel-scale,\s*1\)\)/,
  );
  assert.match(
    styles,
    /\.queue-identity\s*\{[\s\S]*?transform:\s*scale\(min\(var\(--queue-panel-scale,\s*1\),\s*1\)\)/,
  );
  assert.doesNotMatch(styles, /queue-viewport-resized/);
});

test('queue resize helpers preserve real rows while rebuilding loop copies', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(source, sandbox);

  const removed = [];
  const realRow = {
    remove() {
      assert.fail('real queue rows must remain mounted');
    },
  };
  const cloneRows = [
    {
      remove() {
        removed.push('first');
      },
    },
    {
      remove() {
        removed.push('second');
      },
    },
  ];
  const list = {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-loop-clone="true"]');
      return cloneRows;
    },
    children: [realRow, ...cloneRows],
  };

  sandbox.removeQueueLoopClones(list);
  assert.deepEqual(removed, ['first', 'second']);
});

test('identity queue scrolls from actual overflow', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: {
      addEventListener() {},
      getElementById() {
        return { textContent: '' };
      },
      documentElement: {
        style: {
          setProperty(name, value) {
            styleValues.set(name, value);
          },
        },
      },
    },
  };
  vm.runInNewContext(source, sandbox);

  const classes = new Set(['identity-list', 'paused']);
  let duplicatedHtml = '';
  const list = {
    scrollHeight: 500,
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
    },
    insertAdjacentHTML(_position, html) {
      duplicatedHtml += html;
    },
  };

  assert.equal(
    sandbox.configureIdentityVerticalScroll(
      { clientHeight: 300 },
      list,
      {
        queueScrollMode: 'loop',
        queueScrollSpeed: '10',
        identityQueueScrollSpeed: '42',
      },
      '<div>rows</div>',
      4,
    ),
    true,
  );
  assert.equal(styleValues.get('--identity-loop-distance'), '504px');
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds({ identityQueueScrollSpeed: '42' }, 'identityQueueScrollSpeed'), 504, 300)}s`,
  );
  assert.equal(duplicatedHtml, '<div>rows</div>');
  assert.equal(classes.has('paused'), false);
  assert.equal(classes.has('scrolling'), true);

  const bounceClasses = new Set(['identity-list', 'paused']);
  const bounceList = {
    scrollHeight: 500,
    classList: {
      add(name) {
        bounceClasses.add(name);
      },
      remove(name) {
        bounceClasses.delete(name);
      },
    },
    insertAdjacentHTML() {
      assert.fail('bounce content must not be duplicated');
    },
  };
  assert.equal(
    sandbox.configureIdentityVerticalScroll(
      { clientHeight: 300 },
      bounceList,
      {
        queueScrollMode: 'bounce',
        queueScrollSpeed: '10',
        identityQueueScrollSpeed: '42',
      },
      '<div>rows</div>',
      4,
    ),
    true,
  );
  assert.equal(styleValues.get('--identity-bounce-distance'), '200px');
  const bounceTiming = sandbox.bounceScrollTiming(
    sandbox.scrollTravelSeconds(
      sandbox.queueScrollSeconds(
        { identityQueueScrollSpeed: '42' },
        'identityQueueScrollSpeed',
      ),
      200,
      300,
    ),
    sandbox.scrollTravelSeconds(3, 200, 300),
  );
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${bounceTiming.totalSeconds}s`,
  );
  assert.equal(bounceClasses.has('paused'), false);
  assert.equal(bounceClasses.has('scrolling-bounce'), true);

  const fittingList = {
    scrollHeight: 280,
    classList: { add() {}, remove() {} },
    insertAdjacentHTML() {
      assert.fail('fitting content must not be duplicated');
    },
  };
  assert.equal(
    sandbox.configureIdentityVerticalScroll(
      { clientHeight: 300 },
      fittingList,
      {},
      '',
      4,
    ),
    false,
  );

  const shortDistance = 200;
  const longDistance = 800;
  const shortSeconds = sandbox.scrollTravelSeconds(12, shortDistance, 300);
  const longSeconds = sandbox.scrollTravelSeconds(12, longDistance, 300);
  assert.ok(
    Math.abs(shortDistance / shortSeconds - longDistance / longSeconds) < 0.001,
  );
});
