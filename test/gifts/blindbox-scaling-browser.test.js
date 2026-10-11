'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { sceneExtraPreviewData } = require('../../public/js/admin/scene-extra-preview-data.js');

const openBrowserSession = useSharedBrowser();

test('blindbox canvas resizing scales text and medals with the panel', { timeout: 15000 }, async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><iframe sandbox="allow-scripts" style="width:720px;height:640px;border:0"></iframe>' });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  const url = `${fixture.origin}/blindbox?componentPreview=1&sceneComponent=1`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(`${fixture.origin}/preview-test-host`)).status, 200);
  await page.goto(`${fixture.origin}/preview-test-host`);
  await page.evaluate(({ url, config, data }) => {
    window.onmessage = event => {
      const frame = document.querySelector('iframe');
      if (event.data?.type === 'component-preview:ready') {
        frame.contentWindow.postMessage({ type: 'component-preview:init', config }, '*');
      }
      if (event.data?.type === 'component-preview:prepared') {
        frame.contentWindow.postMessage({ type: 'component-preview:data', data }, '*');
      }
    };
    document.querySelector('iframe').src = url;
  }, { url, config: { ...createSceneExtraDefaults('blindbox'), heartBoxOnly: true,
    blindboxCastleMultiplier: '2', blindboxShowOpenedSinceCastle: true }, data: sceneExtraPreviewData('blindbox') });
  const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
  await frame.locator('.user-name').first().waitFor();
  const measure = () => frame.evaluate(() => Object.fromEntries([
    '.blindbox-panel', '.overlay-title', '.blindbox-summary-meta', '.blindbox-total .stat-value',
    '.user-name', '.box-count', '.profit-value', '.rank-badge', '.blindbox-heart-progress strong',
  ].map(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return [selector, { width: rect.width, height: rect.height }];
  })));
  const initial = await measure();
  for (const scale of [0.5, 1.5, 1]) {
    await page.locator('iframe').evaluate((node, scale) => {
      node.style.width = `${720 * scale}px`;
      node.style.height = `${640 * scale}px`;
    }, scale);
    await frame.waitForFunction(width => window.innerWidth === width, 720 * scale);
    // Resize handlers and the following layout finish before measuring rendered glyph boxes.
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const resized = await measure();
    for (const [selector, original] of Object.entries(initial)) {
      for (const dimension of ['width', 'height']) {
        assert.ok(Math.abs(resized[selector][dimension] - original[dimension] * scale) < 1,
          `${selector} ${dimension} scales by ${scale}`);
      }
    }
  }
});
