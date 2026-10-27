const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const contract = require('../../src/shared/danmaku-style-options');
const { createFakeDocument } = require('../helpers/fake-dom');

// Expected per-style controls. Font family, size and text color apply to every style.
const RIPPLOID_COLOR_KEYS = [
  'giftColor0', 'giftColor50', 'giftColor100', 'giftColor500', 'giftColor1000', 'giftColor2000',
  'guardColorCaptain', 'guardColorAdmiral', 'guardColorGovernor',
  'superchatColor0', 'superchatColor50', 'superchatColor100', 'superchatColor500', 'superchatColor1000', 'superchatColor2000',
];
const SPOOKY_COLOR_KEYS = ['spookyFrameColor', 'spookyMessageColor', 'spookyEventColor', 'spookyAccentColor'];
const SPOOKY_OPACITY_KEYS = ['spookyFrameOpacity', 'spookyMessageOpacity', 'spookyEventOpacity'];
const TWITTER_LAYOUT_KEYS = ['twitterHeader', 'twitterComposer', 'twitterActions'];
const TWITTER_COLORS = { twitterColor0: '#409afa', twitterColor50: '#f9c844', twitterColor100: '#f89260', twitterColor1000: '#ef4260' };
const CONTROLS = {
  harbor: ['scrollDirection', 'edgeFade', 'backgroundOpacity', 'minGiftAmount'],
  bubble: ['scrollDirection', 'edgeFade', 'backgroundOpacity', 'giftImage'],
  signal: ['scrollDirection', 'edgeFade', 'backgroundOpacity', 'giftImage'],
  minimal: ['scrollDirection', 'edgeFade'],
  ranked: ['scrollDirection', 'edgeFade', 'backgroundOpacity', 'giftImage'],
  transparent: ['scrollDirection', 'edgeFade', 'giftImage'],
  identity: ['scrollDirection', 'edgeFade', 'backgroundOpacity', 'giftImage'],
  sketch: ['scrollDirection', 'edgeFade', 'backgroundOpacity'],
  prismatic: ['scrollDirection', 'edgeFade'],
  snowfox: ['scrollDirection', 'edgeFade', 'bubbleColor'],
  ripploid: ['scrollDirection', 'edgeFade', 'bubbleColor', ...RIPPLOID_COLOR_KEYS],
  twitter: ['scrollDirection', 'edgeFade', 'giftImage', 'composerText', ...TWITTER_LAYOUT_KEYS, ...Object.keys(TWITTER_COLORS)],
  'flower-letter': ['scrollDirection', 'edgeFade', 'backgroundOpacity'],
  notebook: ['scrollDirection', 'edgeFade'],
  spooky: ['scrollDirection', 'edgeFade', 'spookyTheme', 'spookyFrame', ...SPOOKY_COLOR_KEYS, ...SPOOKY_OPACITY_KEYS],
  starlight: ['scrollDirection', 'edgeFade', 'decorationShape'],
  moonlit: ['scrollDirection', 'edgeFade', 'backgroundOpacity', 'giftImage'],
  outline: ['centerBias', 'dispersion', 'backgroundOpacity', 'giftImage'],
  whiteframe: ['centerBias', 'dispersion', 'entranceAnimation'],
  mist: ['centerBias', 'dispersion', 'backgroundOpacity'],
  cream: ['centerBias', 'dispersion', 'backgroundOpacity', 'giftImage'],
  floating: ['speedPixelsPerSecond', 'floatingDispersion', 'backgroundOpacity'],
  comet: ['speedPixelsPerSecond', 'floatingDispersion', 'backgroundOpacity'],
  starveil: ['centerBias', 'dispersion', 'backgroundOpacity', 'entranceAnimation'],
  glow: ['centerBias', 'dispersion', 'backgroundOpacity', 'entranceAnimation'],
};
const CONTROL_VALUES = {
  composerText: {
    valid: ['欢迎来到直播间 ✨', '中文 English #😊', '字'.repeat(20), '👨‍👩‍👧‍👦'.repeat(20)],
    invalid: ['字'.repeat(21), '👨‍👩‍👧‍👦'.repeat(21), 'a\nb', 'a\u0000b', null, 1, true, {}],
    fallback: '欢迎来到直播间 ✨', optional: true,
  },
  spookyTheme: { valid: ['default', 'autumn', 'graveyard', 'moonlight'], invalid: ['purple', '', null, true, 1], fallback: 'default', optional: true },
  spookyFrame: { valid: ['show', 'hide'], invalid: ['', 'SHOW', null, true, 1], fallback: 'show', optional: true },
  decorationShape: { valid: ['sparkle', 'heart', 'square', 'star', 'flower', 'moon', 'bow'], invalid: ['circle', 'HEART', '', null, true, 1, {}], fallback: 'sparkle', optional: true },
  entranceAnimation: { valid: ['fade', 'rise'], invalid: ['slide', 'RISE', '', null, true, 1, {}], fallback: 'fade', optional: true },
  floatingDispersion: { valid: [1, 50, 100], invalid: [0, 101, 1.5, '50', null, true], fallback: 50, optional: true },
  minGiftAmount: { valid: [0, 0.01, 9.99, 100000], invalid: [-1, 100000.01, 1.005, '1', null, true, Infinity, NaN], fallback: 0, optional: true },
  bubbleColor: { valid: ['default', '#ba739c', '#ba739c80'], invalid: ['', 'red', '#abc', '#123456\n', null, 1], fallback: 'default', optional: true },
  edgeFade: { valid: ['both', 'top', 'bottom', 'single', 'none'], invalid: ['left', 'BOTH', '', null, true, 1], optional: true },
  scrollDirection: { valid: ['up', 'down'], invalid: ['left', 'DOWN', '', null, true, 1], fallback: 'up' },
  backgroundOpacity: { valid: [0, 100], invalid: [-1, 101, 50.5, '50', null] },
  giftImage: { valid: ['theme', 'gift'], invalid: ['https://evil.test/x.webp', '', null] },
  speedPixelsPerSecond: {
    valid: [20, 120, 600],
    invalid: [0, 19, 601, 100.5, '120', null, true],
    fallback: 120,
    optional: true,
  },
  centerBias: { valid: [1, 25, 50], invalid: [0, 51, 1.5, '25', null, true], fallback: 1, optional: true },
  dispersion: { valid: [1, 25, 50], invalid: [0, 51, 1.5, '25', null, true], fallback: 1, optional: true },
};
for (const key of RIPPLOID_COLOR_KEYS) {
  CONTROL_VALUES[key] = {
    valid: ['#a1b2c3'],
    invalid: ['', 'red', '#abc', '#a1b2c380', '#a1b2c3\n', null, 1, undefined],
    fallback: '#f39749',
    optional: true,
  };
}
for (const key of SPOOKY_COLOR_KEYS) CONTROL_VALUES[key] = {
  valid: ['default', '#a1b2c3', '#a1b2c380'], invalid: ['', 'red', '#abc', '#a1b2c3\n', null, 1, undefined], fallback: 'default', optional: true,
};
for (const key of SPOOKY_OPACITY_KEYS) CONTROL_VALUES[key] = {
  valid: [0, 50, 100], invalid: [-1, 101, 50.5, '50', null, true], fallback: 100, optional: true,
};
for (const key of TWITTER_LAYOUT_KEYS) CONTROL_VALUES[key] = {
  valid: ['show', 'hide'], invalid: ['', 'SHOW', null, true, 1], fallback: 'show', optional: true,
};
for (const [key, fallback] of Object.entries(TWITTER_COLORS)) CONTROL_VALUES[key] = {
  valid: ['#a1b2c3', '#a1b2c380'], invalid: ['', 'red', '#abc', '#a1b2c3\n', null, 1, undefined], fallback, optional: true,
};

test('each style accepts exactly its own controls with bounded values and defaults', () => {
  assert.deepEqual(Object.keys(CONTROLS).sort(), Object.keys(contract.DANMAKU_STYLE_OPTIONS).sort());
  for (const [style, controls] of Object.entries(CONTROLS)) {
    for (const [control, { valid, invalid, fallback, optional }] of Object.entries(CONTROL_VALUES)) {
      const normalize = (value) => contract.normalizeStyleOptions({ [style]: { [control]: value } });
      if (!controls.includes(control)) {
        assert.throws(() => normalize(valid[0]), { code: 'INVALID_OVERLAY_OPTIONS' }, `${style} rejects ${control}`);
        if (optional)
          assert.equal(Object.hasOwn(contract.styleOptionsFor(style), control), false, `${style} ${control}`);
        continue;
      }
      for (const value of valid)
        assert.deepEqual(normalize(value), { [style]: { [control]: value } }, `${style} ${control}`);
      for (const value of invalid) {
        assert.throws(() => normalize(value), { code: 'INVALID_OVERLAY_OPTIONS' }, `${style} ${control} ${value}`);
      }
      if (fallback !== undefined)
        assert.equal(contract.styleOptionsFor(style)[control], fallback, `${style} ${control}`);
    }
  }
});

test('RIPPLOID resolves its own font default and independent event color variables', async () => {
  assert.deepEqual(contract.RIPPLOID_COLOR_DEFAULTS, Object.fromEntries(RIPPLOID_COLOR_KEYS.map((key) => [key, '#f39749'])));
  assert.equal(contract.styleOptionsFor('ripploid').fontSize, 24);
  assert.deepEqual(contract.normalizeStyleOptions({ ripploid: { giftColor50: '#AaBbCc' } }), {
    ripploid: { giftColor50: '#aabbcc' },
  });
  for (const key of RIPPLOID_COLOR_KEYS) {
    assert.equal(Object.hasOwn(contract.styleOptionsFor('snowfox'), key), false);
  }
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js'), 'utf8');
  const browser = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const document = {
    documentElement: { style: { setProperty(key, value) { this[key] = value; } } },
    body: { dataset: {} },
  };
  const saved = { ripploid: { giftColor50: '#123456', guardColorAdmiral: '#654321', superchatColor2000: '#abcdef' } };
  browser.applyStyleOptions(document, 'ripploid', saved);
  const root = document.documentElement.style;
  assert.equal(root['--ripploid-gift-color50'], '#123456');
  assert.equal(root['--ripploid-guard-color-admiral'], '#654321');
  assert.equal(root['--ripploid-superchat-color2000'], '#abcdef');
  assert.equal(root['--ripploid-gift-color0'], '#f39749');
  assert.equal(root['--danmaku-font-size'], '24px');
  assert.equal(document.body.dataset.customSize, 'false');
  browser.applyStyleOptions(document, 'ripploid', { ripploid: { fontSize: 30 } });
  assert.equal(document.body.dataset.customSize, 'true');
  browser.applyStyleOptions(document, 'snowfox', {});
  for (const key of RIPPLOID_COLOR_KEYS) {
    const suffix = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    assert.equal(root[`--ripploid-${suffix}`], '', `${key} is cleared outside RIPPLOID`);
  }
});

test('flower-letter defaults to the accepted Yozai font without changing other themes', () => {
  const options = contract.styleOptionsFor('flower-letter');
  assert.equal(options.fontFamily, '"Lira Yozai"');
  assert.equal(options.fontSize, 24);
  assert.equal(options.edgeFade, 'none');
  assert.equal(options.textColor, '#766449');
  assert.equal(contract.styleOptionsFor('signal').fontFamily, 'default');
  assert.equal(contract.styleOptionsFor('flower-letter', { 'flower-letter': { fontFamily: 'sans' } }).fontFamily, 'sans');
});

test('Twitter defaults to its reference-sized type, original gifts and hard panel edges', () => {
  const options = contract.styleOptionsFor('twitter');
  assert.equal(options.fontSize, 22);
  assert.equal(options.giftImage, 'gift');
  assert.equal(options.edgeFade, 'none');
  assert.equal(options.textColor, '#141414');
  assert.deepEqual(contract.normalizeStyleOptions({ twitter: { giftImage: 'theme' } }), {
    twitter: { giftImage: 'theme' },
  });
});

test('Twitter layout and event palette apply to existing content and clear outside the style', async () => {
  const browser = await import(pathToFileURL(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js')).href);
  const document = { body: { dataset: {} }, documentElement: { style: { setProperty(key, value) { this[key] = value; } } } };
  const options = { twitterHeader: 'hide', twitterComposer: 'hide', twitterActions: 'hide', twitterColor50: '#ABCDEF80' };
  assert.deepEqual(contract.normalizeStyleOptions({ twitter: options }), { twitter: { ...options, twitterColor50: '#abcdef80' } });
  browser.applyStyleOptions(document, 'twitter', { twitter: options });
  for (const key of TWITTER_LAYOUT_KEYS) assert.equal(document.body.dataset[key], 'hide');
  assert.equal(document.documentElement.style['--twitter-event-color-50'], '#abcdef80');
  assert.equal(document.documentElement.style['--twitter-event-color-0'], '#409afa');
  browser.applyStyleOptions(document, 'signal', {});
  for (const key of TWITTER_LAYOUT_KEYS) assert.equal(document.body.dataset[key], 'show');
  for (const tier of [0, 50, 100, 1000]) assert.equal(document.documentElement.style[`--twitter-event-color-${tier}`], '');
  browser.applyStyleOptions(document, 'twitter', {});
  for (const [key, color] of Object.entries(TWITTER_COLORS)) {
    assert.equal(document.documentElement.style[`--twitter-event-color-${key.replace('twitterColor', '')}`], color);
  }
});

test('Twitter composer text counts visible characters, normalizes Unicode and restores its default when blank', async () => {
  assert.deepEqual(contract.inspectComposerText(' e\u0301 ✨ 👨‍👩‍👧‍👦 '), { text: 'é ✨ 👨‍👩‍👧‍👦', length: 5, error: '' });
  assert.deepEqual(contract.normalizeStyleOptions({ twitter: { composerText: '  中英 Hello!  ' } }), {
    twitter: { composerText: '中英 Hello!' },
  });
  assert.deepEqual(contract.normalizeStyleOptions({ twitter: { composerText: '   ' } }), { twitter: {} });
  assert.equal(contract.styleOptionsFor('twitter', { twitter: { composerText: '' } }).composerText, contract.TWITTER_COMPOSER_TEXT_DEFAULT);
  const browser = await import(pathToFileURL(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js')).href);
  const node = { textContent: '', children: [] };
  const document = { body: { dataset: {} }, documentElement: { style: { setProperty() {} } }, getElementById: () => node };
  browser.applyStyleOptions(document, 'twitter', { twitter: { composerText: '<b>你好</b>' } });
  assert.equal(node.textContent, '<b>你好</b>');
  assert.equal(node.children.length, 0);
  browser.applyStyleOptions(document, 'twitter', {});
  assert.equal(node.textContent, contract.TWITTER_COMPOSER_TEXT_DEFAULT);
});

test('spooky follows theme ink, preserves explicit overrides and clears renderer variables outside the style', async () => {
  const browser = await import(pathToFileURL(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js')).href);
  const document = { documentElement: { style: { setProperty(key, value) { this[key] = value; } } }, body: { dataset: {} } };
  const root = document.documentElement.style;
  for (const [theme, ink] of [['default', '#fce6fa'], ['autumn', '#fff1d1'], ['graveyard', '#f3e9fa'], ['moonlight', '#edf0ff']]) {
    browser.applyStyleOptions(document, 'spooky', { spooky: { spookyTheme: theme } });
    assert.equal(root['--danmaku-text-color'], ink);
    assert.equal(document.body.dataset.customTextColor, 'false');
    const explicit = { spooky: { spookyTheme: theme, textColor: '#fce6fa', spookyMessageColor: '#123456', spookyFrameOpacity: 0, spookyMessageOpacity: 35, spookyEventOpacity: 75, spookyAccentColor: '#abcdef' } };
    const options = browser.applyStyleOptions(document, 'spooky', explicit);
    assert.equal(options.textColor, '#fce6fa', 'an explicit default-colored override must survive theme changes');
    assert.equal(document.body.dataset.customTextColor, 'true');
    assert.equal(root['--spooky-custom-message-color'], '#123456');
    assert.equal(root['--spooky-frame-weight'], '0%');
    assert.equal(root['--spooky-message-weight'], '35%');
    assert.equal(root['--spooky-event-weight'], '75%');
    assert.equal(document.body.dataset.spookyCustomAccent, 'true');
  }
  browser.applyStyleOptions(document, 'signal', {});
  for (const layer of ['frame', 'message', 'event', 'accent']) assert.equal(root[`--spooky-custom-${layer}-color`], '');
  assert.equal(root['--spooky-custom-message-right'], '');
  assert.equal(document.body.dataset.spookyCustomAccent, 'false');
});

test('styles without gift artwork always use real gift images while accepting legacy saved options', () => {
  assert.equal(contract.DANMAKU_STYLE_OPTIONS.identity.label, '灵动弹幕');
  for (const style of ['identity', 'transparent', 'outline', 'bubble', 'cream', 'twitter']) {
    for (const options of [{}, { giftImage: 'theme' }, { giftImage: 'gift' }]) {
      assert.deepEqual(contract.normalizeStyleOptions({ [style]: options }), { [style]: options });
      assert.equal(contract.styleOptionsFor(style, { [style]: options }).giftImage, 'gift');
    }
  }
  assert.equal(contract.styleOptionsFor('signal').giftImage, 'theme');
});

test('scroll direction applies to fixed styles and resets to upward for other layouts', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js'), 'utf8');
  const browser = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const document = {
    documentElement: { style: { setProperty() {} } },
    body: { dataset: {} },
  };
  for (const style of Object.keys(CONTROLS).filter((name) => CONTROLS[name].includes('scrollDirection'))) {
    for (const scrollDirection of ['up', 'down']) {
      const options = { [style]: { scrollDirection } };
      browser.applyStyleOptions(document, style, options);
      assert.equal(document.body.dataset.scrollDirection, scrollDirection);
    }
    browser.applyStyleOptions(document, style, {});
    assert.equal(document.body.dataset.scrollDirection, 'up');
  }
  for (const style of Object.keys(CONTROLS).filter((name) => !CONTROLS[name].includes('scrollDirection'))) {
    browser.applyStyleOptions(document, 'signal', { signal: { scrollDirection: 'down' } });
    browser.applyStyleOptions(document, style, { signal: { scrollDirection: 'down' } });
    assert.equal(document.body.dataset.scrollDirection, 'up');
  }
});

test('edge fading keeps theme defaults, applies overrides and clears on other layouts', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js'), 'utf8');
  const browser = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const document = { documentElement: { style: { setProperty() {} } }, body: { dataset: {} } };
  for (const [style, controls] of Object.entries(CONTROLS)) {
    if (controls.includes('edgeFade')) {
      const fallback = style === 'prismatic' ? 'both' : ['twitter', 'spooky', 'flower-letter', 'notebook'].includes(style) ? 'none' : 'top';
      assert.equal(contract.styleOptionsFor(style).edgeFade, fallback);
      for (const scrollDirection of ['up', 'down']) {
        for (const edgeFade of CONTROL_VALUES.edgeFade.valid) {
          const options = { [style]: { scrollDirection, edgeFade } };
          const expected = edgeFade === 'single' ? (scrollDirection === 'down' ? 'bottom' : 'top') : edgeFade;
          assert.equal(contract.styleOptionsFor(style, options).edgeFade, expected);
          browser.applyStyleOptions(document, style, options);
          assert.equal(document.body.dataset.edgeFade, expected);
        }
        browser.applyStyleOptions(document, style, { [style]: { scrollDirection } });
        assert.equal(document.body.dataset.edgeFade, style === 'prismatic' ? 'both' : ['twitter', 'spooky', 'flower-letter', 'notebook'].includes(style) ? 'none' : scrollDirection === 'down' ? 'bottom' : 'top');
      }
      browser.applyStyleOptions(document, style, { [style]: {} });
      assert.equal(document.body.dataset.edgeFade, fallback);
    } else {
      browser.applyStyleOptions(document, 'prismatic', {});
      browser.applyStyleOptions(document, style, {});
      assert.equal(document.body.dataset.edgeFade, 'none');
    }
  }
});

test('entrance animation stays per style and resets on empty options or unsupported styles', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js'), 'utf8');
  const browser = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const document = { documentElement: { style: { setProperty() {} } }, body: { dataset: {} } };
  const saved = contract.normalizeStyleOptions({
    whiteframe: { entranceAnimation: 'rise' },
    glow: { entranceAnimation: 'fade' },
    starveil: { entranceAnimation: 'rise' },
  });
  for (const [style, controls] of Object.entries(CONTROLS)) {
    browser.applyStyleOptions(document, 'whiteframe', saved);
    const options = browser.applyStyleOptions(document, style, saved);
    assert.equal(document.body.dataset.entranceAnimation, saved[style]?.entranceAnimation || 'fade');
    assert.equal(Object.hasOwn(options, 'entranceAnimation'), controls.includes('entranceAnimation'));
    browser.applyStyleOptions(document, style, { [style]: {} });
    assert.equal(document.body.dataset.entranceAnimation, 'fade');
  }
});

test('gift images keep theme artwork while loading and restore it on failure', async () => {
  const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import(
    pathToFileURL(path.join(__dirname, '../../public/js/overlays/danmaku-message-renderer.js')).href
  );
  const document = createFakeDocument();
  const sourceUrl = 'https://i0.hdslb.com/bfs/live/synthetic.webp';
  const render = createDanmakuMessageRenderer({
    document,
    classNames: DEFAULT_DANMAKU_CLASSES,
    showAvatar: false,
    resolveGiftImageUrl: (value) => (value === sourceUrl ? value : ''),
  });
  const gift = {
    kind: 'gift',
    name: '观众',
    message: '礼物',
    giftName: '<b>原图</b>',
    giftCount: 2,
    giftImageUrl: sourceUrl,
  };
  const art = render(gift).children[0].children[1].children[0];
  const image = art.children[0];
  assert.equal(image.src, sourceUrl);
  assert.equal(image.referrerPolicy, 'no-referrer');
  assert.equal(image.hidden, true);
  assert.equal(art.style['background-image'], undefined);
  image.listeners.load();
  assert.equal(image.hidden, false);
  assert.equal(art.style['background-image'], 'none');
  image.listeners.error();
  assert.equal(art.children.length, 0);
  assert.equal(art.style['background-image'], '');
  assert.equal(
    render({ ...gift, giftImageUrl: 'https://evil.test/x' }).children[0].children[1].children[0].children.length,
    0,
  );
});

test('per-style display limits validate before accepting any options', () => {
  for (const [style, limits] of Object.entries(contract.DANMAKU_STYLE_OPTIONS)) {
    for (const fontSize of [limits.minFontSize, 30, limits.maxFontSize]) {
      assert.equal(contract.normalizeStyleOptions({ [style]: { fontSize } })[style].fontSize, fontSize);
    }
    for (const fontSize of [limits.minFontSize - 1, limits.maxFontSize + 1, 30.1, '30', null, true]) {
      assert.throws(() => contract.normalizeStyleOptions({ [style]: { fontSize } }), {
        code: 'INVALID_OVERLAY_OPTIONS',
      });
    }
  }
  for (const value of [
    null,
    [],
    { unknown: {} },
    { signal: [] },
    { signal: { fontFamily: 'url(secret)' } },
    { signal: { fontFamily: '__proto__' } },
    JSON.parse('{"__proto__":{}}'),
    { signal: { streamerId: 1 } },
    { whiteframe: { entranceAnimation: 'rise' }, glow: { entranceAnimation: 'unknown' } },
  ]) {
    assert.throws(() => contract.normalizeStyleOptions(value), { code: 'INVALID_OVERLAY_OPTIONS' });
  }
});

// normalizeStyleOptions only reads the two constants, so this parity check makes the browser copy
// behave exactly like the privileged one; the validation tests below exercise the privileged copy once.
test('browser and privileged display contracts stay identical', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js'), 'utf8');
  const browser = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.deepEqual(browser.DANMAKU_STYLE_OPTIONS, contract.DANMAKU_STYLE_OPTIONS);
  assert.deepEqual(browser.DANMAKU_FONTS, contract.DANMAKU_FONTS);
  assert.deepEqual(browser.RIPPLOID_COLOR_DEFAULTS, contract.RIPPLOID_COLOR_DEFAULTS);
  assert.deepEqual(browser.SPOOKY_THEME_COLORS, contract.SPOOKY_THEME_COLORS);
  assert.deepEqual(browser.SPOOKY_COLOR_KEYS, contract.SPOOKY_COLOR_KEYS);
  assert.deepEqual(browser.SPOOKY_OPACITY_KEYS, contract.SPOOKY_OPACITY_KEYS);
  assert.deepEqual(browser.TWITTER_LAYOUT_DEFAULTS, contract.TWITTER_LAYOUT_DEFAULTS);
  assert.deepEqual(browser.TWITTER_COLOR_DEFAULTS, contract.TWITTER_COLOR_DEFAULTS);
  assert.equal(browser.normalizeStyleOptions.toString(), contract.normalizeStyleOptions.toString());
  assert.equal(browser.styleOptionsFor.toString(), contract.styleOptionsFor.toString());
});

test('local font families round-trip safely and render as a single quoted family', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js'), 'utf8');
  const browser = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const fontFamily of [
    'default',
    'sans',
    'serif',
    'kai',
    '"Cascadia Code"',
    '"本机字体"',
    '"Font \\"Quoted\\""',
    '"Font \\\\ Name"',
  ]) {
    const input = { signal: { fontFamily } };
    assert.deepEqual(contract.normalizeStyleOptions(input), input);
    const document = {
      documentElement: {
        style: {
          setProperty(key, value) {
            this[key] = value;
          },
        },
      },
      body: { dataset: {} },
    };
    browser.applyStyleOptions(document, 'signal', input);
    assert.equal(
      document.documentElement.style['--danmaku-custom-font'],
      Object.hasOwn(contract.DANMAKU_FONTS, fontFamily)
        ? contract.DANMAKU_FONTS[fontFamily] || 'inherit'
        : `${fontFamily}, ${contract.DANMAKU_FONTS.sans}`,
    );
  }
  for (const fontFamily of [
    '""',
    '"   "',
    'Cascadia Code',
    '"Font"; color:red',
    '"Font", serif',
    '"Font\\a"',
    '"Font\nName"',
    '"Font"\n',
    '"' + 'x'.repeat(401) + '"',
  ]) {
    assert.throws(() => contract.normalizeStyleOptions({ signal: { fontFamily } }), {
      code: 'INVALID_OVERLAY_OPTIONS',
    });
  }
});

test('all styles validate text colors and restore their theme defaults', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js'), 'utf8');
  const browser = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const [style, limits] of Object.entries(contract.DANMAKU_STYLE_OPTIONS)) {
    assert.equal(contract.styleOptionsFor(style).textColor, limits.defaultTextColor);
    for (const textColor of ['#AaBbCc80', '#AaBbCc00']) {
      for (const normalize of [contract.normalizeStyleOptions, browser.normalizeStyleOptions]) {
        assert.deepEqual(normalize({ [style]: { textColor } }), { [style]: { textColor: textColor.toLowerCase() } });
      }
    }
    assert.deepEqual(contract.normalizeStyleOptions({ [style]: { textColor: '#AaBbCc' } }), {
      [style]: { textColor: '#aabbcc' },
    });
    const document = {
      documentElement: {
        style: {
          setProperty(key, value) {
            this[key] = value;
          },
        },
      },
      body: { dataset: {} },
    };
    browser.applyStyleOptions(document, style, { [style]: { textColor: '#aabbcc' } });
    assert.equal(document.documentElement.style['--danmaku-text-color'], '#aabbcc');
    assert.equal(document.body.dataset.customTextColor, 'true');
    browser.applyStyleOptions(document, style, {});
    assert.equal(document.documentElement.style['--danmaku-text-color'], limits.defaultTextColor);
    assert.equal(document.body.dataset.customTextColor, 'false');
    for (const textColor of [
      'red',
      '#abc',
      '#aabbccd',
      'transparent',
      'url(x)',
      '#aabbcc\n',
      '#zzzzzz',
      '',
      null,
      123456,
    ]) {
      assert.throws(() => contract.normalizeStyleOptions({ [style]: { textColor } }), {
        code: 'INVALID_OVERLAY_OPTIONS',
      });
    }
  }
});
