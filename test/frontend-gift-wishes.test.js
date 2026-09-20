'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createUiFixture } = require('./helpers/ui-edit-state-fixture');
const fixture = createUiFixture();
const html = fs
  .readFileSync('public/pages/admin/toolbox/gift.html', 'utf8')
  .replace(
    '<!-- admin-fragment: pages/admin/toolbox/gift-wishes.html -->',
    fs.readFileSync('public/pages/admin/toolbox/gift-wishes.html', 'utf8'),
  );

async function open(t) {
  const page = await fixture(t, 'wishes');
  await page.route('**/js/shared/event-bus.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: fs.readFileSync('public/js/shared/event-bus.js', 'utf8'),
  }));
  await page.setContent(html);
  await page.evaluate(async () => {
    document.getElementById('otherGiftFeature').hidden = false;
    window.wishSaves = [];
    window.wishDeleted = [];
    window.wishData = {
      viewRevision: 'one',
      partial: false,
      session: { state: 'live' },
      guards: [],
      items: [],
    };
    window.catalogGift = {
      id: '1',
      variantId: 'flower-v1',
      name: '小花花',
      rmb: 1,
      giftCategory: 'directGift',
    };
    window.fetch = async (url, options) => {
      let data = null;
      if (url === '/api/gifts/wishes') data = structuredClone(window.wishData);
      else if (url.includes('/api/overtime/gifts'))
        data = { gifts: [window.catalogGift] };
      else if (url === '/api/gifts/wishes/save') {
        const body = JSON.parse(options.body);
        window.wishSaves.push(body);
        if (body.id) Object.assign(window.wishData.items[0], body);
        else
          window.wishData.items.push({
            ...body,
            id: 'new',
            giftName: '小花花',
            giftId: '1',
            giftCategory: 'directGift',
            count: 3,
            remaining: body.target - 3,
            progress: 30,
            completed: false,
          });
        data = { id: 'new' };
      } else if (url === '/api/gifts/wishes/delete') {
        window.wishDeleted.push(JSON.parse(options.body));
        window.wishData.items = [];
        data = { removed: true };
      } else throw new Error(`Unexpected fetch: ${url}`);
      return { ok: true, json: async () => ({ ok: true, data }) };
    };
    const { initGiftAssistant } = await import('/js/admin/gift-assistant.js');
    initGiftAssistant();
  });
  await page.getByRole('tab', { name: '礼物许愿', exact: true }).click();
  await page.waitForFunction(
    () => !document.getElementById('giftWishFields').disabled,
  );
  return page;
}

test('choose room or cached gifts, enforce integer targets, edit without resetting and delete', async (t) => {
  const page = await open(t);
  assert.equal(await page.locator('#giftWishEmpty').isVisible(), true);
  await page.locator('#giftWishPick').click();
  await page.getByRole('button', { name: '全部缓存礼物', exact: true }).click();
  await page.locator('#giftWishSearch').fill('小花');
  await page.locator('.gift-wish-option').click();
  await page.locator('#giftWishTarget').fill('1.5');
  await page.locator('#giftWishSave').click();
  assert.equal(await page.evaluate(() => window.wishSaves.length), 0);
  await page.locator('#giftWishTarget').fill('10');
  await page.locator('#giftWishLabel').fill('<img src=x>');
  await page.locator('#giftWishSave').click();
  await page.locator('.wish-card').waitFor();
  assert.equal(
    await page.locator('.wish-card-label').textContent(),
    '<img src=x>',
  );
  assert.equal(await page.locator('.wish-card-label img').count(), 0);
  assert.equal(await page.locator('.wish-card-count').textContent(), '3');
  assert.equal(
    await page.locator('[role=progressbar]').getAttribute('aria-valuenow'),
    '3',
  );
  assert.equal(
    await page.evaluate(() => window.wishSaves[0].giftKey),
    'flower-v1',
  );
  await page.getByRole('button', { name: '编辑目标', exact: true }).click();
  await page.locator('#giftWishTarget').fill('20');
  await page.locator('#giftWishSave').click();
  await page.waitForFunction(() =>
    document.querySelector('.wish-card-target').textContent.includes('20'),
  );
  assert.equal(await page.locator('.wish-card-count').textContent(), '3');
  assert.equal(await page.evaluate(() => window.wishSaves[1].id), 'new');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.waitForFunction(
    () => document.getElementById('giftWishEmpty').hidden === false,
  );
  assert.equal(await page.locator('.wish-card').count(), 0);
});

test('period changes update OBS URLs and source changes discard an in-progress edit', async (t) => {
  const page = await open(t);
  for (const period of ['day', 'session', 'long']) {
    await page.locator(`[data-wish-period=${period}]`).click();
    assert.match(
      await page.locator('#giftWishUrl').inputValue(),
      new RegExp(`period=${period}$`),
    );
  }
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await page.locator('#giftWishTarget').fill('99');
  await page.evaluate(() => {
    window.wishData.viewRevision = 'other';
  });
  await page.locator('#giftWishesRefresh').click();
  await page.waitForFunction(
    () =>
      document.getElementById('giftWishSelectedName').textContent ===
      '选择心愿礼物',
  );
  assert.equal(await page.locator('#giftWishTarget').inputValue(), '10');
});

test('room picker distinguishes blind boxes and outputs without relationship metadata', async (t) => {
  const page = await open(t);
  for (const [category, label] of [
    ['blindBox', '盲盒本体'], ['blindBoxOutput', '盲盒产出'],
  ]) {
    await page.evaluate((value) => { window.catalogGift.giftCategory = value; }, category);
    await page.locator('#giftWishPick').click();
    await page.locator('.gift-wish-option').waitFor();
    assert.match(await page.locator('.gift-wish-option').textContent(), new RegExp(label));
    await page.locator('#giftWishPickerClose').click();
  }
});

test('picker marks unresolved room gifts as unavailable until their identity is synced', async (t) => {
  const page = await open(t);
  await page.evaluate(() => {
    delete window.catalogGift.variantId;
    delete window.catalogGift.giftCategory;
  });
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').waitFor();
  assert.equal(await page.locator('.gift-wish-option').isDisabled(), true);
  assert.match(await page.locator('.gift-wish-option').textContent(), /资料待同步/);
});

test('consecutive source changes cancel pending reads and never restore the previous source', async (t) => {
  const page = await open(t);
  const requests = await page.evaluate(async () => {
    const { eventBus, Events } = await import('/js/shared/event-bus.js');
    window.pendingWishReads = [];
    window.fetch = (_url, options) => new Promise((resolve) => {
      window.pendingWishReads.push({ signal: options.signal, resolve });
    });
    for (const viewRevision of ['two', 'three', 'three']) {
      eventBus.emit(Events.STATE_LOADED, { state: { gifts: { viewRevision } } });
    }
    return window.pendingWishReads.map((request) => request.signal.aborted);
  });
  assert.deepEqual(requests, [true, false]);
  assert.equal(await page.locator('#giftWishSave').isDisabled(), true);
  await page.evaluate(() => {
    window.resolveWishRead = (index, viewRevision) => {
      window.pendingWishReads[index].resolve({
        ok: true,
        json: async () => ({ ok: true, data: {
          ...window.wishData, viewRevision,
          items: [{ id: viewRevision, period: 'long', giftName: viewRevision,
            target: 10, count: 0, remaining: 10, progress: 0, completed: false }],
        } }),
      });
    };
    window.resolveWishRead(1, 'three');
  });
  await page.waitForFunction(() => document.querySelector('.wish-card-name')?.textContent === 'three');
  await page.evaluate(async () => {
    window.resolveWishRead(0, 'two');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(await page.locator('.wish-card-name').textContent(), 'three');
  assert.equal(await page.locator('#giftWishSave').isDisabled(), false);
});
