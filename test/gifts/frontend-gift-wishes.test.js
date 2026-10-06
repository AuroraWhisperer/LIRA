'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const fixture = createUiFixture();
const html = fs
  .readFileSync('public/pages/admin/toolbox/gift.html', 'utf8')
  .replace(
    '<!-- admin-fragment: pages/admin/toolbox/gift-wishes.html -->',
    fs.readFileSync('public/pages/admin/toolbox/gift-wishes.html', 'utf8'),
  );

async function open(t) {
  const page = await fixture(t, 'wishes');
  await page.route('**/js/shared/event-bus.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: fs.readFileSync('public/js/shared/event-bus.js', 'utf8'),
    }),
  );
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
  await page.waitForFunction(() => !document.getElementById('giftWishFields').disabled);
  return page;
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

for (const missingAbortMethods of [['any'], ['any', 'timeout']]) {
  for (const period of ['long', 'day', 'session']) {
    test(`${period} wishes load and update without AbortSignal ${missingAbortMethods.join(' or ')}`, async (t) => {
      const page = await openOverlay(t, period, missingAbortMethods);
      assert.equal(await page.locator('.wish-card').count(), 1);
      assert.equal(await page.locator('.wish-card').getAttribute('data-wish-id'), period);
      assert.equal(await page.locator('.wish-card-count').textContent(), '3');
      await page.evaluate((period) => {
        Object.assign(
          window.wishData.items.find((wish) => wish.period === period),
          {
            count: 10,
            progress: 100,
            completed: true,
          },
        );
        window.socketOptions.onMessage({
          type: 'snapshot',
          reason: 'gift:wishes',
          state: { gifts: { viewRevision: 'one' } },
        });
      }, period);
      await page.waitForFunction(() => document.querySelector('.wish-card-count').textContent === '10');
      assert.equal(await page.locator('.wish-card.is-complete').count(), 1);
      assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'), '10');
      assert.equal(await page.evaluate(() => window.wishRequests), 2);
    });
  }
}

test('unified wish source displays all periods and refreshes them together', async (t) => {
  const page = await openOverlay(t, null, ['any', 'timeout']);
  assert.equal(await page.title(), '礼物许愿 · LIRA');
  assert.deepEqual(await page.locator('.wish-card').evaluateAll((cards) => cards.map((card) => card.dataset.wishId)),
    ['long', 'day', 'session']);
  await page.evaluate(() => {
    for (const wish of window.wishData.items) Object.assign(wish, { count: 10, progress: 100, completed: true });
    window.wishData.session.state = 'offline';
    window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
  });
  await page.waitForFunction(() => document.querySelectorAll('.wish-card.is-complete').length === 3);
  assert.deepEqual(await page.locator('.wish-card-count').allTextContents(), ['10', '10', '10']);
  assert.equal(await page.locator('.wish-card').count(), 3);
  assert.equal(await page.locator('#giftWishOverlayStatus').textContent(), '还未开播，等待本场心愿开始。');
  assert.equal(await page.locator('#giftWishOverlayStatus').isHidden(), true);
  assert.equal(await page.evaluate(() => window.wishRequests), 2);
  await page.evaluate(() => {
    window.wishData.items = [];
    window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
  });
  await page.waitForFunction(() => document.querySelectorAll('.wish-card').length === 0);
  assert.equal(await page.locator('#giftWishOverlayStatus').textContent(), '还没有礼物许愿，请在礼物姬中添加。');
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
      assert.match(await page.locator('#giftWishOverlayStatus').textContent(), /Aborted/);
      await page.clock.runFor(3000);
      assert.equal(await page.locator('#giftWishOverlayStatus').textContent(), '');
      assert.equal(await page.evaluate(() => window.wishRequests), 3);
    } else {
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await page.clock.runFor(13000);
      assert.equal(await page.locator('#giftWishOverlayStatus').textContent(), '');
      assert.equal(await page.evaluate(() => window.wishRequests), 2);
    }
    assert.equal(await page.evaluate(() => window.pendingWishSignal.aborted), true);
  });
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
  await page.locator('#giftWishCards .wish-card').waitFor();
  assert.equal(await page.locator('#giftWishCards .wish-card').getAttribute('aria-label'), '长效许愿 · 小花花 · <img src=x>');
  assert.equal(await page.locator('#giftWishCards .wish-card img').count(), 1);
  assert.equal(await page.locator('#giftWishCards .wish-card-count').textContent(), '3');
  assert.equal(await page.locator('#giftWishCards [role=progressbar]').getAttribute('aria-valuenow'), '3');
  assert.equal(await page.evaluate(() => window.wishSaves[0].giftKey), 'flower-v1');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#giftWishTarget').fill('20');
  await page.locator('#giftWishSave').click();
  await page.waitForFunction(() => document.querySelector('#giftWishCards .wish-card-target').textContent.includes('20'));
  assert.equal(await page.locator('#giftWishCards .wish-card-count').textContent(), '3');
  assert.equal(await page.evaluate(() => window.wishSaves[1].id), 'new');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('giftWishEmpty').hidden === false);
  assert.equal(await page.locator('#giftWishCards .wish-card').count(), 0);
});

test('period selection keeps the unified browser-source URL and source changes discard an in-progress edit', async (t) => {
  const page = await open(t);
  await page.evaluate(async () => {
    const { enhanceSelects } = await import('/js/shared/select-menu.js');
    enhanceSelects();
  });
  const url = await page.locator('#giftWishUrl').inputValue();
  assert.match(url, /\/gift-wishes$/);
  for (const [period, label] of [['day', '本日许愿'], ['session', '本场直播许愿'], ['long', '长效许愿']]) {
    await page.getByRole('button', { name: '许愿统计周期', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    assert.equal(await page.locator('#giftWishPeriod').inputValue(), period);
    assert.equal(await page.locator('#giftWishDraftPreview .wish-card').getAttribute('aria-label'), `${label} · 礼物`);
    assert.equal(await page.locator('#giftWishUrl').inputValue(), url);
  }
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await page.locator('#giftWishTarget').fill('99');
  await page.evaluate(() => {
    window.wishData.viewRevision = 'other';
  });
  await page.locator('#giftWishesRefresh').click();
  await page.waitForFunction(() => document.getElementById('giftWishSelectedName').textContent === '选个礼物');
  assert.equal(await page.locator('#giftWishTarget').inputValue(), '10');
});

test('room picker distinguishes blind boxes and outputs without relationship metadata', async (t) => {
  const page = await open(t);
  for (const [category, label] of [
    ['blindBox', '盲盒本体'],
    ['blindBoxOutput', '盲盒产出'],
  ]) {
    await page.evaluate((value) => {
      window.catalogGift.giftCategory = value;
    }, category);
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

test('custom text uses the selected gift and switches between all three styles without losing progress', async (t) => {
  const page = await open(t);
  const draft = page.locator('#giftWishDraftPreview');
  const saved = page.locator('#giftWishCards');
  assert.equal(await page.locator('#giftWishesSummary, .gift-wish-preview-note').count(), 0);
  assert.equal(await page.locator('#giftWishTextFields').isVisible(), false);
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  assert.equal(await draft.locator('.wish-card-image').getAttribute('alt'), '小花花');
  assert.equal(await draft.locator('.wish-card-track').count(), 1);
  await page.getByRole('radio', { name: '圆形徽章', exact: true }).check();
  assert.equal(await draft.locator('.wish-card--circle').count(), 1);
  assert.equal(await draft.locator('.wish-card-total').textContent(), '0/10');
  assert.equal(await draft.locator('.wish-card-track').count(), 0);
  assert.equal(await page.evaluate(() => window.wishSaves.length), 0);
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  assert.equal(await draft.textContent(), '许愿小花花（0/10）');
  assert.equal(await page.locator('#giftWishTextEditor [data-wish-token="{礼物}"]').textContent(), '礼物名称·小花花');
  assert.equal(await draft.locator('img, [role=progressbar]').count(), 0);
  await page.locator('#giftWishTextEditor').fill('今天想要');
  await page.getByRole('button', { name: '插入礼物名称', exact: true }).click();
  assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), '今天想要{礼物}');
  await page.locator('#giftWishTextEditor').fill('今天想要{礼物}\n已收 {已收} / {目标}');
  await page.locator('#giftWishSave').click();
  await saved.locator('.wish-card-text').waitFor();
  assert.equal(await saved.locator('.wish-card-text').textContent(), '今天想要小花花\n已收 3 / 10');
  assert.equal(await saved.locator('img, [role=progressbar]').count(), 0);
  assert.equal(await page.evaluate(() => window.wishSaves[0].displayStyle), 'text');
  assert.equal(await page.evaluate(() => window.wishSaves[0].giftKey), 'flower-v1');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: '文字版', exact: true }).isChecked(), true);
  assert.equal(await page.locator('#giftWishTextEditor [data-wish-token="{已收}"]').textContent(), '已收数量·3');
  await page.locator('#giftWishTarget').fill('20');
  assert.equal(await page.locator('#giftWishTextEditor [data-wish-token="{目标}"]').textContent(), '目标数量·20');
  assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), '今天想要{礼物}\n已收 {已收} / {目标}');
  assert.equal(await draft.textContent(), '今天想要小花花\n已收 3 / 20');
  await page.getByRole('radio', { name: '礼物卡片', exact: true }).check();
  assert.equal(await page.locator('#giftWishTextFields').isVisible(), false);
  assert.equal(await draft.locator('.wish-card-fill').evaluate((element) => element.style.transform), 'scaleX(0.15)');
  assert.equal(await saved.locator('.wish-card-text').textContent(), '今天想要小花花\n已收 3 / 10');
  await page.locator('#giftWishSave').click();
  await saved.locator('.wish-card-count').waitFor();
  assert.equal(await saved.locator('.wish-card-count').textContent(), '3');
  assert.match(await saved.locator('.wish-card-target').textContent(), /20/);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('radio', { name: '圆形徽章', exact: true }).check();
  assert.equal(await page.locator('#giftWishTextFields').isVisible(), false);
  assert.equal(await draft.locator('.wish-card--circle').count(), 1);
  await page.locator('#giftWishTarget').fill('2');
  assert.equal(await draft.locator('.wish-card.is-complete').count(), 1);
  assert.equal(await draft.locator('[role=progressbar]').getAttribute('aria-valuenow'), '2');
  await page.locator('#giftWishTarget').fill('20');
  await page.locator('#giftWishSave').click();
  await saved.locator('.wish-card--circle').waitFor();
  assert.equal(await saved.locator('.wish-card-total').textContent(), '3/20');
  assert.equal(await saved.locator('.wish-card-circle img').count(), 1);
  assert.equal(await saved.locator('.wish-card-track').count(), 0);
  assert.equal(await page.evaluate(() => window.wishSaves[2].displayStyle), 'circle');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: '圆形徽章', exact: true }).isChecked(), true);
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  assert.equal(await page.locator('#giftWishTextTemplate').inputValue(), '今天想要{礼物}\n已收 {已收} / {目标}');
  await page.locator('#giftWishCancel').click();
  assert.equal(await page.getByRole('radio', { name: '礼物卡片', exact: true }).isChecked(), true);
  assert.equal(await page.locator('#giftWishTextFields').isVisible(), false);
  assert.equal(await draft.locator('.wish-card-count').textContent(), '0');
  assert.equal(await saved.locator('.wish-card--circle').count(), 1);
});

test('circle overlay displays the gift WebP and updates numeric progress on completion', async (t) => {
  const imagePath = `data:image/webp;base64,${fs.readFileSync('public/img/admin/gifts/bilibili-guard-captain.webp').toString('base64')}`;
  const page = await openOverlay(t, 'long', [], { displayStyle: 'circle', imagePath, target: 20, progress: 15 });
  await page.addStyleTag({ content: fs.readFileSync('public/css/shared/gift-wish-card.css', 'utf8') });
  await page.waitForFunction(() => document.querySelector('.wish-card-circle img')?.naturalWidth > 0);
  assert.equal(await page.locator('.wish-card-image').getAttribute('src'), imagePath);
  assert.equal(await page.locator('.wish-card-total').textContent(), '3/20');
  assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'), '3');
  assert.equal(await page.locator('.wish-card-track, .wish-card-text').count(), 0);
  await page.evaluate(() => {
    Object.assign(window.wishData.items[0], { count: 23, progress: 100, completed: true });
    window.socketOptions.onMessage({
      type: 'snapshot',
      reason: 'gift:wishes',
      state: { gifts: { viewRevision: 'one' } },
    });
  });
  await page.waitForFunction(() => document.querySelector('.wish-card-total').textContent === '23/20');
  assert.equal(await page.locator('.wish-card--circle.is-complete').count(), 1);
  assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'), '20');
  assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuetext'), '已收集 23 个，目标 20 个');
});

test('new wishes offer built-in styles and keep collected gifts when reopened', async (t) => {
  const page = await open(t);
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  assert.equal(await page.getByRole('radio', { name: '月渡花汀', exact: true }).count(), 0);
  assert.equal(await page.getByRole('radio', { name: '礼物卡片', exact: true }).isChecked(), true);
  await page.locator('#giftWishSave').click();
  await page.locator('#giftWishCards .wish-card').waitFor();
  assert.equal(await page.evaluate(() => window.wishSaves[0].displayStyle), 'card');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: '礼物卡片', exact: true }).isChecked(), true);
  assert.equal(await page.locator('#giftWishDraftPreview .wish-card-count').textContent(), '3');
});

test('moonlit progress updates in place, clamps overflow and stops decorative motion when requested', async (t) => {
  const page = await openOverlay(t, 'long', [], { displayStyle: 'moonlit', count: 0, progress: 0 });
  await page.addStyleTag({ content: fs.readFileSync('public/css/shared/gift-wish-card.css', 'utf8').replace(/^@import[^;]+;/, '')
    + fs.readFileSync('public/css/shared/gift-wish-moonlit.css', 'utf8') });
  const track = page.locator('.wish-moon-track');
  await track.waitFor();
  await page.evaluate(() => { window.originalWish = document.querySelector('.wish-card'); });
  assert.equal(await page.locator('.wish-card.is-empty').count(), 1);
  for (const count of [4, 13]) {
    await page.evaluate(count => {
      Object.assign(window.wishData.items[0], { count, progress: Math.min(100, count * 10), completed: count >= 10 });
      window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
    }, count);
    await page.waitForFunction(count => document.querySelector('.wish-card-count').textContent === String(count), count);
    assert.equal(await page.evaluate(() => window.originalWish === document.querySelector('.wish-card')), true);
    assert.equal(await track.getAttribute('aria-valuenow'), String(Math.min(count, 10)));
    assert.equal(await page.locator('.wish-moon-fill').evaluate(el => el.style.width), `${Math.min(count * 10, 100)}%`);
  }
  assert.equal(await page.locator('.wish-card--moonlit.is-complete').count(), 1);
  assert.equal(await page.locator('.wish-card').count(), 1);
  assert.equal(await page.evaluate(() => window.wishRequests), 3);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.wish-moon-petal').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('.wish-moon-fill').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await page.evaluate(() => {
    window.wishData.items[0].giftName = '<img src=x onerror=alert(1)>';
    window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
  });
  await page.waitForFunction(() => document.querySelector('.wish-moon-name').textContent.startsWith('<img'));
  assert.equal(await page.locator('.wish-moon-name img').count(), 0);
});

for (const period of ['long', 'day', 'session']) {
  test(`${period} text overlay renders custom text safely and updates without modern AbortSignal methods`, async (t) => {
    const page = await openOverlay(t, period, ['any', 'timeout'], {
      displayStyle: 'text',
      textTemplate: '<b>想要{礼物}</b>\n{已收}/{目标} {未知}',
    });
    assert.equal(await page.locator('.wish-card-text').textContent(), '<b>想要小花花</b>\n3/10 {未知}');
    assert.equal(await page.locator('.wish-card img, .wish-card b, .wish-card [role=progressbar]').count(), 0);
    await page.evaluate(() => {
      for (const wish of window.wishData.items) {
        Object.assign(wish, { textTemplate: '', count: 12, progress: 100, completed: true });
      }
      window.socketOptions.onMessage({
        type: 'snapshot',
        reason: 'gift:wishes',
        state: { gifts: { viewRevision: 'one' } },
      });
    });
    await page.waitForFunction(() => document.querySelector('.wish-card-text').textContent === '许愿小花花（12/10）');
    assert.equal(await page.locator('.wish-card.is-complete').count(), 1);
  });
}

const animatedWishImage = 'data:image/webp;base64,UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAwAAAwAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAAJWUDhMDwAAAC8DwAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAABWUDhMDwAAAC8DwAAAB9D/iP4HIqL/AQA=';

test('image tokens insert at the cursor, move, persist and disappear when deleted', async (t) => {
  const page = await open(t);
  await page.evaluate((imagePath) => { window.catalogGift.imagePath = imagePath; }, animatedWishImage);
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  const draft = page.locator('#giftWishDraftPreview');
  const saved = page.locator('#giftWishCards');
  const input = page.locator('#giftWishTextEditor');
  const templateInput = page.locator('#giftWishTextTemplate');
  assert.equal(await page.locator('#giftWishImageFields').isVisible(), false);
  assert.equal(await page.locator('#giftWishTextImageFormat').isVisible(), false);
  await input.press('Control+Home');
  await page.getByRole('button', { name: '插入礼物图片', exact: true }).click();
  assert.equal(await templateInput.inputValue(), '{图片}许愿{礼物}（{已收}/{目标}）');
  assert.equal(await draft.locator('.wish-card-text').evaluate((node) => node.firstChild.tagName), 'IMG');
  assert.equal(await page.locator('#giftWishTextImageFormat').isVisible(), true);
  assert.equal(await draft.locator('img').getAttribute('src'), animatedWishImage);
  await input.fill('许愿{礼物}（{已收}/{目标}）{图片}');
  assert.equal(await draft.locator('.wish-card-text').evaluate((node) => node.lastChild.tagName), 'IMG');
  await input.fill('<b>想要</b>{礼物}，再来一个{礼物}\n{已收}/{目标}');
  await input.press('Control+Home');
  for (let index = 0; index < 9; index++) await input.press('ArrowRight');
  await page.getByRole('button', { name: '插入礼物图片', exact: true }).click();
  const template = '<b>想要</b>{图片}{礼物}，再来一个{礼物}\n{已收}/{目标}';
  assert.equal(await templateInput.inputValue(), template);
  assert.equal(await draft.locator('.wish-card-text img').count(), 1);
  assert.equal(await draft.locator('b').count(), 0);
  assert.equal(await draft.locator('.wish-card-text').evaluate((node) => node.firstChild.textContent), '<b>想要</b>');
  await page.locator('#giftWishTextImageFormat').selectOption('static');
  await page.waitForFunction(() => document.querySelector('#giftWishDraftPreview img')?.src.startsWith('data:image/png'));
  await page.locator('#giftWishSave').click();
  await saved.locator('.wish-card-text img').waitFor();
  assert.equal(await saved.locator('.is-received-today').count(), 1);
  assert.deepEqual(await page.evaluate(() => {
    const { textImagePosition, textImageFormat, textTemplate } = window.wishSaves[0];
    return { textImagePosition, textImageFormat, textTemplate };
  }), { textImagePosition: 'none', textImageFormat: 'static', textTemplate: template });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await templateInput.inputValue(), template);
  assert.equal(await page.locator('#giftWishTextImageFormat').inputValue(), 'static');
  await input.fill(template.replace('{图片}', ''));
  assert.equal(await draft.locator('img').count(), 0);
  assert.equal(await page.locator('#giftWishImageFields').isVisible(), false);
  assert.equal(await saved.locator('img').count(), 1);
  await page.locator('#giftWishSave').click();
  await page.waitForFunction(() => !document.querySelector('#giftWishCards img'));
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await templateInput.inputValue(), template.replace('{图片}', ''));
  await page.locator('#giftWishCancel').click();
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  assert.equal(await templateInput.inputValue(), '许愿{礼物}（{已收}/{目标}）');
  assert.equal(await page.locator('#giftWishTextImageFormat').inputValue(), 'animated');
});

test('legacy image positions convert when edited without losing long text or duplicating explicit tokens', async (t) => {
  const page = await open(t);
  for (const [position, template, expected] of [
    ['before', '字'.repeat(200), `{图片}${'字'.repeat(200)}`],
    ['after', '想要{礼物}', '想要{礼物}{图片}'],
    ['inline', '想要{礼物}和{礼物}', '想要{图片}{礼物}和{礼物}'],
    ['inline', '谢谢', '{图片}谢谢'],
    ['before', '想要{礼物}{图片}', '想要{礼物}{图片}'],
    ['after', '{图片}{礼物}{图片}', '{图片}{礼物}{图片}'],
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

test('wish text chips insert, delete and restore as a whole through native undo and redo', async (t) => {
  const page = await open(t);
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  const editor = page.locator('#giftWishTextEditor');
  const value = () => page.locator('#giftWishTextTemplate').inputValue();
  const original = await value();
  await page.evaluate(() => {
    window.templateChanges = 0;
    document.getElementById('giftWishTextTemplate').addEventListener('input', () => window.templateChanges++);
  });
  assert.equal(await editor.locator('[contenteditable=false]').count(), 3);
  assert.deepEqual(await editor.locator('[data-wish-token]').allTextContents(), ['礼物名称·未选择', '已收数量·0', '目标数量·10']);
  await editor.press('Control+Home');
  await page.getByRole('button', { name: '插入礼物图片', exact: true }).click();
  assert.equal(await value(), `{图片}${original}`);
  assert.equal(await editor.locator('[data-wish-token="{图片}"]').textContent(), '礼物图片·未选择');
  assert.equal(await page.evaluate(() => window.templateChanges), 1);
  await editor.press('Control+z');
  assert.equal(await value(), original);
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await editor.press('Control+y');
  assert.equal(await value(), `{图片}${original}`);
  assert.equal(await editor.locator('[data-wish-token="{图片}"]').textContent(), '礼物图片·小花花');
  assert.equal(await editor.locator('[data-wish-token="{礼物}"]').textContent(), '礼物名称·小花花');
  assert.equal(await page.evaluate(() => window.templateChanges), 3);
  await editor.press('Control+Home');
  await editor.press('Delete');
  assert.equal(await value(), original);
  await editor.press('Control+z');
  assert.equal(await value(), `{图片}${original}`);
  await editor.locator('[data-wish-token="{礼物}"]').click();
  await editor.press('Backspace');
  assert.equal(await value(), `{图片}${original.replace('{礼物}', '')}`);
  await editor.press('Control+z');
  assert.equal(await value(), `{图片}${original}`);
  await editor.press('Control+End');
  await editor.press('Enter');
  await page.keyboard.insertText('谢谢大家');
  assert.equal(await value(), `{图片}${original}\n谢谢大家`);
  assert.equal(await page.locator('#giftWishDraftPreview .wish-card-text').textContent(), '许愿小花花（0/10）\n谢谢大家');
  await editor.press('Control+z');
  assert.equal((await value()).includes('谢谢大家'), false);
  await page.getByRole('combobox', { name: '许愿统计周期' }).selectOption('day');
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  await editor.press('Control+z');
  assert.equal(await value(), original);
});

test('wish text clipboard preserves complete tokens, treats HTML as text and supports undoing cut and paste', async (t) => {
  const page = await open(t);
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  const editor = page.locator('#giftWishTextEditor');
  const value = () => page.locator('#giftWishTextTemplate').inputValue();
  // Selecting a token's display suffix must copy/cut the complete variable.
  const copyOrCut = (type) => editor.evaluate((node, type) => {
    const text = node.querySelector('[data-wish-token="{礼物}"]').firstChild;
    const range = document.createRange();
    range.setStart(text, text.length - 2);
    range.setEnd(text, text.length);
    node.focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    const clipboardData = new DataTransfer();
    node.dispatchEvent(new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true }));
    return clipboardData.getData('text/plain');
  }, type);
  assert.equal(await copyOrCut('copy'), '{礼物}');
  assert.equal(await copyOrCut('cut'), '{礼物}');
  assert.equal(await value(), '许愿（{已收}/{目标}）');
  await editor.press('Control+z');
  assert.equal(await value(), '许愿{礼物}（{已收}/{目标}）');
  await editor.press('Control+End');
  await editor.evaluate((node) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '\n<b>谢谢</b>{图片}{礼物}{未知}');
    clipboardData.setData('text/html', '<img src=x onerror="window.pasteExecuted=true">');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  assert.equal(await value(), '许愿{礼物}（{已收}/{目标}）\n<b>谢谢</b>{图片}{礼物}{未知}');
  assert.equal(await editor.locator('[contenteditable=false]').count(), 5);
  assert.equal(await editor.locator('b, img').count(), 0);
  assert.equal(await page.evaluate(() => !!window.pasteExecuted), false);
  await editor.press('Control+z');
  assert.equal(await value(), '许愿{礼物}（{已收}/{目标}）');
  await editor.press('Control+Shift+z');
  assert.equal(await editor.locator('[contenteditable=false]').count(), 5);
});

test('wish text editing locks with the form and reports the existing template length limit before saving', async (t) => {
  const page = await open(t);
  await page.locator('#giftWishPick').click();
  await page.locator('.gift-wish-option').click();
  await page.getByRole('radio', { name: '文字版', exact: true }).check();
  const editor = page.locator('#giftWishTextEditor');
  await editor.fill('字'.repeat(241));
  await page.locator('#giftWishSave').click();
  assert.match(await page.locator('#giftWishError').textContent(), /240/);
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

test('static text images are PNG first frames and today color resets even when the cumulative wish is complete', async (t) => {
  const page = await openOverlay(t, 'long', [], {
    displayStyle: 'text', imagePath: animatedWishImage, textImageFormat: 'static',
    textTemplate: '{图片}谢谢大家\n{已收}/{目标}', completed: true, count: 12, todayCount: 1,
  });
  await page.addStyleTag({ content: fs.readFileSync('public/css/shared/gift-wish-card.css', 'utf8') });
  await page.waitForFunction(() => document.querySelector('.wish-card img')?.src.startsWith('data:image/png') && document.querySelector('.wish-card img').naturalWidth > 0);
  const png = await page.locator('.wish-card img').getAttribute('src');
  assert.equal(await page.locator('.wish-card-text').evaluate((node) => node.firstChild.tagName), 'IMG');
  assert.deepEqual(await page.locator('.wish-card img').evaluate((image) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data];
  }), [255, 0, 0, 255], 'the first frame is red, not the second green frame');
  assert.equal(await page.locator('.wish-card-text').evaluate((node) => getComputedStyle(node).color), 'rgb(33, 129, 92)');
  await page.evaluate(() => {
    window.wishData.items[0].todayCount = 0;
    window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
  });
  await page.waitForFunction(() => !document.querySelector('.is-received-today') && document.querySelector('.wish-card img')?.src.startsWith('data:image/png'));
  assert.equal(await page.locator('.wish-card img').getAttribute('src'), png);
  assert.equal(await page.locator('.wish-card.is-complete').count(), 1);
  assert.equal(await page.locator('.wish-card-text').evaluate((node) => getComputedStyle(node).color), 'rgb(59, 110, 168)');
  await page.evaluate(() => {
    Object.assign(window.wishData.items[0], { count: 1, completed: false, todayCount: 1, textImageFormat: 'animated', textTemplate: '谢谢大家{图片}' });
    window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
  });
  await page.waitForFunction(() => document.querySelector('.is-received-today img')?.src.startsWith('data:image/webp'));
  assert.equal(await page.locator('.wish-card.is-complete').count(), 0);
  assert.equal(await page.locator('.wish-card-text > :last-child').getAttribute('src'), animatedWishImage);
  assert.equal(await page.locator('.wish-card-text').evaluate((node) => getComputedStyle(node).color), 'rgb(33, 129, 92)');
  for (const [todayCount, color] of [[0, 'rgb(102, 51, 153)'], [1, 'rgb(180, 83, 9)']]) {
    await page.evaluate((todayCount) => {
      Object.assign(window.wishData.items[0], { todayCount, textPendingColor: '#663399', textReceivedColor: '#b45309' });
      window.socketOptions.onMessage({ type: 'snapshot', reason: 'gift:wishes', state: { gifts: { viewRevision: 'one' } } });
    }, todayCount);
    await page.waitForFunction((color) => getComputedStyle(document.querySelector('.wish-card-text')).color === color, color);
    assert.equal(await page.locator('.wish-card-text').textContent(), '谢谢大家');
  }
});

test('a missing static image falls back to the existing placeholder without showing an animation', async (t) => {
  const page = await openOverlay(t, 'day', [], {
    displayStyle: 'text', imagePath: '/missing.webp', textTemplate: '{图片}许愿{礼物}（{已收}/{目标}）', textImageFormat: 'static',
  });
  await page.waitForFunction(() => document.querySelector('.wish-card img')?.getAttribute('src') === '/img/gift-placeholder.png');
  assert.equal(await page.locator('.wish-card-text').textContent(), '许愿小花花（3/10）');
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
