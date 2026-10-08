'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { launchElectron } = require('../helpers/shared-electron');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');
const { createComponentStyleLibrary } = require('../../src/server/component-style-library');
const { saveMedia } = require('../../src/server/component-media-files');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { COMPONENT_RESOURCE_PRESETS } = require('../../public/js/shared/component-resource-style.js');

test('desktop wish styles show names and preview imported appearances before adding to the canvas', { timeout: 60000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const scratch = path.join(root, 'tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, 'wish-styles-electron-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(scratch));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const store = createComponentStyleStore(directory);
  const packId = randomUUID();
  const preset = COMPONENT_RESOURCE_PRESETS['moonlit-wishes'];
  const resources = {};
  for (const source of preset.resources) {
    const media = await saveMedia(fs.createReadStream(path.join(root, 'public', source)), store.directory(packId, true), source, { packageResource: true });
    resources[source] = `/component-media/${packId}/${media.basename}`;
  }
  const resourceStyle = { id: randomUUID(), preset: 'moonlit-wishes', width: 640, height: 451,
    preview: resources[preset.resources[0]], resources };
  const config = normalizeSceneConfig('gift-wishes', { ...preset.config, resourceStyle });
  store.stage({ id: packId, name: '测试许愿样式', styles: [
    { id: resourceStyle.id, type: 'gift-wishes', name: '月渡花汀 · 礼物许愿', config },
  ] });
  await createComponentStyleLibrary(directory).install(packId);
  app = await launchElectron({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const snapshot = { viewRevision: 'synthetic-wishes', partial: false, session: { state: 'live' }, guards: [], items: [] };
  await page.route('**/api/gifts/wishes', route => route.fulfill({ json: { ok: true, data: snapshot } }));
  await page.route('**/api/overtime/gifts/catalog', route => route.fulfill({ json: { ok: true, data: { gifts: [
    { id: '1', variantId: 'synthetic-flower', name: '小花花', imagePath: '/img/overlays/gift-feed/flower.webp' },
    { id: '2', name: '牛哇牛哇', imagePath: '/img/overlays/gift-feed/cheer.webp' },
    { id: '3', name: '打call', imagePath: '/img/overlays/gift-feed/call.webp' },
  ] } } }));
  await page.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  await page.evaluate(async markup => {
    const html = new DOMParser().parseFromString(markup, 'text/html');
    document.body.replaceChildren(html.getElementById('giftWishesPanel'), html.getElementById('giftWishPicker'));
    document.getElementById('giftWishesPanel').hidden = false;
    const { createGiftWishes } = await import('/js/admin/gifts/wishes.js');
    const { initComponentStyleLibraries } = await import('/js/admin/component-style-client.js');
    window.wishes = createGiftWishes();
    await window.wishes.open();
    initComponentStyleLibraries();
  }, fs.readFileSync(path.join(root, 'public/pages/admin/toolbox/gift-wishes.html'), 'utf8'));
  const styles = page.locator('#giftWishDisplayStyle');
  const imported = styles.getByRole('button', { name: '预览样式：月渡花汀 · 礼物许愿', exact: true });
  await imported.waitFor();
  assert.equal(await styles.locator('img, video, .component-source-thumbnail').count(), 0);
  assert.equal(await imported.evaluate(button => button.offsetHeight), await styles.locator('label > span').first().evaluate(span => span.offsetHeight));
  await imported.click({ force: true });
  await page.waitForFunction(() => document.querySelector('#giftWishDraftPreview iframe'));
  const frame = page.frameLocator('#giftWishDraftPreview iframe');
  await frame.locator('.wish-card--moonlit').waitFor();
  assert.equal(await imported.getAttribute('aria-pressed'), 'true');
  assert.equal(await styles.locator('input:checked').count(), 0);
  assert.equal(await frame.locator('.wish-card').count(), 1);
  const artwork = await frame.locator('.wish-card').evaluate(card => getComputedStyle(card).backgroundImage);
  assert.ok(artwork.includes(resources[preset.resources[0]]));
  await page.locator('#giftWishTarget').fill('25');
  await frame.locator('.wish-card-target').filter({ hasText: '/25' }).waitFor();
  await page.locator('#giftWishPick').click({ force: true });
  await page.getByRole('button', { name: '全部缓存礼物', exact: true }).click({ force: true });
  await page.getByRole('button', { name: /小花花/ }).click({ force: true });
  await frame.locator('.wish-moon-name').filter({ hasText: '小花花' }).waitFor();
  await styles.locator('input[value="circle"]').check({ force: true });
  assert.equal(await page.locator('#giftWishDraftPreview iframe').count(), 0);
  assert.equal(await page.locator('#giftWishDraftPreview .wish-card--circle').count(), 1);
  await imported.click({ force: true });
  await frame.locator('.wish-card--moonlit').waitFor();
  assert.equal(await page.locator('#giftWishDraftPreview iframe').count(), 1);
  await page.getByRole('button', { name: '在画布中使用', exact: true }).click({ force: true });
  await page.waitForFunction(async () => {
    const { prepareComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    const canvas = (await prepareComponentPreviews()).find(entry => entry.id === 'canvas');
    return canvas?.controller.getState().draft.document.items.some(item => item.type === 'gift-wishes');
  });
  assert.deepEqual(errors, []);
});
