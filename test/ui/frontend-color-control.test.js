'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

let fixture;
let browser;
test.before(async () => {
  fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><html data-client-theme="light"><head>
    <link rel="stylesheet" href="/css/styles-base.css">
    <link rel="stylesheet" href="/css/styles-admin.css">
    <link rel="stylesheet" href="/css/desktop/palettes.css">
    </head><body style="display:block;padding:24px"><main id="host"></main></body></html>` });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

async function pageFor(t, html) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async html => {
    document.getElementById('host').innerHTML = html;
    const { enhanceColorControls } = await import('/js/shared/color-control.js');
    window.enhanceColors = enhanceColorControls;
    window.originalColor = document.querySelector('input[type="color"]');
    window.colorEvents = [];
    for (const name of ['input', 'change']) document.addEventListener(name, event => {
      window.colorEvents.push({ type: event.type, value: event.target.value });
    });
    enhanceColorControls();
  }, html);
  return page;
}

test('color controls retain native values, form submission, labels, events and full-row hit targets', async t => {
  const page = await pageFor(t, '<form><label for="color">文字颜色</label><input id="color" type="color" name="textColor" value="#eaf2ff"></form>');
  const input = page.locator('#color');
  assert.equal(await page.evaluate(() => document.getElementById('color') === window.originalColor), true);
  assert.equal(await page.locator('.lira-color-hex-value').textContent(), '#EAF2FF');
  assert.equal(await page.getByLabel('文字颜色', { exact: true }).count(), 1);
  await page.evaluate(() => { window.enhanceColors(); window.enhanceColors(); });
  assert.equal(await page.locator('.lira-color-control').count(), 1);
  const hits = await input.evaluate(input => {
    const r = input.getBoundingClientRect();
    return [r.left + 15, r.left + 64, r.right - 8].map(x => document.elementFromPoint(x, r.y + r.height / 2) === input);
  });
  assert.deepEqual(hits, [true, true, true]);
  await input.fill('#abcdef');
  assert.equal(await page.locator('.lira-color-hex-value').textContent(), '#ABCDEF');
  assert.deepEqual(await page.evaluate(() => window.colorEvents), [
    { type: 'input', value: '#abcdef' }, { type: 'change', value: '#abcdef' },
  ]);
  assert.equal(await page.evaluate(() => new FormData(document.querySelector('form')).get('textColor')), '#abcdef');
  await input.focus();
  assert.equal(await input.evaluate(input => getComputedStyle(input).outlineStyle), 'solid');
  await input.evaluate(input => { input.disabled = true; });
  assert.equal(await input.isEnabled(), false);
  assert.equal(await input.evaluate(input => getComputedStyle(input).cursor), 'not-allowed');
});

test('programmatic updates, reset, dynamic controls and cloned panels stay synchronized without duplicate events', async t => {
  const page = await pageFor(t, '<form><label>颜色<input type="color" value="#112233"></label></form>');
  await page.evaluate(() => { window.originalColor.value = '#aabbcc'; });
  assert.equal(await page.locator('.lira-color-hex-value').textContent(), '#AABBCC');
  assert.deepEqual(await page.evaluate(() => window.colorEvents), []);
  await page.evaluate(() => document.querySelector('form').reset());
  await page.waitForFunction(() => document.querySelector('.lira-color-hex-value').textContent === '#112233');
  await page.evaluate(() => {
    const copy = document.querySelector('form').cloneNode(true);
    copy.id = 'copy';
    document.getElementById('host').append(copy);
    const dynamic = document.createElement('input');
    dynamic.type = 'color';
    dynamic.id = 'dynamic';
    document.getElementById('host').append(dynamic);
  });
  await page.waitForFunction(() => document.querySelectorAll('.lira-color-control').length === 3);
  await page.evaluate(() => {
    window.enhanceColors();
    document.getElementById('dynamic').setAttribute('value', '#fedcba');
    document.querySelector('#copy input').value = '#13579b';
  });
  await page.waitForFunction(() => document.querySelector('#dynamic + .lira-color-value .lira-color-hex-value').textContent === '#FEDCBA');
  assert.equal(await page.locator('#copy .lira-color-hex-value').textContent(), '#13579B');
  assert.equal(await page.locator('.lira-color-control .lira-color-control').count(), 0);
  assert.equal(await page.locator('.lira-color-value').count(), 3);
  await page.locator('#copy input').fill('#654321');
  assert.deepEqual(await page.evaluate(() => window.colorEvents), [
    { type: 'input', value: '#654321' }, { type: 'change', value: '#654321' },
  ]);
  assert.equal(await page.locator('form:not(#copy) .lira-color-hex-value').textContent(), '#112233');
});

test('compact rows align with neighboring inputs and narrow color groups keep their values inside the controls', async t => {
  const page = await pageFor(t, `
    <div class="song-workspace identity-rule-settings" style="width:340px"><label class="identity-rule-setting">
      <span>规则 1</span><input id="rule" value="规则"><input id="ruleColor" type="color">
    </label><label class="identity-rule-setting"><span>规则 2</span><input value="另一条规则"><input type="color"></label></div>
    <div class="clock-color-fields" style="width:340px"><label class="clock-form-field">颜色<input id="clockColor" type="color"></label>
      <label class="clock-form-field">间隔<input id="clockNumber" type="number"></label></div>
    <div class="swatch-row" style="width:300px">${['主色', '强调色', '文字', '背景'].map(label => `<label>${label}<input type="color"></label>`).join('')}</div>
    <div class="gift-wish-colors" style="width:300px">${['今天未收到', '今天已收到'].map(label => `<div class="gift-wish-field"><label>${label}</label><input type="color"></div>`).join('')}</div>`);
  const height = selector => page.locator(selector).evaluate(input => input.getBoundingClientRect().height);
  assert.equal(await height('#ruleColor'), await height('#rule'));
  assert.equal(await height('#clockColor'), await height('#clockNumber'));
  assert.equal(await page.locator('.identity-rule-settings').evaluate(group => group.scrollWidth <= group.clientWidth), true);
  assert.equal(await page.locator('.lira-color-control').evaluateAll(controls => controls.every(control => {
    const input = control.querySelector('input').getBoundingClientRect();
    const value = control.querySelector('.lira-color-value').getBoundingClientRect();
    return value.right <= input.right - 5 && value.top >= input.top && value.bottom <= input.bottom;
  })), true);
});

test('RGBA editing preserves alpha through RGB changes, form submission, cloning and reset', async t => {
  const page = await pageFor(t, '<form><label for="color">文字颜色</label><input id="color" type="color" name="textColor" value="#55555580"></form>');
  const input = page.locator('#color');
  assert.equal(await input.evaluate(input => input.value), '#55555580');
  assert.equal(await page.locator('.lira-color-alpha-value').textContent(), '50%');
  await input.click();
  const picker = page.getByRole('dialog', { name: '颜色与不透明度' });
  await picker.getByLabel('不透明度（%）', { exact: true }).fill('35');
  await picker.getByLabel('红色 R', { exact: true }).fill('170');
  assert.equal(await input.evaluate(input => input.value), '#aa555559');
  assert.equal(await page.evaluate(() => new FormData(document.querySelector('form')).get('textColor')), '#aa555559');
  await picker.getByRole('button', { name: '完成' }).click();
  await page.evaluate(() => { const copy = document.querySelector('form').cloneNode(true); copy.id = 'copy'; copy.querySelector('input').id = 'copyColor'; document.body.append(copy); });
  await page.waitForFunction(() => document.querySelector('#copy .lira-color-alpha-value')?.textContent === '35%');
  assert.equal(await page.locator('#copy input').evaluate(input => input.value), '#aa555559');
  await input.click();
  await picker.getByLabel('不透明度（%）', { exact: true }).fill('0');
  assert.equal(await input.evaluate(input => input.value), '#aa555500');
  await picker.getByLabel('不透明度（%）', { exact: true }).fill('100');
  assert.equal(await input.evaluate(input => input.value), '#aa5555');
  await page.evaluate(() => document.querySelector('form').reset());
  await page.waitForFunction(() => document.getElementById('color').value === '#55555580');
  assert.equal(await picker.isVisible(), false);
});

test('existing opacity is edited through its original field without adding a second alpha or crossing cloned panels', async t => {
  const page = await pageFor(t, '<form><label>背景<input id="background" type="color" value="#123456" data-color-opacity="opacity"></label><label>背景不透明度<input id="opacity" type="number" value="0.35" min="0" max="1" step="0.01"></label></form>');
  assert.equal(await page.locator('.lira-color-alpha-value').textContent(), '35%');
  assert.equal(await page.locator('#opacity').isVisible(), false);
  await page.evaluate(() => { document.getElementById('opacity').value = '0.48'; });
  assert.equal(await page.locator('.lira-color-alpha-value').textContent(), '48%');
  await page.locator('#background').click();
  const picker = page.getByRole('dialog', { name: '颜色与不透明度' });
  await picker.getByLabel('不透明度（%）', { exact: true }).fill('0');
  assert.equal(await page.locator('#opacity').inputValue(), '0');
  assert.equal(await page.locator('#background').inputValue(), '#123456');
  assert.deepEqual(await page.evaluate(() => window.colorEvents), [{ type: 'input', value: '0' }]);
  await picker.getByRole('button', { name: '完成' }).click();
  await page.evaluate(async () => {
    const { cloneComponentPanel } = await import('/js/admin/component-preview-panel.js');
    const source = new DOMParser().parseFromString(document.querySelector('form').outerHTML, 'text/html');
    const copy = cloneComponentPanel(source.querySelector('form'), 'preview'); document.body.append(copy);
  });
  await page.locator('#preview-background').click();
  await picker.getByLabel('不透明度（%）', { exact: true }).fill('75');
  assert.equal(await page.locator('#preview-opacity').inputValue(), '0.75');
  assert.equal(await page.locator('#opacity').inputValue(), '0');
  await picker.press('Escape');
  await page.evaluate(() => document.querySelector('form').reset());
  await page.waitForFunction(() => document.querySelector('form .lira-color-alpha-value').textContent === '35%');
});

test('generated component parameters restore defaults and update the owning draft immediately', async t => {
  const page = await pageFor(t, '');
  await page.evaluate(async () => {
    const { createSceneExtraPreview } = await import('/js/admin/scene-extra-preview.js');
    const { createSceneExtraDefaults } = await import('/js/shared/scene-extra-components.js');
    window.draft = { ...createSceneExtraDefaults('songlist'), songBoardSyncTheme: 'false', songBoardThemeOpacity: '0.35', songBoardThemeText: '#11223380' };
    const listeners = new Set();
    const controller = {
      getState: () => ({ draft: window.draft, loaded: true }),
      subscribe(listener) { listeners.add(listener); listener(this.getState()); return () => listeners.delete(listener); },
      edit(patch) { Object.assign(window.draft, patch); listeners.forEach(listener => listener(this.getState())); },
    };
    createSceneExtraPreview('songlist', { controller }).createPanel(document.getElementById('host'));
  });
  assert.equal(await page.locator('[data-component-parameter="songBoardThemeText"]').evaluate(input => input.value), '#11223380');
  const background = page.locator('[data-component-parameter="songBoardThemeBackground"]');
  assert.equal(await background.evaluate(input => input.parentElement.querySelector('.lira-color-alpha-value').textContent), '35%');
  await background.click();
  const alpha = page.getByRole('dialog').getByLabel('不透明度（%）', { exact: true });
  await alpha.fill('0');
  assert.equal(await page.evaluate(() => window.draft.songBoardThemeOpacity), '0');
  assert.equal(await background.evaluate(input => input.value), '#181823');
});
