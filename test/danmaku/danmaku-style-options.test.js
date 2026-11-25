const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/shared/danmaku-style-options');
const { createFakeDocument } = require('../helpers/fake-dom');

const TWITTER_LAYOUT_KEYS = ['twitterHeader', 'twitterComposer', 'twitterActions'];

function createAppearanceDocument() {
  const document = createFakeDocument();
  document.documentElement = document.createElement('html');
  document.body = document.createElement('body');
  document.head = document.createElement('head');
  return document;
}

test('text sizes preserve saved values and adjust only each style-specific cluster', async () => {
  const { editStyleOption, readAppearanceValue, resetStyleOptions } = await import('../../public/js/shared/danmaku-appearance-draft.js');
  const options = { coffee: { nicknameFontSize: 24, nicknameFontFamily: '"Georgia"', amountColor: '#aabbcc80' },
    twitter: { footerFontSize: 19 } };
  assert.deepEqual(contract.normalizeStyleOptions(options), options);
  for (const invalid of [{ floating: { amountFontSize: 20 } }, { coffee: { nicknameFontSize: 0 } },
    { coffee: { nicknameFontSize: 97 } }, { coffee: { nicknameFontFamily: 'serif; color:red' } },
    { coffee: { nicknameColor: 'red' } }]) {
    assert.throws(() => contract.normalizeStyleOptions(invalid), { code: 'INVALID_OVERLAY_OPTIONS' });
  }
  const draft = { style: 'coffee', styleOptions: options };
  const cleared = editStyleOption(draft, 'nicknameFontSize', readAppearanceValue('nicknameFontSize', '', 8, 96));
  assert.equal(Object.hasOwn(cleared.styleOptions.coffee, 'nicknameFontSize'), false);
  assert.equal(cleared.styleOptions.coffee.nicknameFontFamily, '"Georgia"');
  assert.equal(resetStyleOptions(draft).styleOptions.twitter.footerFontSize, 19);
  const legacy = { style: 'ripploid', styleOptions: { ripploid: { titleFontSize: 24 } } };
  assert.equal(contract.styleOptionsFor('ripploid', legacy.styleOptions).titleSuperchatFontSize, 24);
  const edited = editStyleOption(legacy, 'titleFontSize', 27.5);
  assert.equal(contract.styleOptionsFor('ripploid', edited.styleOptions).titleTicketFontSize, 22);
  assert.equal(contract.styleOptionsFor('ripploid', edited.styleOptions).titleSuperchatFontSize, 24);
  assert.equal(contract.styleOptionsFor('ripploid', edited.styleOptions).titleGuardFontSize, 24);
  assert.equal(contract.styleOptionsFor('ripploid', edited.styleOptions).titleFontSize, 27.5);
  const superchat = editStyleOption(edited, 'titleSuperchatFontSize', 42);
  assert.equal(superchat.styleOptions.ripploid.titleSuperchatOutlineFontSize, 61.89);
  assert.equal(superchat.styleOptions.ripploid.titleFontSize, 27.5);
  assert.equal(superchat.styleOptions.ripploid.titleGuardFontSize, 24);
  const again = editStyleOption(editStyleOption(superchat, 'titleSuperchatFontSize', 42.01), 'titleSuperchatFontSize', 42);
  assert.equal(again.styleOptions.ripploid.titleSuperchatOutlineFontSize, 61.89, 'Repeated edits use the original ratio without rounding drift.');
  const large = editStyleOption(edited, 'titleSuperchatFontSize', 96);
  assert.equal(contract.normalizeStyleOptions(large.styleOptions).ripploid.titleSuperchatOutlineFontSize, 141.47);
  const small = editStyleOption(edited, 'amountFontSize', 8);
  assert.equal(contract.normalizeStyleOptions(small.styleOptions).ripploid.amountCurrencyFontSize, 4.16);
  const clearedGroup = editStyleOption(edited, 'titleFontSize', undefined);
  assert.equal(contract.styleOptionsFor('ripploid', clearedGroup.styleOptions).titleTicketFontSize, 20);
  assert.equal(contract.styleOptionsFor('ripploid', clearedGroup.styleOptions).titleSuperchatFontSize, 24);
  const separateAmounts = editStyleOption({ style: 'transparent', styleOptions: {} }, 'amountFontSize', 34);
  assert.equal(contract.styleOptionsFor('transparent', separateAmounts.styleOptions).amountSuperchatFontSize, 44);
  const reset = resetStyleOptions(edited);
  assert.deepEqual(contract.styleOptionsFor('ripploid', reset.styleOptions), contract.styleOptionsFor('ripploid'));
  assert.equal(readAppearanceValue('captionFontSize', '5.5', 5, 96), 5.5);
  assert.equal(contract.normalizeStyleOptions({ ripploid: { captionFontSize: 5.5, titleSuperchatFontSize: 24.25 } }).ripploid.titleSuperchatFontSize, 24.25);
  assert.throws(() => contract.normalizeStyleOptions({ signal: { titleSuperchatFontSize: 20 } }), { code: 'INVALID_OVERLAY_OPTIONS' });
});

test('style fields validate shared numeric, enum and color rules without accepting unsupported controls', () => {
  const options = { glowy: { glowyLight: 0, glowyLayout: 'horizontal' },
    whiteframe: { bubbleColor: 'default' } };
  assert.deepEqual(contract.normalizeStyleOptions(options), options);
  for (const value of [
    { glowy: { glowyLight: -1 } },
    { glowy: { glowyLight: 101 } },
    { glowy: { glowyLayout: 'diagonal' } },
    { glowy: { composerText: 'belongs to another style' } },
    { ripploid: { giftColor50: '#aabbcc80' } },
  ]) assert.throws(() => contract.normalizeStyleOptions(value), { code: 'INVALID_OVERLAY_OPTIONS' });
});

test('previously saved per-style overrides survive option normalization', () => {
  const saved = {
    spooky: { fontSize: 36, nicknameFontSize: 24, nicknameFontFamily: '"Georgia"', nicknameColor: '#cceeff', frameTitleFontSize: 16 },
    outline: { durationSeconds: 12 },
    'animated-gradient': { gradientPalette: 'ocean', gradientCycleSeconds: 24, gradientUnderline: 'hide' },
    'glass-bubble': { glassBubbleReveal: 'instant', glassBubbleTypingSpeed: 60, glassBubbleSweep: 'off', glassBubbleHighlight: 0 },
    'celestial-horizontal': { celestialNebulaOpacity: 80, celestialStarDensity: 'dense', celestialStarShape: 'star', celestialSeparator: 'hide' },
    glass: { glassTime: 'hide', glassGlintIntensity: 0, glassDensity: 'compact' },
    glowy: { glowyLayout: 'horizontal', glowyAvatar: 'hide', glowyTime: 'hide', glowyLight: 60 },
    'dark-moon': { darkMoonPalette: 'ice', darkMoonRingSize: 140, darkMoonSparks: 'hide' },
    window: { windowGuard: 'hide', windowMedal: 'show' },
    wireframe: { wireframeFadeLength: 0, wireframeOrbit: 'hide', wireframeEntrance: 'none', wireframeEntranceMs: 1400 },
    'sea-breeze': { seaBreezeReflectionOpacity: 0, seaBreezeReflectionLength: 100, seaBreezeReflectionGap: 0 },
    'sea-breeze-random': { seaBreezeReflectionOpacity: 60, seaBreezeReflectionLength: 200, seaBreezeReflectionGap: 30 },
    'horizontal-charm': { charmGap: 44, charmMaxWidth: 680 },
    astral: { astralAccentColor: '#aaddff', astralEntrance: 'none' },
    'neon-glass': { neonGlassNameColors: 'identity', neonGlassHighlight: 70, neonGlassEntranceMs: 700 },
  };
  assert.deepEqual(contract.normalizeStyleOptions(structuredClone(saved)), saved);
});

test('SC is available in fixed layouts and opted-in random or floating styles', () => {
  const { supportsDanmakuSuperchat } = require('../../public/js/shared/danmaku-style-options.js');
  for (const style of ['celestial-horizontal', 'mist', 'comic', 'window', 'sinking', 'stardust', 'sea-breeze-random', 'glass-bubble']) {
    assert.equal(supportsDanmakuSuperchat(style), true, style);
  }
  for (const style of ['outline', 'floating']) {
    assert.equal(supportsDanmakuSuperchat(style), false, style);
  }
});

test('gift amount settings retain cents and enforce their distinct bounds', () => {
  for (const [style, field, minimum, maximum] of [
    ['harbor', 'minGiftAmount', 0, 100000],
    ['stardust', 'stardustGiftThreshold', 0.01, 1000000],
  ]) {
    for (const value of [minimum, 9.99, maximum]) {
      assert.equal(contract.normalizeStyleOptions({ [style]: { [field]: value } })[style][field], value);
    }
    for (const value of [minimum - 0.01, maximum + 0.01, 1.005]) {
      assert.throws(() => contract.normalizeStyleOptions({ [style]: { [field]: value } }), { code: 'INVALID_OVERLAY_OPTIONS' });
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
  const stardust = resetStyleOptions({ ...other, style: 'stardust', fullscreenDurationSeconds: 20,
    styleOptions: { ...other.styleOptions, stardust: { durationSeconds: 3 } } });
  assert.equal(contract.styleOptionsFor('stardust', stardust.styleOptions, 20).durationSeconds, 12);
  assert.equal(contract.styleOptionsFor('cream', stardust.styleOptions, 20).durationSeconds, 9);
});

test('RIPPLOID applies independent event color variables and clears them outside its style', async () => {
  assert.deepEqual(contract.normalizeStyleOptions({ ripploid: { giftColor50: '#AaBbCc' } }), {
    ripploid: { giftColor50: '#aabbcc' },
  });
  const browser = await import('../../public/js/overlays/danmaku-style-application.js');
  const document = createAppearanceDocument();
  const saved = { ripploid: { giftColor50: '#123456', guardColorAdmiral: '#654321', superchatColor2000: '#abcdef' } };
  browser.applyStyleOptions(document, 'ripploid', saved);
  const root = document.documentElement.style;
  assert.equal(root['--ripploid-gift-color50'], '#123456');
  assert.equal(root['--ripploid-guard-color-admiral'], '#654321');
  assert.equal(root['--ripploid-superchat-color2000'], '#abcdef');
  browser.applyStyleOptions(document, 'snowfox', {});
  for (const suffix of ['gift-color50', 'guard-color-admiral', 'superchat-color2000']) {
    assert.equal(root[`--ripploid-${suffix}`], '', `${suffix} is cleared outside RIPPLOID`);
  }
});

test('Twitter layout and event palette apply to existing content and clear outside the style', async () => {
  const browser = await import('../../public/js/overlays/danmaku-style-application.js');
  const document = createAppearanceDocument();
  const options = { twitterHeader: 'hide', twitterComposer: 'hide', twitterActions: 'hide', twitterColor50: '#ABCDEF80' };
  assert.deepEqual(contract.normalizeStyleOptions({ twitter: options }), { twitter: { ...options, twitterColor50: '#abcdef80' } });
  browser.applyStyleOptions(document, 'twitter', { twitter: options });
  for (const key of TWITTER_LAYOUT_KEYS) assert.equal(document.body.dataset[key], 'hide');
  assert.equal(document.documentElement.style['--twitter-event-color-50'], '#abcdef80');
  browser.applyStyleOptions(document, 'signal', {});
  for (const key of TWITTER_LAYOUT_KEYS) assert.equal(document.body.dataset[key], 'show');
  for (const tier of [0, 50, 100, 1000]) assert.equal(document.documentElement.style[`--twitter-event-color-${tier}`], '');
});

test('translucent theme colors keep alpha in legacy paint values and reset to the role palette', async () => {
  const { applyStyleOptions } = await import('../../public/js/overlays/danmaku-style-application.js');
  const document = createAppearanceDocument();
  const root = document.documentElement.style;
  applyStyleOptions(document, 'snowfox', { snowfox: { bubbleColor: '#ff000080' } });
  assert.equal(root['--danmaku-bubble-color-rgb'], '255 0 0');
  assert.equal(Number(root['--danmaku-bubble-color-alpha']), 128 / 255);
  const light = root['--danmaku-bubble-color-snowfox-light-rgb'].split(' ').map(Number);
  assert.equal(light[0], 255);
  assert.ok(Math.abs(light[1] - 238.663) < .001 && light[1] === light[2], 'a translucent tint mixes using premultiplied alpha');
  assert.ok(Math.abs(Number(root['--danmaku-bubble-color-snowfox-light-alpha']) - .9402353) < .000001);
  applyStyleOptions(document, 'snowfox', {});
  assert.equal(root['--danmaku-bubble-color-rgb'], '');
  assert.equal(root['--danmaku-bubble-color-snowfox-light'], '', 'clearing the override restores the per-message role color');
  applyStyleOptions(document, 'glass', { glass: { bubbleColor: '#12345680', backgroundOpacity: 35 } });
  assert.equal(Number(root['--danmaku-bubble-color-alpha']), 128 / 255, 'background opacity must not overwrite the chosen color alpha');
  assert.equal(root['--danmaku-background-opacity'], '0.35');
});

test('Twitter composer text counts visible characters, normalizes Unicode and restores its default when blank', async () => {
  const limit = '👨‍👩‍👧‍👦'.repeat(20);
  assert.equal(contract.normalizeStyleOptions({ twitter: { composerText: limit } }).twitter.composerText, limit);
  for (const composerText of [limit + '字', 'a\nb', null]) {
    assert.throws(() => contract.normalizeStyleOptions({ twitter: { composerText } }), { code: 'INVALID_OVERLAY_OPTIONS' });
  }
  assert.deepEqual(contract.inspectComposerText(' e\u0301 ✨ 👨‍👩‍👧‍👦 '), { text: 'é ✨ 👨‍👩‍👧‍👦', length: 5, error: '' });
  assert.deepEqual(contract.normalizeStyleOptions({ twitter: { composerText: '  中英 Hello!  ' } }), {
    twitter: { composerText: '中英 Hello!' },
  });
  assert.deepEqual(contract.normalizeStyleOptions({ twitter: { composerText: '   ' } }), { twitter: {} });
  assert.equal(contract.styleOptionsFor('twitter', { twitter: { composerText: '' } }).composerText, contract.TWITTER_COMPOSER_TEXT_DEFAULT);
  const browser = await import('../../public/js/overlays/danmaku-style-application.js');
  const node = { textContent: '', children: [] };
  const document = createAppearanceDocument();
  document.getElementById = () => node;
  browser.applyStyleOptions(document, 'twitter', { twitter: { composerText: '<b>你好</b>' } });
  assert.equal(node.textContent, '<b>你好</b>');
  assert.equal(node.children.length, 0);
  browser.applyStyleOptions(document, 'twitter', {});
  assert.equal(node.textContent, contract.TWITTER_COMPOSER_TEXT_DEFAULT);
});

test('spooky follows theme ink, preserves explicit overrides and clears renderer variables outside the style', async () => {
  const browser = await import('../../public/js/overlays/danmaku-style-application.js');
  const document = createAppearanceDocument();
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
  assert.equal(contract.styleOptionsFor('startrail').giftImage, 'gift');
});

test('scroll direction applies to fixed styles and restores each default', async () => {
  const browser = await import('../../public/js/overlays/danmaku-style-application.js');
  const document = createAppearanceDocument();
  for (const style of ['signal', 'glass']) {
    for (const scrollDirection of ['up', 'down']) {
      const options = { [style]: { scrollDirection } };
      browser.applyStyleOptions(document, style, options);
      assert.equal(document.body.dataset.scrollDirection, scrollDirection);
    }
    browser.applyStyleOptions(document, style, {});
    assert.equal(document.body.dataset.scrollDirection, contract.styleOptionsFor(style).scrollDirection);
  }
  for (const style of ['outline', 'floating']) {
    browser.applyStyleOptions(document, 'signal', { signal: { scrollDirection: 'down' } });
    browser.applyStyleOptions(document, style, { signal: { scrollDirection: 'down' } });
    assert.equal(document.body.dataset.scrollDirection, 'up');
  }
});

test('edge fading keeps theme defaults, applies overrides and clears on other layouts', async () => {
  const browser = await import('../../public/js/overlays/danmaku-style-application.js');
  const document = createAppearanceDocument();
  for (const [scrollDirection, edgeFade, expected] of [
    ['up', 'single', 'top'], ['down', 'single', 'bottom'], ['down', 'top', 'top'],
  ]) {
    browser.applyStyleOptions(document, 'signal', { signal: { scrollDirection, edgeFade } });
    assert.equal(document.body.dataset.edgeFade, expected);
  }
  for (const style of ['signal', 'prismatic', 'notebook']) {
    browser.applyStyleOptions(document, style, { [style]: { edgeFade: 'bottom' } });
    browser.applyStyleOptions(document, style, {});
    assert.equal(document.body.dataset.edgeFade, contract.styleOptionsFor(style).edgeFade);
  }
  browser.applyStyleOptions(document, 'outline', {});
  assert.equal(document.body.dataset.edgeFade, 'none');
});

test('entrance animation stays per style and resets on empty options or unsupported styles', async () => {
  assert.equal(contract.styleOptionsFor('whiteframe', { whiteframe: { entranceAnimation: 'rise' } }).entranceDurationMs, 500,
    'saved rise choices retain the legacy duration until explicitly edited');
  assert.equal(contract.styleOptionsFor('whiteframe', { whiteframe: { entranceAnimation: 'rise', entranceDurationMs: 800 } }).entranceDurationMs, 800);
  const browser = await import('../../public/js/overlays/danmaku-style-application.js');
  const document = createAppearanceDocument();
  const saved = contract.normalizeStyleOptions({
    whiteframe: { entranceAnimation: 'rise' },
    glow: { entranceAnimation: 'fade' },
  });
  for (const style of ['whiteframe', 'glow', 'signal']) {
    browser.applyStyleOptions(document, 'whiteframe', saved);
    browser.applyStyleOptions(document, style, saved);
    assert.equal(document.body.dataset.entranceAnimation, saved[style]?.entranceAnimation || 'fade');
    browser.applyStyleOptions(document, style, { [style]: {} });
    assert.equal(document.body.dataset.entranceAnimation, 'fade');
  }
});

test('border color and ambient motion retain per-style drafts and clear on switch or reset', async () => {
  const { applyStyleOptions } = await import('../../public/js/overlays/danmaku-style-application.js');
  const { editStyleOption, resetStyleOptions } = await import('../../public/js/shared/danmaku-appearance-draft.js');
  const document = createAppearanceDocument();
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

test('Christmas background choice preserves saved appearance and restores the normal card on reset', async () => {
  const { editStyleOption, resetStyleOptions } = await import('../../public/js/shared/danmaku-appearance-draft.js');
  const legacy = { style: 'christmas', styleOptions: { christmas: { bubbleColor: '#12345680' }, notebook: { ambientMotion: 'off' } } };
  assert.equal(contract.styleOptionsFor('christmas', legacy.styleOptions).christmasBackground, 'card');
  const edited = editStyleOption(legacy, 'christmasBackground', 'transparent');
  const saved = contract.normalizeStyleOptions(JSON.parse(JSON.stringify(edited.styleOptions)));
  assert.equal(contract.styleOptionsFor('christmas', saved).christmasBackground, 'transparent');
  assert.equal(saved.christmas.bubbleColor, '#12345680');
  const reset = resetStyleOptions({ ...edited, styleOptions: saved });
  assert.equal(contract.styleOptionsFor('christmas', reset.styleOptions).christmasBackground, 'card');
  assert.equal(reset.styleOptions.notebook.ambientMotion, 'off');
});

test('per-style display limits validate before accepting any options', () => {
  for (const [style, limits] of Object.entries(contract.DANMAKU_STYLE_OPTIONS)) {
    for (const fontSize of [limits.minFontSize, limits.maxFontSize]) {
      assert.equal(contract.normalizeStyleOptions({ [style]: { fontSize } })[style].fontSize, fontSize);
    }
    for (const fontSize of [limits.minFontSize - 1, limits.maxFontSize + 1]) {
      assert.throws(() => contract.normalizeStyleOptions({ [style]: { fontSize } }), {
        code: 'INVALID_OVERLAY_OPTIONS',
      });
    }
  }
  // Type and integer checks share one validator; only bounds differ by style.
  for (const fontSize of [30.1, '30', null, NaN]) {
    assert.throws(() => contract.normalizeStyleOptions({ signal: { fontSize } }), { code: 'INVALID_OVERLAY_OPTIONS' });
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
  const browser = await import('../../public/js/overlays/danmaku-style-application.js');
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
    const document = createAppearanceDocument();
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
  const browser = await import('../../public/js/overlays/danmaku-style-application.js');
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
  const document = createAppearanceDocument();
  browser.applyStyleOptions(document, 'signal', { signal: { textColor: '#aabbcc' } });
  assert.equal(document.documentElement.style['--danmaku-text-color'], '#aabbcc');
  browser.applyStyleOptions(document, 'signal', {});
  assert.equal(document.documentElement.style['--danmaku-text-color'], contract.styleOptionsFor('signal').textColor);
});
