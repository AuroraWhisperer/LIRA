'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

async function setup(t) {
  const browser = openBrowserSession();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.setContent(readAdminFragmentHtml('pages/admin/toolbox/usage-guide.html'));
  await page.locator('#otherUsageGuideFeature').evaluate((panel) => { panel.hidden = false; });
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
  await page.locator('#usageGuideSearchInput').fill('只能用英文字母');
  await page.locator('.usage-guide-search-result').first().click();
  assert.deepEqual(await page.evaluate(() => ({
    text: window.guideSearchTarget.textContent,
    inPassage: Boolean(window.guideSearchTarget.closest('#ug-login p')),
  })), { text: '只能用英文字母', inPassage: true });
});

test('search opens a collapsed FAQ and clears highlights without changing the original text', async (t) => {
  const page = await setup(t);
  const faq = page.locator('details.usage-guide-faq').filter({ hasText: '同步到一半断网，不知道成功没有' });
  const originalText = await faq.textContent();
  const input = page.locator('#usageGuideSearchInput');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await input.fill('不能断定服务器一定没收到');
    await input.press('Enter');
    assert.equal(await faq.evaluate((node) => node.open), true);
    assert.equal(await page.evaluate(() => window.guideSearchTarget.textContent), '不能断定服务器一定没收到');
    assert.equal(await faq.locator('.usage-guide-search-match').count(), 1);
    await input.press('Escape');
    assert.equal(await page.locator('.usage-guide-search-match').count(), 0);
    assert.equal(await faq.textContent(), originalText);
  }
});

test('every internal guide link has exactly one target', async (t) => {
  const page = await setup(t);
  assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="#ug-"]'))
    .map((link) => link.hash).filter((hash) => document.querySelectorAll(hash).length !== 1)), []);
});
