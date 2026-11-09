'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');
const { useSharedBrowser } = require('../helpers/shared-browser');

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
      <article><strong>Article</strong><p>${'Unrelated introduction. '.repeat(30)}</p><p>late-match</p></article>
      <details class="usage-guide-faq"><summary>Question</summary><p>collapsed-match</p></details>
    </section>
  </section>`);
  await page.addScriptTag({ content: readJsModuleBundle('public', 'js', 'admin', 'usage-guide-search.js') });
  await page.evaluate(() => {
    initUsageGuideSearch(document.querySelector('#otherUsageGuideFeature'), (target, sectionId) => {
      window.guideSearchTarget = target;
      window.guideSearchSection = sectionId;
    });
  });
  return page;
}

test('search navigation follows a matching passage late in an article', async (t) => {
  const page = await setup(t);
  await page.locator('#usageGuideSearchInput').fill('late-match');
  await page.locator('.usage-guide-search-result').first().click();
  assert.deepEqual(await page.evaluate(() => ({
    text: window.guideSearchTarget.textContent,
    inPassage: Boolean(window.guideSearchTarget.closest('#ug-search article p')),
  })), { text: 'late-match', inPassage: true });
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
