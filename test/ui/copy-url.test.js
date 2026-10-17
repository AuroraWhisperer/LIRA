'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const fixture = createUiFixture();

async function open(t) {
  const page = await fixture(t, 'copy-url');
  await page.route('**/js/shared/utils.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export { copyText } from '/js/shared/utils.js?actual=1';
      export const toast = message => window.messages.push(message);`,
  }));
  await page.setContent('<form><button id="url"><code>http://127.0.0.1:3000/gift-wishes</code></button></form>');
  await page.addStyleTag({ content: fs.readFileSync('public/css/components/copy-url.css', 'utf8') });
  await page.evaluate(async () => {
    window.copied = [];
    window.submissions = 0;
    document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); window.submissions++; });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { window.copied.push(text); },
    } });
    const { bindCopyUrl } = await import('/js/shared/copy-url.js');
    window.bindCopyUrl = bindCopyUrl;
    bindCopyUrl(document.getElementById('url'));
    window.disposeCopyUrl = bindCopyUrl(document.getElementById('url'));
  });
  return page;
}

test('URL blocks copy the current full address once per click or keyboard activation and accept CSS dimensions', async t => {
  const page = await open(t);
  const button = page.locator('#url');
  await button.click();
  await button.press('Enter');
  await button.press('Space');
  assert.deepEqual(await page.evaluate(() => window.copied), Array(3).fill('http://127.0.0.1:3000/gift-wishes'));
  assert.equal(await page.evaluate(() => window.messages.length), 3);
  assert.equal(await page.evaluate(() => window.submissions), 0);
  const url = `https://example.test/overlay/${'long-address-'.repeat(20)}?name=<b>test</b>`;
  await button.evaluate((node, url) => {
    node.firstChild.textContent = url;
    node.style.setProperty('--copy-url-width', '240px');
    node.style.setProperty('--copy-url-height', '44px');
  }, url);
  await button.blur();
  await button.focus();
  assert.match(await button.getAttribute('title'), /点击复制地址/);
  assert.ok((await button.getAttribute('title')).endsWith(url));
  assert.equal(await button.locator('b').count(), 0);
  assert.deepEqual(await button.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return [rect.width, rect.height];
  }), [240, 44]);
  await button.click();
  assert.equal(await page.evaluate(() => window.copied.at(-1)), url);
  await button.evaluate(node => { node.disabled = true; node.click(); });
  assert.equal(await page.evaluate(() => window.copied.length), 4);
  await page.evaluate(() => { window.disposeCopyUrl(); document.getElementById('url').disabled = false; });
  await button.click();
  assert.equal(await page.evaluate(() => window.copied.length), 4);
});

test('URL blocks skip empty addresses, use the clipboard fallback and report failure without a success notice', async t => {
  const page = await open(t);
  await page.evaluate(() => { document.getElementById('url').textContent = ''; });
  await page.locator('#url').click();
  assert.deepEqual(await page.evaluate(() => window.copied), []);
  await page.evaluate(() => {
    document.getElementById('url').textContent = 'http://127.0.0.1:3000/gift-wishes';
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    document.execCommand = command => {
      window.fallback = [command, document.querySelector('textarea').value];
      return true;
    };
  });
  await page.locator('#url').click();
  assert.deepEqual(await page.evaluate(() => window.fallback), ['copy', 'http://127.0.0.1:3000/gift-wishes']);
  assert.equal(await page.locator('textarea').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.messages), ['地址已复制']);
  await page.evaluate(() => { document.execCommand = () => false; window.messages = []; });
  await page.locator('#url').click();
  assert.deepEqual(await page.evaluate(() => window.messages), ['复制失败，请手动复制地址。']);
  assert.equal(await page.locator('textarea').count(), 0);
});
