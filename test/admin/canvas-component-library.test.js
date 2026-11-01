'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { sceneExtraPreviewData } = require('../../public/js/admin/scene-extra-preview-data.js');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { createSceneSharedAppearance } = require('../../src/server/scene-shared-appearance');

const openBrowserSession = useSharedBrowser();

test('canvas library saves variant layouts and shared parameters and renders real output at saved sizes', { timeout: 120000 }, async (t) => {
  const data = Object.fromEntries(['songlist', 'lyrics', 'games', 'wheel', 'interactions', 'gift-feed', 'blindbox', 'gift-wishes']
    .map((type) => [type, sceneExtraPreviewData(type)]));
  data['gift-wishes'] = { items: [{ id: 'synthetic-wish', period: 'day', giftName: '小花花',
    target: 100, count: 36, todayCount: 36, remaining: 64, progress: 36, completed: false,
    displayStyle: 'card', textTemplate: '{礼物} {已收}/{目标}', textImagePosition: 'none' }] };
  const activeGame = data.games.sessions['number-bomb'];
  data.songlist.songs[0].name = '实时歌曲';
  const avatarUrl = 'https://i0.hdslb.com/bfs/face/canvas-test.webp';
  data['gift-feed'].items.forEach((item) => { item.gift.avatarUrl = avatarUrl; });
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
  const browser = openBrowserSession();
  const desktop = await browser.newPage();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.route(avatarUrl, (route) => route.fulfill({ status: 200, contentType: 'image/webp',
    body: fs.readFileSync(path.resolve('public/img/overlays/danmaku-ranked/viewer.webp')) }));
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
  await desktop.route('**/api/games/session', route => route.fulfill({ json: { ok: true, data: activeGame } }));
  await desktop.route('**/api/overtime/gifts/catalog', route => route.fulfill({ json: { ok: true,
    data: { gifts: [1, 2, 3].map(id => ({ id, name: `合成礼物 ${id}`, imagePath: '/img/overlays/gift-feed/flower.webp' })) } } }));
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const cases = [
    ['songlist', null, 'default', 'songBoardTitle', '我的歌单'],
    ['lyrics', null, 'default', 'desktopLyricFontSize', '64'],
    ['games', '直播间互动', 'number-bomb', 'opacity', '0.8'],
    ['wheel', '转盘', 'default', 'labelFontSize', '24'],
    ['interactions', null, 'poll', 'interactionOverlayTitle', '实时投票'],
    ['gift-feed', null, 'default', 'scrollSpeed', '40'],
    ['blindbox', null, 'default', 'top', '5'],
    ['gift-wishes', null, 'card', 'gap', '20'],
  ];
  const previews = { songlist: '.song-card', lyrics: '.desktop-lyric-preview-row',
    'number-bomb': '#bombNumbers button', wheel: '#wheelSegments path', poll: '.interaction-row',
    'gift-feed': '.gift-banner', blindbox: '.leaderboard-row', 'gift-wishes': '.wish-card' };
  for (const [type, subcategory, variant, key, value] of cases) {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    const category = type === 'interactions' ? `interactions-${variant}` : subcategory ? '直播小游戏' : type;
    await page.locator(`[data-category="${category}"]`).click();
    if (subcategory) await page.locator('.preview-picker-subcategories').getByRole('button', { name: subcategory, exact: true }).click();
    await page.locator(`[data-picker-style="${variant}"]`).click();
    await page.waitForFunction(() => document.querySelector('.scene-editor-item.is-selected .component-preview-load-state')?.hidden);
    const preview = page.frameLocator('.scene-editor-item.is-selected iframe');
    await preview.locator(previews[variant] || previews[type]).first().waitFor({ state: 'visible' });
    if (type === 'songlist') await page.locator('[data-component-parameter="songBoardSyncTheme"]').uncheck();
    const input = page.locator(`[data-component-parameter="${key}"]`);
    await input.fill(value); await input.press('Tab');
    for (const [name, size] of [['宽度', '400'], ['高度', '300']]) {
      if (type === 'gift-wishes' && name === '高度') continue;
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
    if (item.type === 'interactions') assert.equal(item.appearance.config.kind, cases[index][2]);
    const shared = createSceneSharedAppearance({ settings: { get: () => fixture.runtime.settings }, system: {} })
      .read(item.type, item.appearance.config);
    assert.equal(String({ ...item.appearance.config, ...shared }[cases[index][3]]), cases[index][4]);
    assert.equal(item.appearance.mode, 'independent');
    assert.equal(item.width, 400);
    if (item.type === 'gift-wishes') assert.ok(item.height > 32);
    else assert.equal(item.height, 300);
  });
  await page.reload();
  await page.waitForFunction((count) => document.querySelectorAll('.scene-editor-item').length === count, cases.length);
  const sizes = await page.locator('.scene-editor-item').evaluateAll((items) => items.map((item) => [item.style.width, item.style.height]));
  assert.deepEqual(sizes, saved.document.items.map(item => [`${item.width}px`, `${item.height}px`]));
  const source = fixture.service.getSource(saved.document.id);
  const output = await context.newPage();
  output.on('pageerror', (error) => errors.push(error.message));
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  await output.goto(outputUrl);
  await output.waitForFunction((count) => document.querySelectorAll('.scene-version:not(.is-staging) iframe').length === count, cases.length).catch(async error => {
    throw new Error(`Scene output: ${await output.locator('#sceneStatus').textContent()}; errors: ${JSON.stringify(errors)}`, { cause: error });
  });
  const songFrame = output.frameLocator('iframe[src^="/songlist"]');
  await songFrame.getByText('实时歌曲', { exact: true }).waitFor();
  const frames = await output.locator('.scene-version:not(.is-staging) iframe').evaluateAll((items) => items.map((item) => [item.style.width, item.style.height, item.getAttribute('sandbox')]));
  // Output frames use the saved sizes, including the content-fitted wish height.
  assert.deepEqual(frames.map(([width, height]) => [width, height]), saved.document.items.map(item => [`${item.width}px`, `${item.height}px`]));
  assert.ok(frames.every(([, , sandbox]) => sandbox === 'allow-scripts'));
  const giftAvatar = output.frameLocator('iframe[src^="/gift-feed"]').locator('.gift-banner-avatar').first();
  await giftAvatar.waitFor();
  assert.equal(await giftAvatar.getAttribute('src'), avatarUrl);
  await giftAvatar.evaluate((image) => image.decode());
  assert.deepEqual(await giftAvatar.evaluate(async () => {
    const { sceneAvatarSource } = await import('/js/overlays/scene-extra-client.js');
    return ['http://i0.hdslb.com/a.webp', 'https://untrusted.example/a.webp', '/api/bilibili/avatar',
      'https://user:secret@i0.hdslb.com/a.webp', '/img/overlays/danmaku-ranked/../secret.webp'].map(sceneAvatarSource);
  }), ['', '', '', '', '']);
  const single = await context.newPage();
  const singleUrl = `${fixture.origin}/scene?id=${source.id}&item=${saved.document.items[0].id}#token=${source.token}`;
  assert.equal((await fetch(singleUrl)).status, 200);
  await single.goto(singleUrl);
  await single.frameLocator('iframe').getByText('实时歌曲', { exact: true }).waitFor();
  await page.close();
  data.songlist.songs[0].name = '关闭编辑器后仍更新';
  await single.frameLocator('iframe').getByText('关闭编辑器后仍更新', { exact: true }).waitFor();
});

test('canvas games follow the live session and clear stopped games', { timeout: 45000 }, async t => {
  let session = null;
  let unavailable = false;
  const fixture = await startCanvasOutputFixture({ extraContext: { games: { getSession: () => session } } });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  const childRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('/api/') && request.frame().parentFrame()) childRequests.push(request.url());
  });
  const url = await openCanvasDesktop(desktop, fixture);
  await desktop.route('**/api/games/session', route => route.fulfill({ status: unavailable ? 503 : 200,
    json: unavailable ? { ok: false } : { ok: true, data: session } }));
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const samples = sceneExtraPreviewData('games').sessions;
  const add = async game => {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator('[data-category="直播小游戏"]').click();
    await page.locator(`[data-picker-style="${game}"]`).click();
    const item = page.locator('.scene-editor-item.is-selected');
    return page.locator(`[data-item-id="${await item.getAttribute('data-item-id')}"]`).frameLocator('iframe');
  };
  const bomb = await add('number-bomb');
  await bomb.getByText('等待主播开局', { exact: true }).waitFor();
  assert.equal(await bomb.locator('#bombNumbers button').count(), 0, 'An idle canvas never invents a sample round.');
  session = structuredClone(samples['number-bomb']);
  session.state = { min: 1, max: 100, lastGuess: null, turn: 'host', winner: null };
  await bomb.locator('#bombNumbers button.is-safe').last().waitFor();
  session.state = { min: 51, max: 100, lastGuess: 50, turn: 'viewer', winner: null };
  await bomb.locator('#bombNumbers .is-picked').filter({ hasText: /^50$/ }).waitFor();
  unavailable = true;
  await bomb.getByText('等待主播开局', { exact: true }).waitFor();
  unavailable = false;
  await bomb.locator('#numberBombView').waitFor();
  session = structuredClone(samples.gomoku);
  session.state.board = session.state.board.map(row => row.map(value => value === 1 ? 'black' : value === 2 ? 'white' : null));
  const gomoku = await add('gomoku');
  await gomoku.locator('#gomokuBoard .has-white').waitFor();
  await bomb.getByText('等待主播开局', { exact: true }).waitFor();
  session = null;
  await gomoku.getByText('等待主播开局', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  const source = fixture.service.getSource(saved.document.id);
  const output = await browser.newPage();
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  await output.goto(outputUrl);
  await output.locator('.scene-version:not(.is-staging) iframe').first().waitFor();
  for (const frame of await output.locator('.scene-version:not(.is-staging) iframe').all()) {
    assert.equal(await frame.contentFrame().locator('#gameEmptyView').isHidden(), true, 'Waiting hints stay out of live output.');
  }
  assert.deepEqual(childRequests, [], 'Game frames receive live data without management requests or credentials.');
  assert.deepEqual(errors, []);
});
