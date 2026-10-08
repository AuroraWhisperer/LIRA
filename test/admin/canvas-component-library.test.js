'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { sceneExtraPreviewData } = require('../../public/js/admin/scene-extra-preview-data.js');
const { SCENE_EXTRA_COMPONENTS } = require('../../public/js/shared/scene-extra-components.js');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { createSceneSharedAppearance } = require('../../src/server/scene-shared-appearance');

const openBrowserSession = useSharedBrowser();
const extraVariants = type => SCENE_EXTRA_COMPONENTS[type].variants.map(variant => variant.value);

test('canvas library saves variant layouts and shared parameters and renders real output at saved sizes', { timeout: 120000 }, async (t) => {
  const data = Object.fromEntries(['songlist', 'lyrics', 'games', 'wheel', 'interactions', 'gift-feed', 'blindbox', 'gift-wishes']
    .map((type) => [type, sceneExtraPreviewData(type)]));
  data['gift-wishes'] = { items: [{ id: 'synthetic-wish', period: 'day', giftName: '小花花',
    target: 100, count: 36, todayCount: 36, remaining: 64, progress: 36, completed: false,
    displayStyle: 'card', textTemplate: '{礼物} {已收}/{目标}', textImagePosition: 'none' }] };
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
  const browser = openBrowserSession();
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
  await desktop.route('**/api/games/session', route => route.fulfill({ json: { ok: true, data: activeGame } }));
  await desktop.route('**/api/overtime/gifts/catalog', route => route.fulfill({ json: { ok: true,
    data: { gifts: [1, 2, 3].map(id => ({ id, name: `合成礼物 ${id}`, imagePath: '/img/overlays/gift-feed/flower.webp' })) } } }));
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加组件', exact: true });
  // Scene-only variants come from their catalog; editor-owned styles must be unique and stable when revisited.
  const pickerCases = [
    ['danmaku', null], ['clock', null], ['queue', null], ['overtime', null, ['default']],
    ['songlist', null, extraVariants('songlist')], ['lyrics', null, extraVariants('lyrics')],
    ['直播小游戏', '直播间互动', extraVariants('games')], ['直播小游戏', '转盘', extraVariants('wheel')],
    ['直播小游戏', '投票与评分', extraVariants('interactions')],
    ['gift-feed', null, extraVariants('gift-feed')], ['blindbox', null, extraVariants('blindbox')],
    ['gift-wishes', null, extraVariants('gift-wishes')], ['gift-wishes', '月底冲刺', extraVariants('gift-sprint')],
    ['queue', null],
  ];
  const thumbnailSources = new Set();
  const shownStyles = new Map();
  for (const [category, subcategory, expected] of pickerCases) {
    await picker.locator(`[data-category="${category}"]`).click();
    if (subcategory) await picker.locator('.preview-picker-subcategories').getByRole('button', { name: subcategory, exact: true }).click();
    const cards = picker.locator('[data-picker-style]');
    const variants = await cards.evaluateAll((buttons) => buttons.map((button) => button.dataset.pickerStyle));
    const key = `${category}/${subcategory || ""}`;
    assert.ok(variants.length > 0 && new Set(variants).size === variants.length, `${key} shows each style once`);
    if (expected) assert.deepEqual(variants, expected, `${key} follows its component catalog`);
    if (shownStyles.has(key)) assert.deepEqual(variants, shownStyles.get(key), `${key} is unchanged after switching categories`);
    shownStyles.set(key, variants);
    assert.equal(await picker.locator('[data-picker-style][aria-label^="添加"]').count(), variants.length);
    assert.equal(await picker.locator('iframe').count(), 0, 'the library uses thumbnails without starting live renderers');
    for (const card of await cards.all()) {
      if (category === 'danmaku') {
        const group = await card.evaluate(async button => {
          const { DANMAKU_STYLE_OPTIONS } = await import('/js/shared/danmaku-style-options.js');
          return DANMAKU_STYLE_OPTIONS[button.dataset.pickerStyle].layout;
        });
        await picker.getByRole('button', { name: group === 'floating' ? '飘窗弹幕' : group === 'fullscreen-random' ? '随机弹幕' : '固定弹幕', exact: true }).click();
      }
      await card.scrollIntoViewIfNeeded();
      assert.equal(await card.locator('img').count(), 1);
      await card.locator('img').evaluate((image) => image.decode());
      thumbnailSources.add(await card.locator('img').getAttribute('src'));
    }
  }
  const builtInStyles = [...shownStyles.values()].reduce((count, variants) => count + variants.length, 0);
  assert.equal(thumbnailSources.size, builtInStyles, 'every built-in style has its own preview image');
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
    if (type === 'games') activeGame = data.games.sessions[variant];
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator(`[data-category="${subcategory ? '直播小游戏' : type}"]`).click();
    if (subcategory) await page.locator('.preview-picker-subcategories').getByRole('button', { name: subcategory, exact: true }).click();
    await page.locator(`[data-picker-style="${variant}"]`).click();
    await page.waitForFunction(() => document.querySelector('.scene-editor-item.is-selected .component-preview-load-state')?.hidden);
    const preview = page.frameLocator('.scene-editor-item.is-selected iframe');
    await preview.locator(previews[variant] || previews[type]).first().waitFor({ state: 'visible' });
    if (type === 'gift-feed') {
      assert.equal(await page.getByRole('spinbutton', { name: '宽度', exact: true }).inputValue(), '428');
      assert.equal(await page.getByRole('spinbutton', { name: '高度', exact: true }).inputValue(), '232');
      assert.equal(await page.locator('[data-component-parameter="scrollSpeed"]').inputValue(), '12');
      const feed = await preview.locator('#giftFeedViewport').evaluate(async (viewport) => {
        const images = [...viewport.querySelectorAll('img')];
        await Promise.all(images.map((image) => image.decode()));
        const { width, height } = viewport.getBoundingClientRect();
        return { width, height, avatars: new Set(images.filter((image) => image.className === 'gift-banner-avatar')
          .map((image) => image.getAttribute('src'))).size,
        artwork: new Set(images.filter((image) => image.className === 'gift-banner-artwork')
          .map((image) => image.getAttribute('src'))).size,
        placeholders: images.some((image) => image.getAttribute('src').includes('placeholder')) };
      });
      assert.deepEqual(feed, { width: 428, height: 232, avatars: 3, artwork: 3, placeholders: false });
    }
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
    const shared = createSceneSharedAppearance({ settings: { get: () => fixture.runtime.settings }, system: {} })
      .read(item.type, item.appearance.config);
    const expected = item.type === 'interactions' ? '实时评分' : cases[index][4];
    assert.equal(String({ ...item.appearance.config, ...shared }[cases[index][3]]), expected);
    assert.equal(item.appearance.mode, 'independent');
    assert.equal(item.width, 400);
    if (item.type === 'gift-wishes') assert.ok(item.height > 32);
    else assert.equal(item.height, 300);
  });
  await page.reload();
  await page.waitForFunction((count) => document.querySelectorAll('.scene-editor-item').length === count, cases.length);
  const sizes = await page.locator('.scene-editor-item').evaluateAll((items) => items.map((item) => [item.style.width, item.style.height]));
  assert.deepEqual(sizes, saved.document.items.map(item => [`${item.width}px`, `${item.height}px`]));
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="直播小游戏"]').click();
  assert.equal(await page.locator('.preview-picker-subcategories button[aria-pressed]').count(), 3);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
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
  assert.equal(await songFrame.locator('#songBoardTitle').textContent(), '我的歌单');
  const frames = await output.locator('.scene-version:not(.is-staging) iframe').evaluateAll((items) => items.map((item) => [item.style.width, item.style.height, item.getAttribute('sandbox')]));
  // Output frames use the saved sizes, including the content-fitted wish height.
  assert.deepEqual(frames.map(([width, height]) => [width, height]), saved.document.items.map(item => [`${item.width}px`, `${item.height}px`]));
  assert.ok(frames.every(([, , sandbox]) => sandbox === 'allow-scripts'));
  const bomb = output.frameLocator('iframe[src^="/games"]').nth(0);
  activeGame = data.games.sessions['number-bomb'];
  fixture.notify({ types: ['games'] });
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
      'https://user:secret@i0.hdslb.com/a.webp', '/img/overlays/danmaku-ranked/../secret.webp'].map(sceneAvatarSource);
  }), ['', '', '', '', '']);
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
  await page.close();
  data.songlist.songs[0].name = '关闭编辑器后仍更新';
  await single.frameLocator('iframe').getByText('关闭编辑器后仍更新', { exact: true }).waitFor();
});

test('canvas games follow the live session, clear stopped games and use fitted initial sizes', { timeout: 45000 }, async t => {
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
  const add = async (game, size) => {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator('[data-category="直播小游戏"]').click();
    await page.locator(`[data-picker-style="${game}"]`).click();
    const item = page.locator('.scene-editor-item.is-selected');
    assert.deepEqual(await item.evaluate(node => [parseFloat(node.style.width), parseFloat(node.style.height)]), size);
    return page.locator(`[data-item-id="${await item.getAttribute('data-item-id')}"]`).frameLocator('iframe');
  };
  const bomb = await add('number-bomb', [800, 360]);
  await bomb.getByText('等待主播开局', { exact: true }).waitFor();
  assert.equal(await bomb.locator('#bombNumbers button').count(), 0, 'An idle canvas never invents a sample round.');
  session = structuredClone(samples['number-bomb']);
  session.state = { min: 1, max: 100, lastGuess: null, turn: 'host', winner: null };
  await bomb.locator('#bombNumbers button.is-safe').last().waitFor();
  assert.equal(await bomb.locator('#bombNumbers button.is-safe').count(), 100);
  const bombBounds = await bomb.locator('#bombNumbers').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
  });
  assert.ok(bombBounds.right <= bombBounds.width && bombBounds.bottom <= bombBounds.height);
  assert.ok(bombBounds.height - bombBounds.bottom < 50, 'The number board fills its initial frame without a large empty bottom.');
  session.state = { min: 51, max: 100, lastGuess: 50, turn: 'viewer', winner: null };
  await bomb.locator('#bombNumbers .is-picked').filter({ hasText: /^50$/ }).waitFor();
  assert.equal(await bomb.locator('#bombNumbers button.is-safe').count(), 50);
  unavailable = true;
  await bomb.getByText('等待主播开局', { exact: true }).waitFor();
  unavailable = false;
  await bomb.locator('#numberBombView').waitFor();
  session = structuredClone(samples.gomoku);
  session.state.board = session.state.board.map(row => row.map(value => value === 1 ? 'black' : value === 2 ? 'white' : null));
  const gomoku = await add('gomoku', [600, 600]);
  await gomoku.locator('#gomokuBoard .has-white').waitFor();
  await bomb.getByText('等待主播开局', { exact: true }).waitFor();
  const board = await gomoku.locator('#gomokuBoard').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });
  assert.ok(board.width >= 530 && board.width === board.height && board.right < 600 && board.bottom < 600);
  session.state.board[0][0] = 'black';
  await gomoku.locator('#gomokuBoard button.has-black[aria-label="A1"]').waitFor();
  session = structuredClone(samples['draw-guess']);
  const drawing = await add('draw-guess', [1280, 720]);
  await drawing.locator('#drawGuessView').waitFor();
  session.state.wordLength = 5;
  session.state.canvas = { revision: 1, totalPoints: 2, strokes: [{ id: 'live-stroke', color: '#222034', width: 12,
    points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }] }] };
  await drawing.getByText('5 个字', { exact: true }).waitFor();
  assert.deepEqual(await drawing.locator('#drawCanvas').evaluate(canvas =>
    Array.from(canvas.getContext('2d').getImageData(640, 360, 1, 1).data)), [34, 32, 52, 255]);
  assert.equal(await drawing.locator('.draw-toolbar').isHidden(), true);
  session = null;
  await drawing.getByText('等待主播开局', { exact: true }).waitFor();
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
