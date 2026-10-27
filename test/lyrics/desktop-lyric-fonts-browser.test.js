'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

test('the shared font library loads complete display faces on demand in each rendering surface', { timeout: 45000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><meta charset="utf-8"><div id="sample">清风月光</div>' });
  t.after(() => fixture.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const errors = [];
  const entries = ['/css/styles-base.css', '/css/overlays/base.css', '/css/overlays/danmaku.css',
    '/css/lyrics/desktop-lyric.css', '/css/playback/appearance.css'];
  for (const [index, stylesheet] of entries.entries()) {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    const url = `${fixture.origin}/preview-test-host`;
    assert.equal((await fetch(url)).status, 200);
    await page.goto(url);
    await page.addStyleTag({ url: `${fixture.origin}${stylesheet}` });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(requests.some(url => /\/fonts\//.test(url)), false, `${stylesheet}: unused fonts stay unloaded`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const fonts = await page.evaluate(async () => (await import('/js/shared/font-catalog.js')).SHARED_FONTS);
    for (const font of index === 0 ? fonts : fonts.filter(font => font.id === 'zhimangxing')) {
      const loaded = await page.evaluate(async font => {
        document.getElementById('sample').style.font = `32px ${font.value}`;
        return (await document.fonts.load(`32px ${font.value}`, '清风月光')).length;
      }, font);
      assert.ok(loaded > 0, `${stylesheet}: ${font.id}`);
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#sample' });
      const { fonts: rendered } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      assert.ok(rendered.length > 0 && rendered.every(font => font.isCustomFont), JSON.stringify(rendered));
      if (font.id === 'yozai') {
        await page.evaluate(async font => {
          document.getElementById('sample').style.fontWeight = '500';
          await document.fonts.load(`500 32px ${font.value}`, '清风月光');
        }, font);
        const { fonts: medium } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        assert.ok(medium.some(face => face.isCustomFont && face.postScriptName === 'Yozai-Medium'), JSON.stringify(medium));
        await page.evaluate(() => { document.getElementById('sample').style.fontWeight = '400'; });
      }
    }
    const fontRequests = requests.filter(url => /\/fonts\//.test(url));
    assert.equal(new Set(fontRequests).size, fontRequests.length, 'Shared imports do not duplicate font downloads.');
    assert.ok(requests.every(url => url.startsWith(fixture.origin)), 'Fonts require no external service.');
    await page.close();
  }
  assert.deepEqual(errors, []);
});

test('lyric fonts load locally on demand and fill multilingual gaps at regular and bold weights', { timeout: 30000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/css/lyrics/desktop-lyric.css">
    <style>.sample { font-family: var(--preview-font); font-size: 32px; font-weight: var(--preview-weight); }</style>
    <div id="card"></div>` });
  t.after(() => fixture.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const render = async (fontFamily, fontWeight, samples) => page.evaluate(async ({ fontFamily, fontWeight, samples }) => {
    const { applyDesktopLyricStyles } = await import('/js/lyrics/desktop-lyric-styles.js');
    const { normalizeDesktopLyricSettings } = await import('/js/lyrics/desktop-lyric-settings.js');
    const { DESKTOP_LYRIC_DEFAULTS } = await import('/js/lyrics/desktop-lyric-defaults.js');
    const card = document.getElementById('card');
    applyDesktopLyricStyles(card, normalizeDesktopLyricSettings({ desktopLyricFontFamily: fontFamily,
      desktopLyricFontWeight: fontWeight, desktopLyricFallbackFontFamily: 'Unavailable Legacy Font' }, DESKTOP_LYRIC_DEFAULTS));
    card.replaceChildren(...samples.map(([id, text]) => {
      const line = document.createElement('p');
      line.id = id; line.className = 'sample'; line.dir = 'auto'; line.textContent = text;
      return line;
    }));
    card.getBoundingClientRect();
    await document.fonts.ready;
  }, { fontFamily, fontWeight, samples });
  await render('Lira Maiyuan', '800', [['chinese', '你好世界 Hello']]);
  assert.equal(requests.some(url => url.includes('/fonts/lyrics-fallback/')), false,
    'Chinese lyrics do not download unrelated script fonts.');

  const samples = [
    ['japanese', 'こんにちは世界', /Xiaolai/],
    ['korean', '안녕하세요 사랑해요 썏', /Gowun Dodum/],
    ['latin', 'Tiếng Việt Σ’αγαπώ Я тебя люблю', /Xiaolai|Noto Sans/],
    ['extended', '\u0522\u0523', /Noto Sans/],
    ['armenian', 'Սեր', /Noto Sans Armenian/],
    ['georgian', 'სიყვარული', /Noto Sans Georgian/],
    ['ethiopic', 'ፍቅር', /Noto Sans Ethiopic/],
    ['arabic', 'أُحِبُّكَ عشق محبت', /Noto Sans Arabic/],
    ['hebrew', 'אַהֲבָה', /Noto Sans Hebrew/],
    ['devanagari', 'तुमसे प्यार', /Noto Sans Devanagari/],
    ['bengali', 'ভালোবাসি', /Noto Sans Bengali/],
    ['gurmukhi', 'ਪਿਆਰ', /Noto Sans Gurmukhi/],
    ['gujarati', 'પ્રેમ', /Noto Sans Gujarati/],
    ['odia', 'ପ୍ରେମ', /Noto Sans Oriya/],
    ['tamil', 'காதல்', /Noto Sans Tamil/],
    ['telugu', 'ప్రేమ', /Noto Sans Telugu/],
    ['kannada', 'ಪ್ರೀತಿ', /Noto Sans Kannada/],
    ['malayalam', 'സ്നേഹം', /Noto Sans Malayalam/],
    ['sinhala', 'ආදරය', /Noto Sans Sinhala/],
    ['thai', 'ฉันรักเธอ', /Noto Sans Thai/],
    ['lao', 'ຂ້ອຍຮັກເຈົ້າ', /Noto Sans Lao/],
    ['tibetan', 'བོད་ཡིག', /Noto Serif Tibetan/],
    ['myanmar', 'အချစ်', /Noto Sans Myanmar/],
    ['khmer', 'ស្រឡាញ់', /Noto Sans Khmer/],
  ];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  for (const [primary, weight] of [['Unavailable Primary Font', '400'], ['Unavailable Primary Font', '800'], ['Lira Assorted', '800']]) {
    await render(primary, weight, samples.map(([id, text]) => [id, text]));
    const { root } = await cdp.send('DOM.getDocument');
    for (const [id, , family] of samples) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${id}` });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      // Decorative faces may cover these alphabets; joining scripts always need complete local faces.
      if (primary !== 'Lira Assorted' || !['japanese', 'latin', 'extended', 'armenian', 'georgian', 'ethiopic'].includes(id)) {
        assert.ok(fonts.some(font => font.isCustomFont && (family.test(font.familyName)
          || new RegExp(family.source.replaceAll(' ', '')).test(font.postScriptName))),
          `${id} at ${weight}: ${JSON.stringify(fonts)}`);
      }
      assert.ok(fonts.every(font => font.isCustomFont), `${id} must not depend on installed language fonts.`);
    }
  }
  assert.ok(requests.every(url => url.startsWith(fixture.origin)), 'No external font service is required.');
  assert.deepEqual(errors, []);
});
