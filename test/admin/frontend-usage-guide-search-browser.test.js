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

test('suite search lists its own subheading and navigates to that heading', async (t) => {
  const page = await setup(t);
  await page.locator('#usageGuideSearchInput').fill('素材与样式库');
  const firstResult = page.locator('.usage-guide-search-result').first();
  assert.equal(await firstResult.locator('strong').textContent(), '05.7 素材与样式库');
  await firstResult.click();
  assert.deepEqual(await page.evaluate(() => ({
    heading: window.guideSearchTarget.closest('h4')?.textContent,
    text: window.guideSearchTarget.textContent,
    section: window.guideSearchSection,
  })), {
    heading: '05.7 素材与样式库',
    text: '素材与样式库',
    section: 'ug-scene-guide',
  });
});

test('search navigation follows a matching passage late in an article or in a section introduction', async (t) => {
  const page = await setup(t);
  for (const [query, container] of [
    ['只能用英文字母', '#ug-login p'],
    ['使用另外的链接', '#ug-scene-guide > p'],
  ]) {
    await page.locator('#usageGuideSearchInput').fill(query);
    await page.locator('.usage-guide-search-result').first().click();
    assert.deepEqual(await page.evaluate((selector) => ({
      text: window.guideSearchTarget.textContent,
      inPassage: Boolean(window.guideSearchTarget.closest(selector)),
    }), container), { text: query, inPassage: true });
  }
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
    assert.equal(await page.locator('.usage-guide-search-results').isVisible(), false);
  }
});

test('search reveals a matching passage inside a collapsed disclosure within an article', async (t) => {
  const page = await setup(t);
  await page.locator('#usageGuideSearchInput').fill('用户名旁的说明');
  await page.locator('.usage-guide-search-result').first().click();
  assert.equal(await page.evaluate(() => window.guideSearchTarget.closest('details').open), true);
  assert.equal(await page.locator('#ug-login .usage-guide-search-match').isVisible(), true);
});

test('guide chapters own their migrated content and every internal link has one target', async (t) => {
  const page = await setup(t);
  const owners = {
    'ug-quick': 'ug-setup',
    'ug-login': 'ug-setup',
    'ug-password-reset': 'ug-setup',
    'ug-song-rules': 'ug-song',
    'ug-playback-queue': 'ug-song',
    'ug-web-share': 'ug-song',
    'ug-deepseek': 'ug-interactions',
    'ug-dynamic-lottery': 'ug-interactions',
    'ug-web-gift-analysis': 'ug-gifts',
    'ug-sprint-goal': 'ug-gifts',
    'ug-gift-wishes': 'ug-scene-guide',
    'ug-sprint-overlay': 'ug-scene-guide',
    'ug-overtime-rules': 'ug-scene-guide',
    'ug-danmaku': 'ug-scene-guide',
    'ug-obs': 'ug-scene-guide',
    'ug-fan-archive': 'ug-work',
    'ug-fan-backup': 'ug-maintenance',
    'ug-glossary': 'ug-maintenance',
    'ug-feedback': 'ug-faq',
  };
  assert.deepEqual(await page.evaluate((ids) => Object.fromEntries(ids.map((id) =>
    [id, document.getElementById(id)?.closest('.usage-guide-section')?.id])), Object.keys(owners)), owners);
  assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="#ug-"]'))
    .map((link) => link.hash).filter((hash) => document.querySelectorAll(hash).length !== 1)), []);
  assert.equal(await page.locator('article article').count(), 0);
  await page.locator('#usageGuideSearchInput').fill('不适用于永久删除');
  await page.locator('.usage-guide-search-result').first().click();
  assert.equal(await page.evaluate(() => window.guideSearchSection), 'ug-work');
  assert.equal(await page.evaluate(() => window.guideSearchTarget.closest('article').id), 'ug-fan-archive');
});
