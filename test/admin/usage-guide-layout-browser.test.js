'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { readCssBundle } = require('../helpers/css-bundle');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

async function setup(t, reducedMotion = 'no-preference') {
  const browser = openBrowserSession();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion });
  page.setDefaultTimeout(5000);
  await page.route('**/*', (route) => route.abort());
  await page.setContent(`<div class="other-page"><div class="other-workspace">
    <aside class="other-feature-sidebar">功能导航</aside><div class="other-feature-content">
    ${readAdminFragmentHtml('pages/admin/toolbox/usage-guide.html')}
    </div></div></div>`);
  await page.addStyleTag({ content: readCssBundle('public', 'css', 'styles-base.css') });
  await page.addStyleTag({ content: readCssBundle('public', 'css', 'admin', 'toolbox.css') });
  await page.locator('#otherUsageGuideFeature').evaluate((panel) => {
    panel.hidden = false;
    panel.classList.add('active');
  });
  await page.addScriptTag({ content: readJsModuleBundle('public', 'js', 'admin', 'usage-guide.js') });
  await page.evaluate(() => {
    const transition = initUsageGuide();
    window.toggleGuideSidebar = () => transition(() => {
      document.querySelector('.other-page').classList.toggle('sidebar-collapsed');
    });
  });
  return page;
}

async function readParagraph(page) {
  await page.locator('a[data-usage-guide-link][href="#ug-scene-guide"]').click();
  await page.waitForFunction(() => !document.querySelector('#otherUsageGuideFeature')
    .classList.contains('usage-guide-render-all'));
  await page.evaluate(async () => {
    const panel = document.querySelector('#otherUsageGuideFeature');
    const scroller = panel.querySelector('.other-feature-panel-body');
    const target = document.querySelector('#ug-scene-guide > p');
    const offset = parseFloat(panel.style.getPropertyValue('--usage-guide-scroll-offset'));
    scroller.scrollBy({ top: target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset + 6 });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const position = await paragraphPosition(page);
  assert.ok(position >= 0 && position <= 1, `target paragraph is at the reading marker: ${position}`);
}

async function paragraphPosition(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('#otherUsageGuideFeature');
    const scroller = panel.querySelector('.other-feature-panel-body');
    const rect = document.querySelector('#ug-scene-guide > p').getBoundingClientRect();
    const marker = scroller.getBoundingClientRect().top
      + parseFloat(panel.style.getPropertyValue('--usage-guide-scroll-offset')) + 1;
    return (marker - rect.top) / rect.height;
  });
}

for (const mode of ['no-preference', 'reduce']) {
  test(`sidebar layout keeps the reading paragraph and top directory state (${mode})`, async (t) => {
    const page = await setup(t, mode);
    for (let i = 0; i < 2; i += 1) await page.evaluate(() => window.toggleGuideSidebar());
    assert.equal(await page.locator('.usage-guide-panel').evaluate((node) => node.scrollTop), 0);
    assert.equal(await page.locator('.usage-guide-toc-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.usage-guide-toc-links').evaluate((node) => node.inert), false);
    assert.equal(await page.locator('#otherUsageGuideFeature').evaluate((node) =>
      node.getAnimations().some((animation) => animation.animationName === 'other-feature-panel-enter'
        && animation.playState === 'running')), false, 'the panel must not replay its entrance after a layout switch');

    await readParagraph(page);
    const before = await paragraphPosition(page);
    for (let i = 0; i < 2; i += 1) {
      await page.evaluate(() => window.toggleGuideSidebar());
      assert.ok(Math.abs(await paragraphPosition(page) - before) < 0.03, 'same paragraph stays at the reading marker');
    }
    assert.equal(await page.locator('.usage-guide-toc-toggle').getAttribute('aria-expanded'), 'false');
    await page.locator('.usage-guide-toc').hover();
    await page.waitForFunction(() => document.querySelector('.usage-guide-toc-toggle').getAttribute('aria-expanded') === 'true');
    await page.locator('.other-feature-sidebar').hover();
    await page.waitForFunction(() => document.querySelector('.usage-guide-toc-toggle').getAttribute('aria-expanded') === 'false');
  });
}

test('rapid sidebar reversals finish every update without leaving a transition running', async (t) => {
  const page = await setup(t);
  const state = await page.evaluate(async () => {
    await Promise.all([window.toggleGuideSidebar(), window.toggleGuideSidebar(), window.toggleGuideSidebar()]);
    const workspace = document.querySelector('.other-workspace');
    const first = window.toggleGuideSidebar();
    await Promise.resolve();
    await workspace.activeViewTransition?.ready;
    await Promise.all([first, window.toggleGuideSidebar(), window.toggleGuideSidebar()]);
    return {
      collapsed: document.querySelector('.other-page').classList.contains('sidebar-collapsed'),
      switching: workspace.classList.contains('usage-guide-switching'),
      active: Boolean(workspace.activeViewTransition),
    };
  });
  assert.deepEqual(state, { collapsed: false, switching: false, active: false });
});

test('the guide preserves reading position when scoped view transitions are unavailable', async (t) => {
  const page = await setup(t);
  await page.evaluate(() => { document.querySelector('.other-workspace').startViewTransition = undefined; });
  await readParagraph(page);
  const before = await paragraphPosition(page);
  await page.evaluate(() => window.toggleGuideSidebar());
  assert.ok(Math.abs(await paragraphPosition(page) - before) < 0.03);
});
