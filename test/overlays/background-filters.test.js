const test = require('node:test');
const assert = require('node:assert/strict');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const openBrowserSession = useSharedBrowser();

test('background filters change opaque pixels, preserve alpha, and release a single reusable filter', { timeout: 30000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><style>html,body{margin:0;background:transparent}img{width:320px;height:180px}</style><img id="art">' });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  assert.equal((await fetch(`${fixture.origin}/preview-test-host`)).status, 200);
  await page.setContent(`<style>body{margin:0}</style><iframe sandbox="allow-scripts" src="${fixture.origin}/preview-test-host" style="width:320px;height:180px;border:0"></iframe>`);
  const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
  await frame.locator('#art').waitFor({ state: 'attached' });
  await frame.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(150, 80, 20, 20);
    ctx.fillStyle = '#d2e6fa'; ctx.fillRect(200, 40, 40, 40);
    ctx.clearRect(0, 0, 20, 20);
    ctx.clearRect(300, 0, 20, 20); ctx.fillStyle = 'rgba(128,128,128,.5)'; ctx.fillRect(300, 0, 20, 20);
    for (let x = 25; x < 70; x += 4) { ctx.fillStyle = x % 8 === 1 ? 'white' : 'black'; ctx.fillRect(x, 70, 4, 40); }
    const art = document.getElementById('art'); art.src = canvas.toDataURL(); await art.decode();
    const { createBackgroundFilters } = await import('/js/overlays/background-filters.js');
    window.effects = createBackgroundFilters(document);
    window.setEffects = config => { art.style.filter = effects.build(config) || 'none'; };
  });
  const pixels = async (points = [[100, 90], [176, 90], [160, 90], [3, 3], [310, 10], [27, 90], [280, 160], [220, 60]]) => {
    const screenshot = (await page.screenshot({ omitBackground: true })).toString('base64');
    return frame.evaluate(async ({ screenshot, points }) => {
      const image = new Image(); image.src = `data:image/png;base64,${screenshot}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    }, { screenshot, points });
  };
  const apply = config => frame.evaluate(value => setEffects(value), config);
  const baseline = await pixels();
  await apply({ temperature: 80, preserveLuminance: false });
  const warm = await pixels();
  assert.ok(warm[0][0] > baseline[0][0] + 15 && warm[0][2] < baseline[0][2] - 15);
  await apply({ temperature: -80, preserveLuminance: false });
  const cool = await pixels();
  assert.ok(cool[0][2] > baseline[0][2] + 15 && cool[0][0] < baseline[0][0] - 15);
  await apply({ tint: 80, preserveLuminance: false });
  const magenta = await pixels();
  assert.ok(magenta[0][1] < baseline[0][1] - 15 && magenta[0][0] > baseline[0][0]);
  await apply({ temperature: 80, preserveLuminance: true });
  const balanced = await pixels();
  const luminance = pixel => pixel[0] * .2126 + pixel[1] * .7152 + pixel[2] * .0722;
  assert.ok(Math.abs(luminance(balanced[0]) - luminance(baseline[0])) < 2);
  for (const tone of ['shadow', 'midtone', 'highlight']) {
    await apply({ [`${tone}Color`]: '#ff0000', [`${tone}Strength`]: 1 });
    const colored = await pixels();
    assert.ok(colored[0][0] > colored[0][1] + 20, tone);
  }
  // Reference vectors from the pinned v1 white-point/LMS shader sequence,
  // applied to linearized #808080 and encoded back to sRGB.
  for (const [config, expected] of [
    [{ temperature: 40 }, [139.090, 127.270, 106.871]], [{ temperature: -40 }, [102.122, 131.930, 173.128]],
    [{ tint: 40 }, [139.174, 123.225, 143.144]], [{ tint: -40 }, [111.242, 134.385, 113.356]],
  ]) {
    await apply({ ...config, colorProcessing: 'standard' });
    const adjusted = await pixels();
    assert.ok(expected.every((value, channel) => Math.abs(adjusted[0][channel] - value) <= 2), `${JSON.stringify(config)}: ${adjusted[0]}`);
    assert.deepEqual(adjusted.map(pixel => pixel[3]), baseline.map(pixel => pixel[3]));
  }
  // Linear RGB reference: lift raises black while preserving white; gamma keeps
  // both endpoints; gain scales white too. These differ from luminance-mask tint.
  const decode = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  const encode = value => 255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055);
  for (const [config, channel, expected, white] of [
    [{ liftRed: .1 }, 0, encode(.1 + .9 * decode(128 / 255)), 255],
    [{ gammaBlue: 2 }, 2, encode(Math.sqrt(decode(128 / 255))), 255],
    [{ gainGreen: .5 }, 1, encode(.5 * decode(128 / 255)), encode(.5)],
  ]) {
    await apply({ ...config, colorProcessing: 'standard' });
    const adjusted = await pixels();
    assert.ok(Math.abs(adjusted[0][channel] - expected) <= 2, `${JSON.stringify(config)}: ${adjusted[0]}`);
    assert.ok(Math.abs(adjusted[2][channel] - white) <= 2);
    assert.deepEqual(adjusted.map(pixel => pixel[3]), baseline.map(pixel => pixel[3]));
  }
  await apply({ colorProcessing: 'standard', shadowColor: '#ff0000', shadowStrength: 1 });
  assert.deepEqual(await pixels(), baseline, 'standard mode does not apply the retired tint controls');
  await apply({ colorProcessing: 'legacy', liftRed: .5 });
  assert.deepEqual(await pixels(), baseline, 'legacy mode does not reinterpret LGG coefficients');
  await apply({ gamma: 2, levelsChannel: 'r' });
  const levels = await pixels();
  assert.ok(levels[0][0] > baseline[0][0] + 25);
  assert.equal(levels[0][1], baseline[0][1]);
  for (const glowMode of ['normal', 'streak', 'star']) {
    await apply({ glowMode, glowStrength: 2, glowRadius: 30, glowThreshold: .7, glowSoftness: .1 });
    const glow = await pixels();
    assert.ok(glow[1][0] > baseline[1][0] + 5, `${glowMode}: bloom lights opaque pixels beside a highlight: ${glow[1]}`);
    assert.deepEqual(glow.map(pixel => pixel[3]), baseline.map(pixel => pixel[3]), 'bloom preserves source alpha');
  }
  await apply({ vignetteOpacity: 1, vignetteRange: .2, vignetteSoftness: .4 });
  const vignette = await pixels();
  assert.ok(vignette[6][0] < baseline[6][0] - 40);
  assert.deepEqual(vignette[2], baseline[2]);
  await apply({ irisBlur: 20, irisRange: .15, irisSoftness: .2 });
  const blurred = await pixels();
  assert.ok(blurred[5][0] < baseline[5][0] - 30, `outer stripes blur: ${blurred[5]}`);
  assert.deepEqual(blurred[2], baseline[2], 'center stays sharp');
  await apply({ grainStrength: 1, grainSize: 2.5 });
  const grain = await pixels();
  assert.notDeepEqual(grain[0], baseline[0]);
  assert.deepEqual(grain.map(pixel => pixel[3]), baseline.map(pixel => pixel[3]));
  await apply({ glowStrength: .12, glowRadius: 12, glowThreshold: .9, glowSoftness: .1 });
  const softBlue = (await pixels())[7];
  assert.ok(softBlue[2] > softBlue[1] && softBlue[1] > softBlue[0], 'the starter preset keeps silver-blue highlights blue');
  assert.ok(softBlue.slice(0, 3).every((value, channel) => Math.abs(value - baseline[7][channel]) <= 3));
  for (let i = 0; i < 10; i++) await apply({ glowStrength: i / 10, vignetteOpacity: .3, irisBlur: 4 });
  assert.equal(await frame.locator('[data-background-filters] filter').count(), 1);
  assert.equal(await frame.locator('#art').count(), 1);
  await apply({});
  assert.deepEqual(await pixels(), baseline);
  assert.equal(await frame.locator('[data-background-filters]').count(), 0);
  await frame.evaluate(() => effects.dispose());
  assert.deepEqual(errors, []);
});
