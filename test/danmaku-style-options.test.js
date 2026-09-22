const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../src/shared/danmaku-style-options');

test('gift images keep theme artwork while loading and restore it on failure', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/overlays/danmaku-message-renderer.js'), 'utf8');
  const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  const document = {
    createElement() {
      return {
        children: [],
        dataset: {},
        events: {},
        textContent: '',
        style: {
          setProperty(key, value) {
            this[key] = value;
          },
        },
        append(...nodes) {
          for (const child of nodes) {
            child.parent = this;
            this.children.push(child);
          }
        },
        remove() {
          this.parent.children = this.parent.children.filter((child) => child !== this);
        },
        setAttribute() {},
        addEventListener(name, callback) {
          this.events[name] = callback;
        },
      };
    },
  };
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
  image.events.load();
  assert.equal(image.hidden, false);
  assert.equal(art.style['background-image'], 'none');
  image.events.error();
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
    { signal: { backgroundOpacity: 101 } },
    { signal: { backgroundOpacity: -1 } },
    { minimal: { backgroundOpacity: 50 } },
    { transparent: { backgroundOpacity: 50 } },
    { minimal: { giftImage: 'gift' } },
    { signal: { giftImage: 'https://evil.test/x.webp' } },
    JSON.parse('{"__proto__":{}}'),
    { signal: { streamerId: 1 } },
  ]) {
    assert.throws(() => contract.normalizeStyleOptions(value), { code: 'INVALID_OVERLAY_OPTIONS' });
  }
  assert.deepEqual(contract.normalizeStyleOptions({ signal: { backgroundOpacity: 0, giftImage: 'gift' } }), {
    signal: { backgroundOpacity: 0, giftImage: 'gift' },
  });
});

test('browser and privileged display contracts stay identical', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/shared/danmaku-style-options.js'), 'utf8');
  const browser = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.deepEqual(browser.DANMAKU_STYLE_OPTIONS, contract.DANMAKU_STYLE_OPTIONS);
  assert.deepEqual(browser.DANMAKU_FONTS, contract.DANMAKU_FONTS);
  assert.equal(browser.normalizeStyleOptions.toString(), contract.normalizeStyleOptions.toString());
  assert.equal(browser.styleOptionsFor.toString(), contract.styleOptionsFor.toString());
});

test('local font families round-trip safely and render as a single quoted family', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/shared/danmaku-style-options.js'), 'utf8');
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
    assert.deepEqual(browser.normalizeStyleOptions(input), input);
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
    for (const normalize of [contract.normalizeStyleOptions, browser.normalizeStyleOptions]) {
      assert.throws(() => normalize({ signal: { fontFamily } }), { code: 'INVALID_OVERLAY_OPTIONS' });
    }
  }
});

test('all styles validate text colors and restore their theme defaults', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/shared/danmaku-style-options.js'), 'utf8');
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
      for (const normalize of [contract.normalizeStyleOptions, browser.normalizeStyleOptions]) {
        assert.throws(() => normalize({ [style]: { textColor } }), { code: 'INVALID_OVERLAY_OPTIONS' });
      }
    }
  }
});
