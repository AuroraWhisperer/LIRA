const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const contract = require('../../src/shared/danmaku-style-options');
const { createFakeDocument } = require('../helpers/fake-dom');

// Expected per-style controls. Font family, size and text color apply to every style.
const CONTROLS = {
  bubble: ['scrollDirection', 'backgroundOpacity', 'giftImage'],
  signal: ['scrollDirection', 'backgroundOpacity', 'giftImage'],
  minimal: ['scrollDirection'],
  ranked: ['scrollDirection', 'backgroundOpacity', 'giftImage'],
  transparent: ['scrollDirection', 'giftImage'],
  identity: ['scrollDirection', 'backgroundOpacity', 'giftImage'],
  sketch: ['scrollDirection', 'backgroundOpacity'],
  starlight: ['scrollDirection'],
  moonlit: ['scrollDirection', 'backgroundOpacity', 'giftImage'],
  outline: ['centerBias', 'dispersion', 'backgroundOpacity', 'giftImage'],
  whiteframe: ['centerBias', 'dispersion'],
  cream: ['centerBias', 'dispersion', 'backgroundOpacity', 'giftImage'],
  floating: ['speedPixelsPerSecond', 'backgroundOpacity'],
  comet: ['speedPixelsPerSecond', 'backgroundOpacity'],
  starveil: ['centerBias', 'dispersion', 'backgroundOpacity'],
  glow: ['centerBias', 'dispersion', 'backgroundOpacity'],
};
const CONTROL_VALUES = {
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
      '#aabbccdd',
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
