'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const openBrowserSession = useSharedBrowser();

async function openPage(t, html) {
  const browser = openBrowserSession();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.setContent(html);
  return page;
}

async function setup(t) {
  const page = await openPage(t, `<section id="otherUsageGuideFeature">
    <input id="usageGuideSearchInput"><button class="usage-guide-search-clear" hidden>Clear</button>
    <div class="usage-guide-search-results" hidden>
      <p class="usage-guide-search-status"></p><ul class="usage-guide-search-list"></ul>
    </div>
    <section class="usage-guide-section" id="ug-search">
      <h3 class="usage-guide-section-title">Search examples</h3>
      <article><strong>Article</strong><p>${'Unrelated introduction. '.repeat(30)}</p><p>late-<a href="#example">match</a></p></article>
      <details class="usage-guide-faq"><summary>Question</summary><p>collapsed-match</p></details>
      <article><strong>Nested article</strong><details><summary>Steps</summary><ol class="usage-guide-steps"><li>nested-match</li></ol></details></article>
    </section>
  </section>`);
  await page.addScriptTag({ type: 'module', content: `${fs.readFileSync(
    path.join(__dirname, '../../public/js/admin/usage-guide-search.js'), 'utf8',
  )}
    initUsageGuideSearch(document.querySelector('#otherUsageGuideFeature'), (target, sectionId) => {
      window.guideSearchTarget = target;
      window.guideSearchSection = sectionId;
    });
  ` });
  return page;
}

test('search navigation follows a matching passage late in an article', async (t) => {
  const page = await setup(t);
  await page.locator('#usageGuideSearchInput').fill('late-match');
  await page.locator('.usage-guide-search-result').first().click();
  assert.deepEqual(await page.evaluate(() => ({
    text: [...window.guideSearchTarget.parentElement.querySelectorAll('mark')].map(node => node.textContent).join(''),
    inPassage: Boolean(window.guideSearchTarget.closest('#ug-search article p')),
    inLink: document.querySelector('a[href="#example"] mark')?.textContent,
  })), { text: 'late-match', inPassage: true, inLink: 'match' });
});

test('search opens a collapsed FAQ and clears highlights without changing the original text', async (t) => {
  const page = await setup(t);
  const faq = page.locator('details.usage-guide-faq');
  const originalText = await faq.textContent();
  const input = page.locator('#usageGuideSearchInput');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await input.fill('collapsed-match');
    await input.press('Enter');
    assert.equal(await faq.evaluate((node) => node.open), true);
    assert.equal(await page.evaluate(() => window.guideSearchTarget.textContent), 'collapsed-match');
    assert.equal(await faq.locator('.usage-guide-search-match').count(), 1);
    await input.press('Escape');
    assert.equal(await page.locator('.usage-guide-search-match').count(), 0);
    assert.equal(await faq.textContent(), originalText);
  }
});

test('every internal guide link has exactly one target', async (t) => {
  const page = await openPage(t, readAdminFragmentHtml('pages/admin/toolbox/usage-guide.html'));
  assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="#ug-"]'))
    .map((link) => link.hash).filter((hash) => document.querySelectorAll(hash).length !== 1)), []);
});

test('nested steps produce one search result and open their containing details', async (t) => {
  const page = await setup(t);
  await page.locator('#usageGuideSearchInput').fill('nested-match');
  assert.equal(await page.locator('.usage-guide-search-result').count(), 1);
  await page.locator('.usage-guide-search-result').click();
  assert.equal(await page.locator('article details').evaluate(node => node.open), true);
  assert.equal(await page.evaluate(() => window.guideSearchTarget.textContent), 'nested-match');
});

test('functional page guide links open the guide and reveal folded destinations', async t => {
  const fragments = ['dynamic-lottery', 'danmaku', 'usage-guide']
    .map(name => readAdminFragmentHtml(`pages/admin/toolbox/${name}.html`)).join('\n');
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><html><head>
    <link rel="stylesheet" href="/css/styles-base.css"><link rel="stylesheet" href="/css/styles-admin.css">
    <style>.other-workspace { height: 700px; }</style>
    </head><body><div class="other-page"><div class="other-workspace"><aside class="other-feature-sidebar"></aside>
    <div class="other-feature-content">${fragments}</div></div></div>
    <script type="module">
      import '/js/admin/contextual-help.js';
      import { initUsageGuide } from '/js/admin/usage-guide.js';
      window.showPanel = id => {
        for (const panel of document.querySelectorAll('[data-other-feature-panel]')) {
          panel.hidden = panel.id !== id; panel.classList.toggle('active', panel.id === id);
        }
      };
      initUsageGuide({ showGuide: () => window.showPanel('otherUsageGuideFeature') });
      window.guideReady = true;
    </script></body></html>` });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.waitForFunction(() => window.guideReady);
  const landings = [];
  async function checkLanding(hash) {
    await page.waitForFunction(hash => {
      const section = document.querySelector(hash);
      const node = section.querySelector('.usage-guide-section-title, .usage-guide-feature-head strong') || section;
      const target = node.getBoundingClientRect();
      const scroller = node.closest('.other-feature-panel-body').getBoundingClientRect();
      return target.height > 0 && target.top >= scroller.top && target.top < scroller.bottom;
    }, hash);
    landings.push(await page.evaluate(hash => {
      const section = document.querySelector(hash);
      const node = section.querySelector('.usage-guide-section-title, .usage-guide-feature-head strong') || section;
      const scroller = node.closest('.other-feature-panel-body').getBoundingClientRect();
      return { hash, targetTop: Math.round(node.getBoundingClientRect().top), viewportTop: Math.round(scroller.top), viewportBottom: Math.round(scroller.bottom) };
    }, hash));
  }
  for (const hash of ['#ug-dynamic-lottery', '#ug-doubao-recovery', '#ug-cloud-runtime']) {
    const link = page.locator(`[data-other-feature-panel]:not(#otherUsageGuideFeature) [data-usage-guide-link][href="${hash}"]`);
    await page.evaluate(hash => {
      const link = [...document.querySelectorAll(`[data-usage-guide-link][href="${hash}"]`)]
        .find(node => !node.closest('#otherUsageGuideFeature'));
      window.showPanel(link.closest('[data-other-feature-panel]').id);
      for (let parent = link.parentElement; parent; parent = parent.parentElement) {
        parent.hidden = false;
        if (parent.tagName === 'DETAILS') parent.open = true;
      }
    }, hash);
    await link.click();
    await page.waitForFunction(() => !document.getElementById('otherUsageGuideFeature').hidden
      && !document.getElementById('otherUsageGuideFeature').classList.contains('usage-guide-render-all'));
    await checkLanding(hash);
  }
  const font = page.locator('#ug-font-library');
  await font.evaluate(node => { node.closest('details').open = false; });
  const fontLink = page.locator('#otherUsageGuideFeature a[href="#ug-font-library"]').first();
  await fontLink.evaluate(node => {
    for (let details = node.closest('details'); details; details = details.parentElement.closest('details')) details.open = true;
  });
  await fontLink.click();
  await page.waitForFunction(() => !document.getElementById('otherUsageGuideFeature').classList.contains('usage-guide-render-all'));
  assert.equal(await font.evaluate(node => node.closest('details').open), true);
  await checkLanding('#ug-font-library');
  t.diagnostic(`Guide navigation landings: ${JSON.stringify(landings)}`);
  assert.deepEqual(errors, []);
});
