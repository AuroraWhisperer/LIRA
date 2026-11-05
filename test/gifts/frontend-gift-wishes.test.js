'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const fixture = createUiFixture();
const html = readAdminFragmentHtml('pages/admin/live-components/page.html');

async function open(t) {
  const page = await fixture(t, 'wishes');
  // Imported appearances use the authorized component renderer, covered by the desktop test.
  await page.route('**/js/admin/gifts/wish-style-preview.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export const createWishStylePreview = () => ({ clear() {}, dispose() {} });',
  }));
  await page.route('**/js/admin/component-preview-dialog.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'export const openComponentPreview = options => { window.openedComponent = options.id; };',
  }));
  await page.route('**/js/shared/event-bus.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: fs.readFileSync('public/js/shared/event-bus.js', 'utf8'),
    }),
  );
  await page.setContent(html);
  await page.evaluate(async () => {
    document.getElementById('liveComponentsPage').classList.add('active');
    const { createFeatureNavigation } = await import('/js/admin/toolbox-navigation.js');
    createFeatureNavigation({ pageId: 'liveComponentsPage', storagePrefix: 'admin.liveComponents' }).initOtherPage();
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
      else if (url.includes('/api/overtime/gifts')) data = { gifts: [window.catalogGift] };
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
            imagePath: window.catalogGift.imagePath,
            todayCount: 1,
            count: 3,
            remaining: body.target - 3,
            progress: 30,
            completed: false,
          });
        data = { id: 'new' };
      } else if (url === '/api/gifts/wishes/delete') {
        const body = JSON.parse(options.body);
        window.wishDeleted.push(body);
        window.wishData.items = window.wishData.items.filter(item => item.id !== body.id);
        data = { removed: true };
      } else throw new Error(`Unexpected fetch: ${url}`);
      return { ok: true, json: async () => ({ ok: true, data }) };
    };
    const { initGiftAssistant } = await import('/js/admin/gift-assistant.js');
    initGiftAssistant();
  });
  await page.getByRole('tab', { name: '礼物许愿', exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('giftWishFields').disabled);
  return page;
}

async function loadSharedFont(page) {
  await page.route('**/fonts/player/xiaolai.woff2', route => route.fulfill({
    contentType: 'font/woff2', path: 'public/fonts/player/xiaolai.woff2',
  }));
  await page.evaluate(async () => {
    const font = new FontFace('Lira Xiaolai', 'url(/fonts/player/xiaolai.woff2)');
    document.fonts.add(await font.load());
    const { refreshSharedFonts } = await import('/js/shared/font-library.js');
    refreshSharedFonts();
  });
}

async function openOverlay(t, period, missingAbortMethods, display = {}) {
  const page = await fixture(t, 'wish-overlay');
  await page.setContent('<main id="giftWishStage"></main><p id="giftWishOverlayStatus" hidden></p>');
  await page.evaluate(
    async ({ period, missingAbortMethods, display }) => {
      history.replaceState(null, '', period ? `/gift-wishes?period=${period}` : '/gift-wishes');
      for (const method of missingAbortMethods) delete AbortSignal[method];
      window.wishData = {
        viewRevision: 'one',
        partial: false,
        session: { state: 'live' },
        items: ['long', 'day', 'session'].map((period) => ({
          id: period,
          period,
          giftName: '小花花',
          target: 10,
          count: 3,
          progress: 30,
          completed: false,
          ...display,
        })),
      };
      window.wishRequests = 0;
      window.fetch = async (url) => {
        if (url !== '/api/gifts/wishes') throw new Error(`Unexpected fetch: ${url}`);
        window.wishRequests++;
        return { ok: true, json: async () => ({ ok: true, data: structuredClone(window.wishData) }) };
      };
      await import('/js/overlays/gift-wishes.js');
    },
    { period, missingAbortMethods, display },
  );
  await page.waitForFunction(
    () => document.querySelector('.wish-card') || document.getElementById('giftWishOverlayStatus').textContent,
  );
  assert.equal(await page.locator('#giftWishOverlayStatus').textContent(), '');
  return page;
}

test('period wishes load and update without AbortSignal any or timeout', async (t) => {
  const page = await openOverlay(t, 'day', ['any', 'timeout']);
  assert.equal(await page.locator('.wish-card').count(), 1);
  assert.equal(await page.locator('.wish-card').getAttribute('data-wish-id'), 'day');
  await page.evaluate(() => {
    Object.assign(window.wishData.items.find((wish) => wish.period === 'day'), { count: 10, progress: 100, completed: true });
    window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
  });
  await page.waitForFunction(() => document.querySelector('.wish-card-count').textContent === '10');
  assert.equal(await page.evaluate(() => window.wishRequests), 2);
});

test('unified wish source displays all periods and refreshes them together', async (t) => {
  const page = await openOverlay(t, null, ['any', 'timeout']);
  assert.deepEqual(await page.locator('.wish-card').evaluateAll((cards) => cards.map((card) => card.dataset.wishId)),
    ['long', 'day', 'session']);
  await page.evaluate(() => {
    for (const wish of window.wishData.items) Object.assign(wish, { count: 10, progress: 100, completed: true });
    window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
  });
  await page.waitForFunction(() => document.querySelectorAll('.wish-card.is-complete').length === 3);
  assert.equal(await page.evaluate(() => window.wishRequests), 2);
  await page.evaluate(() => {
    window.wishData.items = [];
    window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
  });
  await page.waitForFunction(() => document.querySelectorAll('.wish-card').length === 0);
});

for (const cancellation of ['timeout', 'pagehide']) {
  test(`wish overlay ${cancellation} aborts a pending response body without modern AbortSignal methods`, async (t) => {
    const page = await openOverlay(t, 'day', ['any', 'timeout']);
    await page.clock.install();
    await page.evaluate(() => {
      const read = window.fetch;
      window.fetch = async (url, options) => {
        const response = await read(url);
        if (!window.pendingWishSignal) {
          window.pendingWishSignal = options.signal;
          response.json = () =>
            new Promise((resolve, reject) => {
              window.pendingWishBody = true;
              options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                once: true,
              });
            });
        }
        return response;
      };
      window.socketOptions.onMessage({
        type: 'snapshot',
        reason: 'gift:wishes',
        state: { gifts: { viewRevision: 'one' } },
      });
    });
    await page.waitForFunction(() => window.pendingWishBody);
    assert.equal(await page.evaluate(() => window.pendingWishSignal.aborted), false);
    if (cancellation === 'timeout') {
      await page.clock.runFor(10000);
      await page.clock.runFor(3000);
      assert.equal(await page.evaluate(() => window.wishRequests), 3);
    } else {
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await page.clock.runFor(13000);
      assert.equal(await page.evaluate(() => window.wishRequests), 2);
    }
    assert.equal(await page.evaluate(() => window.pendingWishSignal.aborted), true);
  });
}

test('choose room or cached gifts, enforce integer targets, edit without resetting and delete', async (t) => {
  const page = await open(t);
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
  await page.locator('#giftWishCards .wish-card').waitFor();
  assert.equal(await page.locator('#giftWishCards .wish-card img').count(), 1);
  assert.equal(await page.evaluate(() => window.wishSaves[0].giftKey), 'flower-v1');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#giftWishTarget').fill('20');
  await page.locator('#giftWishSave').click();
  await page.waitForFunction(() => document.querySelector('#giftWishCards .wish-card-target').textContent.includes('20'));
  assert.equal(await page.locator('#giftWishCards .wish-card-count').textContent(), '3');
  assert.equal(await page.evaluate(() => window.wishSaves[1].id), 'new');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '再次点击删除', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('giftWishEmpty').hidden === false);
  assert.equal(await page.locator('#giftWishCards .wish-card').count(), 0);
});

test('the browser-source URL stays unified and source changes discard an in-progress edit', async (t) => {
  const page = await open(t);
  assert.match(await page.locator('#giftWishUrl').textContent(), /\/gift-wishes$/);
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await page.locator('#giftWishTarget').fill('99');
  await page.evaluate(() => {
    window.wishData.viewRevision = 'other';
  });
  await page.locator('#giftWishesRefresh').click();
  await page.waitForFunction(() => document.getElementById('giftWishTarget').value === '10');
});

test('wish drafts survive cancelled item and period changes and discard only after confirmation', async (t) => {
  const page = await open(t);
  await page.evaluate(async () => {
    const { enhanceSelects } = await import('/js/shared/select-menu.js');
    enhanceSelects();
    window.wishData.items = ['one', 'two'].map((id) => ({
      id, period: 'long', giftId: id, giftName: id, target: 10, count: 0,
      todayCount: 0, label: '', displayStyle: 'card', giftCategory: 'directGift',
    }));
  });
  await page.locator('#giftWishesRefresh').click();
  const edit = page.locator('#giftWishCards').getByRole('button', { name: '编辑', exact: true });
  await edit.first().click();
  await page.locator('#giftWishTarget').fill('25');
  await edit.nth(1).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#giftWishTarget').inputValue(), '25');
  assert.equal(await page.locator('#giftWishSelectedName').textContent(), 'one');
  await page.getByRole('button', { name: '许愿统计周期', exact: true }).click();
  await page.getByRole('option', { name: '本日', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#giftWishPeriod').inputValue(), 'long');
  assert.equal(await page.locator('#giftWishTarget').inputValue(), '25');
  await edit.nth(1).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#giftWishSelectedName').textContent(), 'two');
  assert.equal(await page.locator('#giftWishTarget').inputValue(), '10');
  await page.locator('#giftWishLabel').fill('未保存');
  await page.getByRole('button', { name: '许愿统计周期', exact: true }).click();
  await page.getByRole('option', { name: '本日', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#giftWishPeriod').inputValue(), 'day');
  assert.equal(await page.locator('#giftWishLabel').inputValue(), '');
});

test('deleting another wish preserves the current draft and its editing identity', async (t) => {
  const page = await open(t);
  await page.evaluate(() => {
    window.wishData.items = ['one', 'two'].map(id => ({
      id, period: 'long', giftId: id, giftName: id, target: 10, count: 0,
      todayCount: 0, label: '', displayStyle: 'card', giftCategory: 'directGift',
    }));
  });
  await page.locator('#giftWishesRefresh').click();
  await page.locator('#giftWishCards').getByRole('button', { name: '编辑', exact: true }).first().click();
  await page.locator('#giftWishTarget').fill('25');
  await page.locator('#giftWishLabel').fill('未保存的备注');
  await page.locator('#giftWishCards').getByRole('button', { name: '删除', exact: true }).nth(1).click();
  await page.getByRole('button', { name: '再次点击删除', exact: true }).click();
  await page.waitForFunction(() => window.wishData.items.length === 1 && !document.getElementById('giftWishFields').disabled);
  assert.equal(await page.locator('#giftWishTarget').inputValue(), '25');
  assert.equal(await page.locator('#giftWishLabel').inputValue(), '未保存的备注');
  assert.equal(await page.locator('#giftWishSelectedName').textContent(), 'one');
  await page.locator('#giftWishSave').click();
  await page.waitForFunction(() => window.wishSaves.length === 1);
  assert.equal(await page.evaluate(() => window.wishSaves[0].id), 'one');
  assert.equal(await page.evaluate(() => window.wishDeleted[0].id), 'two');
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
});

test('consecutive source changes cancel pending reads and never restore the previous source', async (t) => {
  const page = await open(t);
  const requests = await page.evaluate(async () => {
    const { eventBus, Events } = await import('/js/shared/event-bus.js');
    window.pendingWishReads = [];
    window.fetch = (_url, options) =>
      new Promise((resolve) => {
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
        json: async () => ({
          ok: true,
          data: {
            ...window.wishData,
            viewRevision,
            items: [
              {
                id: viewRevision,
                period: 'long',
                giftName: viewRevision,
                target: 10,
                count: 0,
                remaining: 10,
                progress: 0,
                completed: false,
              },
            ],
          },
        }),
      });
    };
    window.resolveWishRead(1, 'three');
  });
  await page.waitForFunction(() => document.querySelector('#giftWishCards .wish-card-image')?.alt === 'three');
  await page.evaluate(async () => {
    window.resolveWishRead(0, 'two');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(await page.locator('#giftWishCards .wish-card-image').getAttribute('alt'), 'three');
  assert.equal(await page.locator('#giftWishSave').isDisabled(), false);
});

test('switching wish styles keeps the custom text template', async (t) => {
  const page = await open(t);
  const saved = page.locator('#giftWishCards');
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  await page.locator('#giftWishTextEditor').fill('今天想要{礼物}\n已收 {已收} / {目标}');
  await page.locator('#giftWishSave').click();
  await saved.locator('.wish-card-text').waitFor();
  assert.equal(await saved.locator('.wish-card-text').textContent(), '今天想要小花花\n已收 3 / 10');
  assert.equal(await page.evaluate(() => window.wishSaves[0].displayStyle), 'text');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('radio', { name: '圆形徽章', exact: true }).check();
  await page.locator('#giftWishSave').click();
  await saved.locator('.wish-card--circle').waitFor();
  assert.equal(await page.evaluate(() => window.wishSaves[1].displayStyle), 'circle');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), '今天想要{礼物}\n已收 {已收} / {目标}');
});

test('moonlit progress clamps overflow and keeps gift names as text', async (t) => {
  const page = await openOverlay(t, 'long', [], { displayStyle: 'moonlit', count: 13, progress: 100, completed: true,
    giftName: '<img src=x onerror=alert(1)>' });
  assert.equal(await page.locator('.wish-moon-track').getAttribute('aria-valuenow'), '10');
  assert.equal(await page.locator('.wish-moon-name').textContent(), '<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('.wish-moon-name img').count(), 0);
});

test('text overlay renders custom text safely', async (t) => {
  const page = await openOverlay(t, 'day', [], {
    displayStyle: 'text',
    textTemplate: '<b>想要{礼物}</b>\n{已收}/{目标} {未知}',
  });
  assert.equal(await page.locator('.wish-card-text').textContent(), '<b>想要小花花</b>\n3/10 {未知}');
  assert.equal(await page.locator('.wish-card img, .wish-card b').count(), 0);
});

const animatedWishImage = 'data:image/webp;base64,UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAwAAAwAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAAJWUDhMDwAAAC8DwAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAABWUDhMDwAAAC8DwAAAB9D/iP4HIqL/AQA=';

test('image tokens insert at the cursor, persist and disappear when deleted', async (t) => {
  const page = await open(t);
  await page.evaluate((imagePath) => { window.catalogGift.imagePath = imagePath; }, animatedWishImage);
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  const draft = page.locator('#giftWishDraftPreview');
  const saved = page.locator('#giftWishCards');
  const input = page.locator('#giftWishTextEditor');
  const templateInput = page.locator('#giftWishTextTemplate');
  await input.fill('<b>想要</b>{礼物}，再来一个{礼物}\n{已收}/{目标}');
  await input.press('Control+Home');
  for (let index = 0; index < 9; index++) await input.press('ArrowRight');
  await page.getByRole('button', { name: '插入礼物图片', exact: true }).click();
  const template = '<b>想要</b>{图片}{礼物}，再来一个{礼物}\n{已收}/{目标}';
  assert.equal(await templateInput.inputValue(), template);
  assert.equal(await draft.locator('.wish-card-text img').count(), 1);
  assert.equal(await draft.locator('b').count(), 0);
  await page.locator('#giftWishTextImageFormat').selectOption('static');
  await page.locator('#giftWishSave').click();
  await saved.locator('.wish-card-text img').waitFor();
  assert.deepEqual(await page.evaluate(() => {
    const { textImagePosition, textImageFormat, textTemplate } = window.wishSaves[0];
    return { textImagePosition, textImageFormat, textTemplate };
  }), { textImagePosition: 'none', textImageFormat: 'static', textTemplate: template });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await templateInput.inputValue(), template);
  assert.equal(await page.locator('#giftWishTextImageFormat').inputValue(), 'static');
  await input.fill(template.replace('{图片}', ''));
  await page.locator('#giftWishSave').click();
  await page.waitForFunction(() => !document.querySelector('#giftWishCards img'));
  assert.equal(await page.evaluate(() => window.wishSaves[1].textTemplate), template.replace('{图片}', ''));
});

test('legacy image positions convert when edited without losing long text or duplicating explicit tokens', async (t) => {
  const page = await open(t);
  for (const [position, template, expected] of [
    ['before', '字'.repeat(200), `{图片}${'字'.repeat(200)}`],
    ['after', '想要{礼物}', '想要{礼物}{图片}'],
    ['inline', '想要{礼物}和{礼物}', '想要{图片}{礼物}和{礼物}'],
    ['inline', '谢谢', '{图片}谢谢'],
    ['before', '想要{礼物}{图片}', '想要{礼物}{图片}'],
  ]) {
    await page.evaluate(({ position, template }) => {
      window.wishData.items = [{ id: 'old', period: 'long', giftId: '1', giftName: '小花花', label: '',
        target: 10, count: 3, displayStyle: 'text', textTemplate: template, textImagePosition: position }];
    }, { position, template });
    await page.locator('#giftWishesRefresh').click();
    const saved = page.locator('#giftWishCards .wish-card-text');
    const rendered = expected.replaceAll('{礼物}', '小花花');
    await page.waitForFunction((rendered) => {
      const node = document.querySelector('#giftWishCards .wish-card-text');
      return node && [...node.childNodes].map((child) => child.nodeName === 'IMG' ? '{图片}' : child.textContent).join('') === rendered;
    }, rendered);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), expected);
    const saveCount = await page.evaluate(() => window.wishSaves.length);
    await page.locator('#giftWishSave').click();
    await page.waitForFunction((count) => window.wishSaves.length > count && !document.getElementById('giftWishFields').disabled, saveCount);
    assert.equal(await page.evaluate(() => window.wishSaves.at(-1).textImagePosition), 'none');
    assert.equal(await saved.locator('img').count(), expected.match(/\{图片\}/g).length);
    assert.equal(await saved.textContent(), rendered.replaceAll('{图片}', ''));
  }
});

test('wish text paste treats HTML as text', async (t) => {
  const page = await open(t);
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  const editor = page.locator('#giftWishTextEditor');
  const value = () => page.locator('#giftWishTextTemplate').inputValue();
  await editor.press('Control+End');
  await editor.evaluate((node) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '\n<b>谢谢</b>{图片}{礼物}{未知}');
    clipboardData.setData('text/html', '<img src=x onerror="window.pasteExecuted=true">');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  assert.equal(await value(), '许愿{礼物}（{已收}/{目标}）\n<b>谢谢</b>{图片}{礼物}{未知}');
  assert.equal(await editor.locator('b, img').count(), 0);
  assert.equal(await page.evaluate(() => !!window.pasteExecuted), false);
});

test('wish text editing locks with the form and enforces the existing template length limit before saving', async (t) => {
  const page = await open(t);
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  const editor = page.locator('#giftWishTextEditor');
  await editor.fill('字'.repeat(241));
  await page.locator('#giftWishSave').click();
  assert.equal(await page.evaluate(() => window.wishSaves.length), 0);
  await editor.fill('🌸'.repeat(240));
  await page.locator('#giftWishSave').click();
  await page.waitForFunction(() => window.wishSaves.length === 1);
  assert.equal(await page.evaluate(() => [...window.wishSaves[0].textTemplate].length), 240);
  await page.evaluate(() => {
    window.fetch = async () => ({ ok: false, status: 409,
      json: async () => ({ ok: false, error: '来源未就绪', code: 'GIFT_SOURCE_UNAVAILABLE' }) });
  });
  await page.locator('#giftWishesRefresh').click();
  await page.waitForFunction(() => document.getElementById('giftWishFields').disabled);
  assert.equal(await editor.getAttribute('contenteditable'), 'false');
});

test('wish selection formatting preserves tokens and survives saving', async t => {
  const page = await open(t);
  await loadSharedFont(page);
  page.setDefaultTimeout(5000);
  await page.addStyleTag({ content: ['public/css/admin/gift-wishes.css', 'public/css/admin/rich-text-toolbar.css',
    'public/css/shared/gift-wish-card.css'].map(path => fs.readFileSync(path, 'utf8').replace(/@import[^;]+;/g, '')).join('\n') });
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  const editor = page.locator('#giftWishTextEditor');
  const tokenStyles = () => editor.locator('[data-wish-token]').evaluateAll(tokens => tokens.map(token => {
    const style = getComputedStyle(token);
    return [style.fontSize, style.fontWeight, style.fontStyle, style.textDecorationLine];
  }));
  await editor.focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('toolbar', { name: '文字格式' }).waitFor();
  await page.locator('.rich-text-font-family').selectOption('"Lira Xiaolai"');
  await page.getByRole('button', { name: '加粗 (Ctrl+B)', exact: true }).click();
  await page.getByRole('button', { name: '斜体 (Ctrl+I)', exact: true }).click();
  await page.getByRole('button', { name: '下划线 (Ctrl+U)', exact: true }).click();
  await page.locator('.rich-text-font-size').selectOption('40');
  const template = '许愿{礼物}（{已收}/{目标}）';
  assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), template);
  const output = page.locator('#giftWishDraftPreview .wish-card-text-run').first();
  assert.match(await output.evaluate(node => getComputedStyle(node).fontFamily), /Lira Xiaolai/);
  assert.equal(await output.evaluate(node => getComputedStyle(node).fontSize), '40px');
  assert.deepEqual(await tokenStyles(), Array(3).fill(['40px', '400', 'italic', 'underline']));
  assert.deepEqual(await output.evaluate(node => {
    const style = getComputedStyle(node);
    return [style.fontWeight, style.fontStyle, style.textDecorationLine];
  }), ['400', 'italic', 'underline']);
  assert.ok(await editor.locator('[data-wish-token]').evaluateAll(tokens =>
    tokens.every(token => getComputedStyle(token).fontFamily.includes('Lira Xiaolai'))));
  await page.locator('#giftWishSave').click();
  const saved = await page.evaluate(() => window.wishSaves[0]);
  assert.equal(saved.textTemplate, template);
  assert.equal(saved.textRuns.map(run => run.text).join(''), template);
  assert.ok(saved.textRuns.every(run => run.fontFamily === '"Lira Xiaolai"' && run.bold === false
    && run.italic && run.underline && run.fontSize === 40 && !run.color));
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  assert.deepEqual(await tokenStyles(), Array(3).fill(['40px', '400', 'italic', 'underline']));
  await editor.focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('toolbar', { name: '文字格式' }).waitFor();
  assert.equal(await page.locator('.rich-text-font-family').inputValue(), '"Lira Xiaolai"');
  await page.getByRole('button', { name: '更多文字格式', exact: true }).click();
  await page.getByRole('button', { name: '清除格式', exact: true }).click();
  assert.equal(await editor.locator('[data-wish-token]').count(), 3);
  await page.locator('#giftWishSave').click();
  assert.ok((await page.evaluate(() => window.wishSaves[1].textRuns)).every(run => Object.keys(run).length === 1));
});

test('wish token insertion and plain paste inherit the caret formatting', async t => {
  const page = await open(t);
  await page.addStyleTag({ content: fs.readFileSync('public/css/admin/gift-wishes.css', 'utf8') });
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  const editor = page.locator('#giftWishTextEditor');
  await editor.fill('许愿');
  await page.keyboard.press('Control+a');
  await page.getByRole('toolbar', { name: '文字格式' }).waitFor();
  await page.locator('.rich-text-font-size').selectOption('40');
  await page.getByRole('button', { name: '斜体 (Ctrl+I)', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: '插入礼物名称', exact: true }).click();
  const token = editor.locator('[data-wish-token]');
  assert.deepEqual(await token.evaluate(node => {
    const style = getComputedStyle(node);
    return [style.fontSize, style.fontStyle];
  }), ['40px', 'italic']);
  await editor.evaluate(node => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '加油\n继续');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), '许愿{礼物}加油\n继续');
  const preview = page.locator('#giftWishDraftPreview .wish-card-text-run');
  assert.ok(await preview.evaluateAll(nodes => nodes.every(node => {
    const style = getComputedStyle(node);
    return style.fontSize === '40px' && style.fontStyle === 'italic';
  })));
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), '许愿{礼物}');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), '许愿{礼物}加油\n继续');
});

test('formatting one wish line preserves unselected lines and line breaks', async t => {
  const page = await open(t);
  await loadSharedFont(page);
  await page.addStyleTag({ content: fs.readFileSync('public/css/admin/gift-wishes.css', 'utf8').replace(/@import[^;]+;/g, '') });
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  const editor = page.locator('#giftWishTextEditor');
  await editor.fill('首行');
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.insertText('中间行');
  await editor.press('Enter');
  await page.keyboard.insertText('末行');
  const template = '首行\n中间行\n末行';
  assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), template);
  await editor.evaluate(node => {
    const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  await page.getByRole('toolbar', { name: '文字格式' }).waitFor();
  await page.locator('.rich-text-font-family').selectOption('"Lira Xiaolai"');
  assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), template);
  await page.locator('#giftWishSave').click();
  const runs = await page.evaluate(() => window.wishSaves[0].textRuns);
  assert.equal(runs.map(run => run.text).join(''), template);
  assert.equal(runs[0].fontFamily, '"Lira Xiaolai"');
  assert.ok(runs.slice(1).every(run => !run.fontFamily));
});

test('formatted wishes retain legacy image positions and literal text in the overlay', async t => {
  const page = await openOverlay(t, 'long', [], { displayStyle: 'text', textImagePosition: 'inline',
    textTemplate: '<b>想要</b>{礼物}', textRuns: [{ text: '<b>想要</b>{礼物}', fontFamily: '"Lira Xiaolai"', underline: true }] });
  assert.equal(await page.locator('.wish-card-text img').count(), 1);
  assert.equal(await page.locator('.wish-card-text').textContent(), '<b>想要</b>小花花');
  assert.equal(await page.locator('.wish-card-text b').count(), 0);
  assert.match(await page.locator('.wish-card-text-run').first().evaluate(node => getComputedStyle(node).fontFamily), /Lira Xiaolai/);
});

test('static text images are PNG first frames and today color follows today receipts even when the cumulative wish is complete', async (t) => {
  const page = await openOverlay(t, 'long', [], {
    displayStyle: 'text', imagePath: animatedWishImage, textImageFormat: 'static',
    textTemplate: '{图片}谢谢大家', completed: true, count: 12, todayCount: 1,
  });
  await page.addStyleTag({ content: fs.readFileSync('public/css/shared/gift-wish-card.css', 'utf8') });
  await page.waitForFunction(() => document.querySelector('.wish-card img')?.src.startsWith('data:image/png') && document.querySelector('.wish-card img').naturalWidth > 0);
  assert.deepEqual(await page.locator('.wish-card img').evaluate((image) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data];
  }), [255, 0, 0, 255], 'the first frame is red, not the second green frame');
  for (const [todayCount, color] of [[0, 'rgb(102, 51, 153)'], [1, 'rgb(180, 83, 9)']]) {
    await page.evaluate((todayCount) => {
      Object.assign(window.wishData.items[0], { todayCount, textPendingColor: '#663399', textReceivedColor: '#b45309' });
      window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
    }, todayCount);
    await page.waitForFunction((color) => getComputedStyle(document.querySelector('.wish-card-text')).color === color, color);
  }
});

test('static images remain PNG inside the opaque-origin browser-source sandbox', async (t) => {
  const page = await fixture(t, 'wish-sandbox');
  await page.route('**/js/shared/*.js', (route) => route.fulfill({
    contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' },
    body: fs.readFileSync(`public${new URL(route.request().url()).pathname}`, 'utf8'),
  }));
  await page.route('**/animated.webp', (route) => route.fulfill({
    contentType: 'image/webp', headers: { 'Access-Control-Allow-Origin': '*' },
    body: Buffer.from(animatedWishImage.split(',')[1], 'base64'),
  }));
  await page.setContent('<iframe sandbox="allow-scripts"></iframe>');
  const frame = page.frames()[1];
  await frame.setContent(`<script type="module">
    import { createGiftWishCard } from 'http://lira-ui.test/js/shared/gift-wish-card.js';
    document.body.append(createGiftWishCard({id:'one',period:'day',giftName:'花',count:1,target:10,
      displayStyle:'text',textTemplate:'{图片}{礼物}',textImageFormat:'static',
      imagePath:'http://lira-ui.test/animated.webp'}));
  </script>`);
  assert.equal(await frame.evaluate(() => origin), 'null');
  await frame.waitForFunction(() => document.querySelector('img')?.src.startsWith('data:image/png'), null, { timeout: 2000 });
});
