'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { sceneExtraPreviewData } = require('../../public/js/admin/scene-extra-preview-data.js');

test('canvas library saves every new variant with independent parameters and renders real output at saved sizes', { timeout: 120000 }, async (t) => {
  const data = Object.fromEntries(['songlist', 'lyrics', 'games', 'wheel', 'interactions', 'gift-feed', 'blindbox', 'gift-wishes']
    .map((type) => [type, sceneExtraPreviewData(type)]));
  let activeGame = data.games.sessions['number-bomb'];
  data.songlist.songs[0].name = '实时歌曲';
  const avatarUrl = 'https://i0.hdslb.com/bfs/face/canvas-test.webp';
  data['gift-feed'].items.forEach((item) => { item.gift.avatarUrl = avatarUrl; });
  data.games.sessions['draw-guess'].danmaku = [{ id: 'canvas-danmaku', name: '合成观众', message: '猜一个答案', avatarUrl }];
  const extraContext = {
    songs: { list: () => data.songlist.songs },
    games: { getSession: () => activeGame }, wheel: { getState: () => data.wheel },
    interactions: { getState: () => ({ runtimeId: 'live', revision: 1, session: data.interactions.sessions.poll }) },
    gifts: { getViewRevision: () => 'synthetic-gifts', getBlindBoxStats: () => data.blindbox,
      getHistory: () => ({ items: data['gift-feed'].items, viewRevision: 'synthetic-gifts', nextCursor: null, partial: false }) },
    giftWishes: { getSnapshot: async () => data['gift-wishes'] },
    giftCards: { getProfiles: async () => ({ items: [], day: data['gift-feed'].day, viewRevision: 'synthetic-gifts' }) },
    overtime: { getGlobalGiftCatalog: () => ({ gifts: [] }) },
  };
  const fixture = await startCanvasOutputFixture({ extraContext });
  Object.assign(fixture.runtime, data.lyrics);
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.route(avatarUrl, (route) => route.fulfill({ status: 200, contentType: 'image/webp',
    body: fs.readFileSync(path.resolve('public/img/overlays/danmaku-ranked/viewer.webp')) }));
  await context.addInitScript(() => { navigator.clipboard.writeText = async (value) => { window.copiedSource = value; }; });
  const page = await context.newPage();
  const errors = [];
  const childRequests = [];
  for (const target of [page, desktop]) target.on('pageerror', (error) => errors.push(error.message));
  context.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.frame().parentFrame()) childRequests.push(request.url());
  });
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []);
    assert.deepEqual(childRequests, [], 'sandboxed renderers never request management or overlay APIs'); });
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  const pickerCases = [
    ['danmaku', null, ['bubble', 'signal', 'minimal', 'ranked', 'transparent', 'identity', 'outline', 'cream', 'glow']],
    ['clock', null, ['peach', 'starlight', 'soda', 'timeline-horizontal', 'timeline-vertical', 'digital', 'orbit', 'flip']],
    ['queue', null, ['classic', 'identity', 'storybook', 'neon-vinyl', 'cherry-ribbon', 'golden-lily']],
    ['overtime', null, ['default']],
    ['songlist', null, ['default']],
    ['lyrics', null, ['default']],
    ['直播小游戏', '直播间互动', ['number-bomb', 'gomoku', 'draw-guess']],
    ['直播小游戏', '转盘', ['default']],
    ['直播小游戏', '投票与评分', ['poll', 'rating']],
    ['gift-feed', null, ['default']],
    ['blindbox', null, ['default']],
    ['gift-wishes', null, ['card', 'text', 'circle']],
    ['queue', null, ['classic', 'identity', 'storybook', 'neon-vinyl', 'cherry-ribbon', 'golden-lily']],
  ];
  const thumbnailSources = new Set();
  for (const [category, subcategory, variants] of pickerCases) {
    await picker.locator(`[data-category="${category}"]`).click();
    if (subcategory) await picker.locator('.preview-picker-subcategories').getByRole('button', { name: subcategory, exact: true }).click();
    const cards = picker.locator('[data-picker-style]');
    assert.deepEqual(await cards.evaluateAll((buttons) => buttons.map((button) => button.dataset.pickerStyle)), variants,
      `${subcategory || category} shows each style once, including after switching categories`);
    assert.equal(await picker.getByRole('button', { name: /^添加.+/ }).count(), variants.length);
    assert.equal(await picker.locator('iframe').count(), 0, 'the library uses thumbnails without starting live renderers');
    for (const card of await cards.all()) {
      await card.scrollIntoViewIfNeeded();
      assert.equal(await card.locator('img').count(), 1);
      await card.locator('img').evaluate((image) => image.decode());
      thumbnailSources.add(await card.locator('img').getAttribute('src'));
    }
  }
  assert.equal(thumbnailSources.size, 37, 'every style has its own preview image');
  await picker.getByRole('button', { name: '关闭', exact: true }).click();
  const cases = [
    ['songlist', null, 'default', 'songBoardTitle', '我的歌单'],
    ['lyrics', null, 'default', 'desktopLyricFontSize', '64'],
    ['games', '直播间互动', 'number-bomb', 'opacity', '0.8'],
    ['games', '直播间互动', 'gomoku', 'opacity', '0.7'],
    ['games', '直播间互动', 'draw-guess', 'opacity', '0.6'],
    ['wheel', '转盘', 'default', 'labelFontSize', '24'],
    ['interactions', '投票与评分', 'poll', 'interactionOverlayTitle', '实时投票'],
    ['interactions', '投票与评分', 'rating', 'interactionOverlayTitle', '实时评分'],
    ['gift-feed', null, 'default', 'scrollSpeed', '40'],
    ['blindbox', null, 'default', 'top', '5'],
    ['gift-wishes', null, 'card', 'gap', '20'],
    ['gift-wishes', null, 'text', 'gap', '16'],
    ['gift-wishes', null, 'circle', 'gap', '8'],
  ];
  const previews = { songlist: '.song-card', lyrics: '.desktop-lyric-preview-row',
    'number-bomb': '#bombNumbers button', gomoku: '#gomokuBoard button', 'draw-guess': '#drawCanvas',
    wheel: '#wheelSegments path', poll: '.interaction-row', rating: '#interactionAverage',
    'gift-feed': '.gift-banner', blindbox: '.leaderboard-row', 'gift-wishes': '.wish-card' };
  for (const [type, subcategory, variant, key, value] of cases) {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator(`[data-category="${subcategory ? '直播小游戏' : type}"]`).click();
    if (subcategory) await page.locator('.preview-picker-subcategories').getByRole('button', { name: subcategory, exact: true }).click();
    await page.locator(`[data-picker-style="${variant}"]`).click();
    await page.waitForFunction(() => document.querySelector('.scene-editor-item.is-selected .component-preview-load-state')?.hidden);
    const preview = page.frameLocator('.scene-editor-item.is-selected iframe');
    await preview.locator(previews[variant] || previews[type]).first().waitFor({ state: 'visible' });
    const input = page.locator(`[data-component-parameter="${key}"]`);
    await input.fill(value); await input.press('Tab');
    for (const [name, size] of [['宽度', '400'], ['高度', '300']]) {
      const dimension = page.getByRole('spinbutton', { name, exact: true });
      await dimension.fill(size); await dimension.press('Tab');
    }
  }
  assert.equal(await page.locator('.scene-editor-item').count(), cases.length);
  assert.deepEqual(childRequests, [], 'sandboxed previews never request management or overlay APIs');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.preview-canvas-status').textContent.includes('已保存并应用'));
  const saved = fixture.service.list()[0];
  assert.equal(saved.document.items.length, cases.length);
  saved.document.items.forEach((item, index) => {
    assert.equal(item.type, cases[index][0]);
    assert.equal(String(item.appearance.config[cases[index][3]]), cases[index][4]);
    assert.equal(item.appearance.mode, 'independent');
    assert.deepEqual([item.width, item.height], [400, 300]);
  });
  await page.reload();
  await page.waitForFunction((count) => document.querySelectorAll('.scene-editor-item').length === count, cases.length);
  const sizes = await page.locator('.scene-editor-item').evaluateAll((items) => items.map((item) => [item.style.width, item.style.height]));
  assert.ok(sizes.every(([width, height]) => width === '400px' && height === '300px'));
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="直播小游戏"]').click();
  assert.equal(await page.locator('.preview-picker-subcategories button').count(), 3);
  fs.mkdirSync(path.resolve('tmp/canvas-component-library'), { recursive: true });
  await page.screenshot({ path: path.resolve('tmp/canvas-component-library/picker.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const source = fixture.service.getSource(saved.document.id);
  const output = await context.newPage();
  output.on('pageerror', (error) => errors.push(error.message));
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  await output.goto(outputUrl);
  await output.waitForFunction((count) => document.querySelectorAll('.scene-version:not(.is-staging) iframe').length === count, cases.length);
  const songFrame = output.frameLocator('iframe[src^="/songlist"]');
  await songFrame.getByText('实时歌曲', { exact: true }).waitFor();
  assert.equal(await songFrame.locator('#songBoardTitle').textContent(), '我的歌单');
  const frames = await output.locator('.scene-version iframe').evaluateAll((items) => items.map((item) => [item.style.width, item.style.height, item.getAttribute('sandbox')]));
  assert.ok(frames.every(([width, height, sandbox]) => width === '400px' && height === '300px' && sandbox === 'allow-scripts'));
  const bomb = output.frameLocator('iframe[src^="/games"]').nth(0);
  await bomb.locator('#numberBombView').waitFor({ state: 'visible' });
  activeGame = data.games.sessions.gomoku;
  await bomb.locator('#numberBombView').waitFor({ state: 'hidden' });
  await output.frameLocator('iframe[src^="/games"]').nth(1).locator('#gomokuView').waitFor({ state: 'visible' });
  const giftAvatar = output.frameLocator('iframe[src^="/gift-feed"]').locator('.gift-banner-avatar').first();
  await giftAvatar.waitFor();
  assert.equal(await giftAvatar.getAttribute('src'), avatarUrl);
  await giftAvatar.evaluate((image) => image.decode());
  assert.deepEqual(await giftAvatar.evaluate(async () => {
    const { sceneAvatarSource } = await import('/js/overlays/scene-extra-client.js');
    return ['http://i0.hdslb.com/a.webp', 'https://untrusted.example/a.webp', '/api/bilibili/avatar',
      'https://user:secret@i0.hdslb.com/a.webp'].map(sceneAvatarSource);
  }), ['', '', '', '']);
  activeGame = data.games.sessions['draw-guess'];
  const gameAvatar = output.frameLocator('iframe[src^="/games"]').nth(2).locator('#drawDanmakuFeed img');
  await gameAvatar.waitFor();
  assert.equal(await gameAvatar.getAttribute('src'), avatarUrl);
  await gameAvatar.evaluate((image) => image.decode());
  await output.frameLocator('iframe[src^="/gift-wishes"]').nth(1).getByText('小花花 36/100', { exact: true }).waitFor();
  assert.equal(await output.frameLocator('iframe[src^="/interactions"]').nth(1).locator('#interactionStage').isHidden(), true);
  const single = await context.newPage();
  const singleUrl = `${fixture.origin}/scene?id=${source.id}&item=${saved.document.items[0].id}#token=${source.token}`;
  assert.equal((await fetch(singleUrl)).status, 200);
  await single.goto(singleUrl);
  await single.frameLocator('iframe').getByText('实时歌曲', { exact: true }).waitFor();
  assert.deepEqual(await single.locator('.scene-version iframe').evaluate((frame) => [frame.style.left, frame.style.top, frame.style.width, frame.style.height]), ['0px', '0px', '400px', '300px']);
  await single.screenshot({ path: path.resolve('tmp/canvas-component-library/single-output.png') });
  await page.close();
  data.songlist.songs[0].name = '关闭编辑器后仍更新';
  await single.frameLocator('iframe').getByText('关闭编辑器后仍更新', { exact: true }).waitFor();
});
