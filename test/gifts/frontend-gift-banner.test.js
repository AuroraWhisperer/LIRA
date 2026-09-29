'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');

const fixture = createUiFixture();
test('gift banners use the sender avatar proxy and distinguish captain from unknown identity', async (t) => {
  const page = await fixture(t, 'gift-display');
  const banners = await page.evaluate(async () => {
    const { createGiftBanner } = await import('/js/shared/gift-banner.js');
    window.__API_TOKEN__ = 'synthetic-overlay-token';
    return [3, 2, 1, 0, null].map((guardLevel) => {
      const banner = createGiftBanner(
        {
          eventId: String(guardLevel),
          gift: {
            giftId: 'sample',
            giftName: '舰长',
            userName: '测试观众',
            unitPrice: 2,
            num: 1,
            avatarUrl: 'https://i0.hdslb.com/bfs/face/synthetic.webp',
            guardLevel,
          },
        },
        { thresholds: [3000, 10000, 100000] },
      );
      const avatar = new URL(banner.querySelector('.gift-banner-avatar').src);
      return {
        path: avatar.pathname,
        source: avatar.searchParams.get('url'),
        token: avatar.searchParams.get('token'),
        frame: banner.querySelector('.gift-banner-frame')?.getAttribute('src') || null,
      };
    });
  });
  for (const banner of banners) {
    assert.equal(banner.path, '/api/bilibili/avatar');
    assert.equal(banner.source, 'https://i0.hdslb.com/bfs/face/synthetic.webp');
    assert.equal(banner.token, 'synthetic-overlay-token');
  }
  assert.deepEqual(
    banners.map((banner) => banner.frame),
    [
      '/img/overlays/danmaku-guard/bubble-captain-frame.webp',
      '/img/overlays/danmaku-guard/bubble-admiral-frame.webp',
      '/img/overlays/danmaku-guard/bubble-governor-frame.webp',
      null,
      null,
    ],
  );
});

test('gift banner updates retain images, patch rank and refit only changed text', async (t) => {
  const page = await fixture(t, 'gift-display');
  await page.setContent('<div id="stage"></div>');
  await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css/shared/gift-banner.css'), 'utf8') });
  const result = await page.evaluate(async () => {
    const { createGiftBanner, updateGiftBanner, fitGiftBannerNames } = await import('/js/shared/gift-banner.js');
    const config = { thresholds: [3000, 10000, 100000] };
    const item = {
      eventId: 'same',
      gift: {
        giftId: 'sample',
        giftName: '花',
        userName: '短昵称',
        unitPrice: 2,
        num: 1,
        guardLevel: 3,
        avatarUrl: 'https://i0.hdslb.com/bfs/face/old.webp',
      },
    };
    const row = createGiftBanner(item, config);
    document.getElementById('stage').append(row);
    const avatar = row.querySelector('.gift-banner-avatar');
    const artwork = row.querySelector('.gift-banner-artwork');
    const frame = row.querySelector('.gift-banner-frame');
    const next = {
      ...item,
      gift: {
        ...item.gift,
        userName: '较长的昵称'.repeat(15),
        giftName: '较长的礼物名'.repeat(15),
        num: 5,
        guardLevel: 2,
        avatarUrl: 'https://i0.hdslb.com/bfs/face/new.webp',
      },
    };
    const needsFit = updateGiftBanner(row, next, config);
    if (needsFit) fitGiftBannerNames(row);
    const changed = {
      needsFit,
      frameReused: frame === row.querySelector('.gift-banner-frame'),
      frameSource: frame.getAttribute('src'),
      avatarSource: new URL(avatar.src).searchParams.get('url'),
      textShrunk: parseFloat(getComputedStyle(row.querySelector('.gift-banner-name')).fontSize) < 24,
      count: row.querySelector('.gift-banner-count').textContent,
    };
    const short = { ...next, gift: { ...next.gift, userName: '短', giftName: '花', guardLevel: 0 } };
    if (updateGiftBanner(row, short, config)) fitGiftBannerNames(row);
    return {
      ...changed,
      frameRemoved: !row.querySelector('.gift-banner-frame'),
      imagesReused:
        avatar === row.querySelector('.gift-banner-avatar') && artwork === row.querySelector('.gift-banner-artwork'),
      shortNameSize: parseFloat(getComputedStyle(row.querySelector('.gift-banner-name')).fontSize),
    };
  });
  assert.deepEqual(result, {
    needsFit: true,
    frameReused: true,
    frameSource: '/img/overlays/danmaku-guard/bubble-admiral-frame.webp',
    avatarSource: 'https://i0.hdslb.com/bfs/face/new.webp',
    textShrunk: true,
    count: '×5',
    frameRemoved: true,
    imagesReused: true,
    shortNameSize: 24,
  });
});

test('gift banners fit long names and inset the avatar inside the rounded color bar', async (t) => {
  const page = await fixture(t, 'gift-display');
  await page.setContent('<div id="giftStylePreview" class="gift-banner-stage"></div>');
  await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css/shared/gift-banner.css'), 'utf8') });
  const layout = await page.evaluate(async () => {
    const { createGiftBanner, fitGiftBannerNames } = await import('/js/shared/gift-banner.js');
    const preview = document.getElementById('giftStylePreview');
    preview.replaceChildren(
      createGiftBanner(
        {
          eventId: 'long-name',
          gift: {
            giftId: 'sample',
            giftName: '长礼物名测试'.repeat(3),
            userName: '长昵称测试'.repeat(5),
            unitPrice: 2,
            num: 1,
          },
        },
        { thresholds: [10000, 50000, 100000] },
      ),
    );
    await document.fonts.ready;
    fitGiftBannerNames(preview);
    const banner = document.querySelector('#giftStylePreview .gift-banner');
    const bounds = banner.getBoundingClientRect();
    const text = banner.querySelector('.gift-banner-text').getBoundingClientRect();
    const artwork = banner.querySelector('.gift-banner-artwork').getBoundingClientRect();
    const avatar = banner.querySelector('.gift-banner-avatar').getBoundingClientRect();
    const bar = banner.querySelector('.gift-banner-background').getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      avatarWidth: avatar.width,
      avatarInsets: [avatar.left - bar.left, avatar.top - bar.top, bar.bottom - avatar.bottom],
      nameFits:
        banner.querySelector('.gift-banner-name').scrollWidth <= banner.querySelector('.gift-banner-name').clientWidth,
      nameShrinks: parseFloat(getComputedStyle(banner.querySelector('.gift-banner-name')).fontSize) < 24,
      giftFits:
        banner.querySelector('.gift-banner-gift').scrollWidth <= banner.querySelector('.gift-banner-gift').clientWidth,
      textClearsArtwork: text.right <= artwork.left,
      quantityFits: banner.querySelector('.gift-banner-count').getBoundingClientRect().right <= bounds.right,
      quantityBottomGap: bounds.bottom - banner.querySelector('.gift-banner-count').getBoundingClientRect().bottom,
    };
  });
  assert.deepEqual(layout, {
    width: 428,
    height: 72,
    avatarWidth: 56,
    avatarInsets: [4, 4, 4],
    nameFits: true,
    nameShrinks: true,
    giftFits: true,
    textClearsArtwork: true,
    quantityFits: true,
    quantityBottomGap: 4,
  });
});

test('gift names fit their full text at normal and PNG scale while short names keep their size', async (t) => {
  const page = await fixture(t, 'gift-display');
  await page.setContent('<div id="stage" class="gift-banner-stage"></div>');
  await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css/shared/gift-banner.css'), 'utf8') });
  const result = await page.evaluate(async () => {
    const { createGiftBanner, fitGiftBannerNames } = await import('/js/shared/gift-banner.js');
    await import('/js/overlays/gift-export.js');
    const names = [
      '短昵称',
      '中'.repeat(10),
      '很长的中文昵称'.repeat(6),
      'WideW_1234567890'.repeat(4),
      '观众🎉🚀_Viewer'.repeat(5),
    ];
    const items = names.map((userName, index) => ({
      eventId: String(index),
      gift: { giftId: 'sample', giftName: '礼物', userName, unitPrice: 2, num: 1 },
    }));
    const config = { thresholds: [10000, 50000, 100000] };
    const stage = document.getElementById('stage');
    const measure = () =>
      [...stage.querySelectorAll('.gift-banner-name')].map((name) => {
        const range = document.createRange();
        range.selectNodeContents(name);
        return {
          text: name.textContent,
          fontSize: parseFloat(getComputedStyle(name).fontSize),
          fits: range.getBoundingClientRect().width <= name.getBoundingClientRect().width,
        };
      });
    stage.replaceChildren(...items.map((item) => createGiftBanner(item, config)));
    fitGiftBannerNames(stage);
    const normal = measure();
    stage.style.transform = 'scale(2)';
    stage.style.transformOrigin = 'top left';
    const output = await window.renderGiftExport({ items, config, catalog: [], background: 'transparent' });
    return { names, normal, scaled: measure(), output };
  });
  assert.deepEqual(result.normal, result.scaled);
  assert.deepEqual(
    result.normal.map((name) => name.text),
    result.names,
  );
  assert.ok(result.normal.every((name) => name.fits));
  assert.equal(result.normal[0].fontSize, 24);
  assert.ok(result.normal.slice(1).every((name) => name.fontSize > 0 && name.fontSize < 24));
  assert.equal(result.output.width, 856);
});

test('long gift counts expand PNG and browser-source canvases without moving artwork or squeezing text', async (t) => {
  const page = await fixture(t, 'gift-display');
  await page.setContent('<div id="giftFeedViewport"><div id="stage" class="gift-banner-stage"></div></div>');
  await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css/shared/gift-banner.css'), 'utf8') });
  await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css/overlays/gift-feed.css'), 'utf8') });
  const result = await page.evaluate(async () => {
    await import('/js/overlays/gift-export.js');
    const stage = document.getElementById('stage');
    stage.style.transform = 'scale(2)';
    stage.style.transformOrigin = 'top left';
    const items = [1, 1234, 12345678, Number.MAX_SAFE_INTEGER].map((num) => ({
      eventId: String(num),
      gift: { giftId: 'sample', giftName: '测试礼物', userName: '测试观众', unitPrice: 2, num },
    }));
    const payload = { config: { thresholds: [10000, 50000, 100000] }, catalog: [], background: 'transparent' };
    const singles = [];
    for (const item of items) {
      singles.push(await window.renderGiftExport({ ...payload, items: [item] }));
    }
    const combined = await window.renderGiftExport({ ...payload, items });
    stage.style.transform = 'none';
    return {
      singles,
      combined,
      viewportWidth: document.getElementById('giftFeedViewport').getBoundingClientRect().width,
      rows: [...stage.children].map((row) => {
        const bounds = row.getBoundingClientRect();
        const text = row.querySelector('.gift-banner-text').getBoundingClientRect();
        const artwork = row.querySelector('.gift-banner-artwork').getBoundingClientRect();
        const count = row.querySelector('.gift-banner-count').getBoundingClientRect();
        return {
          width: bounds.width,
          artworkLeft: artwork.left - bounds.left,
          textWidth: text.width,
          barWidth: row.querySelector('.gift-banner-background').getBoundingClientRect().width,
          countLeft: count.left - bounds.left,
          countSize: getComputedStyle(row.querySelector('.gift-banner-count')).fontSize,
          rightPadding: bounds.right - count.right,
          artworkClear: artwork.right <= count.left,
        };
      }),
    };
  });
  assert.deepEqual(result.singles[0], { width: 856, height: 144 });
  assert.equal(result.rows[0].width, 428);
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows[index];
    assert.equal(result.singles[index].width, Math.ceil(row.width * 2));
    assert.equal(row.artworkLeft, result.rows[0].artworkLeft);
    assert.equal(row.textWidth, result.rows[0].textWidth);
    assert.equal(row.barWidth, result.rows[0].barWidth);
    assert.equal(row.countLeft, result.rows[0].countLeft);
    assert.equal(row.countSize, '28px');
    assert.ok(row.rightPadding >= 20);
    assert.ok(row.artworkClear);
    if (index) assert.ok(row.width > result.rows[index - 1].width);
  }
  assert.equal(result.combined.width, result.singles.at(-1).width);
  assert.equal(result.combined.height, 624);
  assert.equal(result.viewportWidth, result.rows.at(-1).width);
  assert.ok(result.viewportWidth <= 900);
});
