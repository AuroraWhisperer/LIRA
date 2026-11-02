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
const TWITTER_COLOR_KEYS = ['twitterColor0', 'twitterColor50', 'twitterColor100', 'twitterColor1000'];
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
  twitter: ['scrollDirection', 'edgeFade', 'giftImage', 'composerText', ...TWITTER_LAYOUT_KEYS, ...TWITTER_COLOR_KEYS],
  'flower-letter': ['scrollDirection', 'edgeFade', 'backgroundOpacity'],
  notebook: ['scrollDirection', 'edgeFade', 'ambientMotion'],
  spooky: ['scrollDirection', 'edgeFade', 'spookyTheme', 'spookyFrame', ...SPOOKY_COLOR_KEYS, ...SPOOKY_OPACITY_KEYS],
  starlight: ['scrollDirection', 'edgeFade', 'decorationShape', 'ambientMotion'],
  moonlit: ['scrollDirection', 'edgeFade', 'backgroundOpacity', 'giftImage'],
  outline: ['durationSeconds', 'centerBias', 'dispersion', 'backgroundOpacity', 'giftImage'],
  whiteframe: ['durationSeconds', 'centerBias', 'dispersion', 'entranceAnimation', 'bubbleColor'],
  mist: ['durationSeconds', 'centerBias', 'dispersion', 'backgroundOpacity'],
  cream: ['durationSeconds', 'centerBias', 'dispersion', 'backgroundOpacity', 'giftImage'],
  floating: ['speedPixelsPerSecond', 'floatingDispersion', 'backgroundOpacity'],
  comet: ['speedPixelsPerSecond', 'floatingDispersion', 'backgroundOpacity'],
  starveil: ['durationSeconds', 'centerBias', 'dispersion', 'backgroundOpacity', 'entranceAnimation'],
  glow: ['durationSeconds', 'centerBias', 'dispersion', 'backgroundOpacity', 'entranceAnimation'],
};
const CONTROL_VALUES = {
  durationSeconds: { valid: [2, 6, 30], invalid: [1, 31, 6.5, '6', null, true], optional: true },
  composerText: {
    valid: ['欢迎来到直播间 ✨', '中文 English #😊', '字'.repeat(20), '👨‍👩‍👧‍👦'.repeat(20)],
    invalid: ['字'.repeat(21), '👨‍👩‍👧‍👦'.repeat(21), 'a\nb', 'a\u0000b', null, 1, true, {}],
    optional: true,
  },
  spookyTheme: { valid: ['default', 'autumn', 'graveyard', 'moonlight'], invalid: ['purple', '', null, true, 1], optional: true },
  spookyFrame: { valid: ['show', 'hide'], invalid: ['', 'SHOW', null, true, 1], optional: true },
  decorationShape: { valid: ['sparkle', 'heart', 'square', 'star', 'flower', 'moon', 'bow'], invalid: ['circle', 'HEART', '', null, true, 1, {}], optional: true },
  ambientMotion: { valid: ['on', 'off'], invalid: ['static', '', null, true, 1], optional: true },
  entranceAnimation: { valid: ['fade', 'rise'], invalid: ['slide', 'RISE', '', null, true, 1, {}], optional: true },
  floatingDispersion: { valid: [1, 50, 100], invalid: [0, 101, 1.5, '50', null, true], optional: true },
  minGiftAmount: { valid: [0, 0.01, 9.99, 100000], invalid: [-1, 100000.01, 1.005, '1', null, true, Infinity, NaN], optional: true },
  bubbleColor: { valid: ['default', '#ba739c', '#ba739c80'], invalid: ['', 'red', '#abc', '#123456\n', null, 1], optional: true },
  edgeFade: { valid: ['both', 'top', 'bottom', 'single', 'none'], invalid: ['left', 'BOTH', '', null, true, 1], optional: true },
  scrollDirection: { valid: ['up', 'down'], invalid: ['left', 'DOWN', '', null, true, 1] },
  backgroundOpacity: { valid: [0, 100], invalid: [-1, 101, 50.5, '50', null] },
  giftImage: { valid: ['theme', 'gift'], invalid: ['https://evil.test/x.webp', '', null] },
  speedPixelsPerSecond: {
    valid: [20, 120, 600],
    invalid: [0, 19, 601, 100.5, '120', null, true],
    optional: true,
  },
  centerBias: { valid: [1, 25, 50], invalid: [0, 51, 1.5, '25', null, true], optional: true },
  dispersion: { valid: [1, 25, 50], invalid: [0, 51, 1.5, '25', null, true], optional: true },
};
for (const key of RIPPLOID_COLOR_KEYS) {
  CONTROL_VALUES[key] = {
    valid: ['#a1b2c3'],
    invalid: ['', 'red', '#abc', '#a1b2c380', '#a1b2c3\n', null, 1, undefined],
    optional: true,
  };
}
for (const key of SPOOKY_COLOR_KEYS) CONTROL_VALUES[key] = {
  valid: ['default', '#a1b2c3', '#a1b2c380'], invalid: ['', 'red', '#abc', '#a1b2c3\n', null, 1, undefined], optional: true,
};
for (const key of SPOOKY_OPACITY_KEYS) CONTROL_VALUES[key] = {
  valid: [0, 50, 100], invalid: [-1, 101, 50.5, '50', null, true], optional: true,
};
for (const key of TWITTER_LAYOUT_KEYS) CONTROL_VALUES[key] = {
  valid: ['show', 'hide'], invalid: ['', 'SHOW', null, true, 1], optional: true,
};
for (const key of TWITTER_COLOR_KEYS) CONTROL_VALUES[key] = {
  valid: ['#a1b2c3', '#a1b2c380'], invalid: ['', 'red', '#abc', '#a1b2c3\n', null, 1, undefined], optional: true,
};

test('each style exposes exactly its own controls and rejects fields outside that set', () => {
  assert.deepEqual(Object.keys(CONTROLS).sort(), Object.keys(contract.DANMAKU_STYLE_OPTIONS).sort());
  for (const [style, controls] of Object.entries(CONTROLS)) {
    assert.deepEqual(Object.keys(contract.styleOptionFields(style)).sort(),
      ['fontFamily', 'fontSize', 'textColor', ...controls].sort(), style);
    const options = Object.fromEntries(controls.map(control => [control, CONTROL_VALUES[control].valid[0]]));
    assert.deepEqual(contract.normalizeStyleOptions({ [style]: options }), { [style]: options }, style);
    const optionalKeys = Object.keys(contract.styleOptionsFor(style)).filter(key => CONTROL_VALUES[key]?.optional);
    assert.deepEqual(optionalKeys.sort(), controls.filter(key => CONTROL_VALUES[key].optional).sort(), style);
    const unsupported = Object.keys(CONTROL_VALUES).find(key => !controls.includes(key));
    assert.throws(() => contract.normalizeStyleOptions({ [style]: { [unsupported]: CONTROL_VALUES[unsupported].valid[0] } }),
      { code: 'INVALID_OVERLAY_OPTIONS' }, `${style} rejects ${unsupported}`);
  }
});

test('shared control validators enforce their complete value boundaries at one supporting style', () => {
  for (const [control, { valid, invalid }] of Object.entries(CONTROL_VALUES)) {
    const style = Object.keys(CONTROLS).find(style => CONTROLS[style].includes(control));
    const normalize = value => contract.normalizeStyleOptions({ [style]: { [control]: value } });
    for (const value of valid) {
      assert.deepEqual(normalize(value), { [style]: { [control]: value } }, `${style} ${control}`);
    }
    for (const value of invalid) {
      assert.throws(() => normalize(value), { code: 'INVALID_OVERLAY_OPTIONS' }, `${style} ${control} ${value}`);
    }
  }
});

test('random lifetimes retain legacy values until edited and reset only the selected style', async () => {
  const { editStyleOption, resetStyleOptions } = await import('../../public/js/shared/danmaku-appearance-draft.js');
  const legacy = { style: 'outline', fullscreenDurationSeconds: 12, styleOptions: { signal: { fontSize: 32 } } };
  assert.equal(contract.styleOptionsFor('outline', legacy.styleOptions, legacy.fullscreenDurationSeconds).durationSeconds, 12);
  const edited = editStyleOption(legacy, 'durationSeconds', 3);
  assert.equal(edited.fullscreenDurationSeconds, 12);
  assert.equal(contract.styleOptionsFor('outline', edited.styleOptions, 12).durationSeconds, 3);
  assert.equal(contract.styleOptionsFor('cream', edited.styleOptions, 12).durationSeconds, 12);
  const other = editStyleOption({ ...edited, style: 'cream' }, 'durationSeconds', 9);
  const reset = resetStyleOptions({ ...other, style: 'outline' });
  assert.equal(contract.styleOptionsFor('outline', reset.styleOptions, 12).durationSeconds, 6);
  assert.equal(contract.styleOptionsFor('cream', reset.styleOptions, 12).durationSeconds, 9);
  assert.deepEqual(reset.styleOptions.signal, { fontSize: 32 });
  assert.deepEqual(legacy.styleOptions, { signal: { fontSize: 32 } });
});

test('RIPPLOID applies independent event color variables and clears them outside its style', async () => {
  assert.deepEqual(contract.normalizeStyleOptions({ ripploid: { giftColor50: '#AaBbCc' } }), {
    ripploid: { giftColor50: '#aabbcc' },
  });
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
  browser.applyStyleOptions(document, 'snowfox', {});
  for (const key of RIPPLOID_COLOR_KEYS) {
    const suffix = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    assert.equal(root[`--ripploid-${suffix}`], '', `${key} is cleared outside RIPPLOID`);
  }
});

test('Twitter layout and event palette apply to existing content and clear outside the style', async () => {
  const browser = await import(pathToFileURL(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js')).href);
  const document = { body: { dataset: {} }, documentElement: { style: { setProperty(key, value) { this[key] = value; } } } };
  const options = { twitterHeader: 'hide', twitterComposer: 'hide', twitterActions: 'hide', twitterColor50: '#ABCDEF80' };
  assert.deepEqual(contract.normalizeStyleOptions({ twitter: options }), { twitter: { ...options, twitterColor50: '#abcdef80' } });
  browser.applyStyleOptions(document, 'twitter', { twitter: options });
  for (const key of TWITTER_LAYOUT_KEYS) assert.equal(document.body.dataset[key], 'hide');
  assert.equal(document.documentElement.style['--twitter-event-color-50'], '#abcdef80');
  browser.applyStyleOptions(document, 'signal', {});
  for (const key of TWITTER_LAYOUT_KEYS) assert.equal(document.body.dataset[key], 'show');
  for (const tier of [0, 50, 100, 1000]) assert.equal(document.documentElement.style[`--twitter-event-color-${tier}`], '');
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
  for (const [theme, { textColor: ink }] of Object.entries(contract.SPOOKY_THEME_COLORS)) {
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
  // The shared direction/edge resolver has three default branches, independent of artwork.
  for (const [style, fallback] of [['signal', 'top'], ['prismatic', 'both'], ['notebook', 'none']]) {
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
      assert.equal(document.body.dataset.edgeFade,
        style === 'signal' ? (scrollDirection === 'down' ? 'bottom' : 'top') : fallback);
    }
  }
  browser.applyStyleOptions(document, 'outline', {});
  assert.equal(document.body.dataset.edgeFade, 'none');
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

test('border color and ambient motion retain per-style drafts and clear on switch or reset', async () => {
  const { applyStyleOptions } = await import('../../public/js/shared/danmaku-style-options.js');
  const { editStyleOption, resetStyleOptions } = await import('../../public/js/shared/danmaku-appearance-draft.js');
  const document = { body: { dataset: {} }, documentElement: { style: { setProperty(key, value) { this[key] = value; } } } };
  const draft = { style: 'whiteframe', styleOptions: contract.normalizeStyleOptions({
    whiteframe: { bubbleColor: '#ABCDEF80' }, notebook: { ambientMotion: 'off' }, starlight: { ambientMotion: 'on' },
  }) };
  applyStyleOptions(document, 'whiteframe', draft.styleOptions);
  assert.equal(document.documentElement.style['--danmaku-bubble-color'], '#abcdef80');
  applyStyleOptions(document, 'notebook', draft.styleOptions);
  assert.equal(document.documentElement.style['--danmaku-bubble-color'], '');
  assert.equal(document.body.dataset.ambientMotion, 'off');
  applyStyleOptions(document, 'starlight', draft.styleOptions);
  assert.equal(document.body.dataset.ambientMotion, 'on');
  const edited = editStyleOption({ ...draft, style: 'starlight' }, 'ambientMotion', 'off');
  const reset = resetStyleOptions(edited);
  assert.deepEqual(reset.styleOptions, { ...draft.styleOptions, starlight: {} });
  applyStyleOptions(document, 'starlight', reset.styleOptions);
  assert.equal(document.body.dataset.ambientMotion, 'on');
  applyStyleOptions(document, 'signal', draft.styleOptions);
  assert.equal(document.body.dataset.ambientMotion, 'on');
  applyStyleOptions(document, 'whiteframe', resetStyleOptions(draft).styleOptions);
  assert.equal(document.documentElement.style['--danmaku-bubble-color'], '');
});

test('gift images load only resolver-approved URLs without a referrer', async () => {
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

test('browser field definitions generate the exact privileged display contract', () => {
  const { styleOptionsNodeSource } = require('../../scripts/sync-danmaku-style-options.cjs');
  const node = fs.readFileSync(path.join(__dirname, '../../src/shared/danmaku-style-options.js'), 'utf8');
  assert.equal(node.replace(/\r\n/g, '\n'), styleOptionsNodeSource());
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

test('text colors are validated, applied and restored to the theme default', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/shared/danmaku-style-options.js'), 'utf8');
  const browser = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const textColor of ['#AaBbCc80', '#AaBbCc00', '#AaBbCc']) {
    assert.deepEqual(contract.normalizeStyleOptions({ signal: { textColor } }), {
      signal: { textColor: textColor.toLowerCase() },
    });
  }
  for (const textColor of [
    'red', '#abc', '#aabbccd', 'transparent', 'url(x)', '#aabbcc\n', '#zzzzzz', '', null, 123456,
  ]) {
    assert.throws(() => contract.normalizeStyleOptions({ signal: { textColor } }), {
      code: 'INVALID_OVERLAY_OPTIONS',
    });
  }
  const document = { documentElement: { style: { setProperty(key, value) { this[key] = value; } } }, body: { dataset: {} } };
  browser.applyStyleOptions(document, 'signal', { signal: { textColor: '#aabbcc' } });
  assert.equal(document.documentElement.style['--danmaku-text-color'], '#aabbcc');
  browser.applyStyleOptions(document, 'signal', {});
  assert.equal(document.documentElement.style['--danmaku-text-color'], contract.styleOptionsFor('signal').textColor);
});
