'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');

test('standalone component sources load saved styles and live data without a canvas or editor', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  fixture.runtime.settings.clockLabel = '独立时钟';
  fixture.runtime.settings.clockStyle = 'flip';
  const pages = {};
  for (const type of ['clock', 'queue', 'overtime', 'danmaku']) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(5000);
    pages[type] = page;
    page.on('pageerror', error => errors.push(error.message));
    const url = `${fixture.origin}/${type}${type === 'danmaku' ? '?source=component' : ''}`;
    assert.equal((await fetch(url)).status, 200);
    await page.goto(url);
    assert.equal(await page.evaluate(() => window.liraLicense), undefined);
    assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  }
  await pages.clock.waitForFunction(() => document.documentElement.dataset.clockStyle === 'flip');
  await pages.queue.getByText('合成实时歌曲').waitFor();
  await pages.overtime.getByText('00:02:00', { exact: true }).waitFor();
  await pages.danmaku.waitForFunction(() => document.body.dataset.style === 'signal' && document.body.classList.contains('has-layout'));
  fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '独立观众', message: '独立组件的实时弹幕' });
  await pages.danmaku.getByText('独立组件的实时弹幕').waitFor();
  const state = await fixture.appearance.read();
  fixture.appearance.save({ ...state, config: { ...state.config, style: 'bubble' } });
  await pages.danmaku.waitForFunction(() => document.body.dataset.style === 'bubble');
  fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '独立观众', message: '保存样式后继续接收' });
  await pages.danmaku.getByText('保存样式后继续接收').waitFor();
  await pages.danmaku.reload();
  await pages.danmaku.waitForFunction(() => document.body.dataset.style === 'bubble');
  fixture.runtime.settings.clockStyle = 'peach';
  fixture.runtime.queue.waiting[0].song_name = '更新后的独立队列';
  fixture.runtime.overtime = { ...fixture.runtime.overtime, revision: 2, effectiveRemainingMs: 180000 };
  fixture.broadcast();
  await pages.clock.waitForFunction(() => document.documentElement.dataset.clockStyle === 'peach');
  await pages.queue.getByText('更新后的独立队列').waitFor();
  await pages.overtime.getByText('00:03:00', { exact: true }).waitFor();
  fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '独立观众', message: '刷新后仍能接收' });
  await pages.danmaku.getByText('刷新后仍能接收').waitFor();
  fixture.updateCloud(null, 'offline');
  await pages.danmaku.getByText('等待直播数据', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await pages.danmaku.getByText('刷新后仍能接收').count(), 1);
  assert.deepEqual(fixture.service.list(), []);
});

test('standalone music, gift and interaction sources render through their own HTTP and socket credentials', { timeout: 30000 }, async t => {
  const revision = 'standalone-gifts';
  const wishes = { viewRevision: revision, partial: false, session: { state: 'live', stale: false },
    items: [{ id: 'wish', period: 'session', giftName: '合成小花', count: 3, target: 10,
      displayStyle: 'text', textTemplate: '许愿{礼物} {已收}/{目标}', completed: false }] };
  const interaction = { runtimeId: 'standalone-interaction', revision: 1, session: { sessionId: 'poll',
    kind: 'poll', phase: 'active', connected: true, participants: 1,
    options: [{ text: '合成投票选项', votes: 1, percentage: 100 }] } };
  const fixture = await startCanvasOutputFixture({ extraContext: {
    songs: { list: () => [{ id: 1, name: '独立歌单曲目', artist: '合成歌手', name_initial: 'D' }] },
    gifts: {
      getBlindBoxStats: () => ({ summary: { boxCount: 2, totalCost: 20, totalValue: 30, totalProfit: 10 },
        perUser: [{ userName: '合成榜单观众', boxCount: 2, totalProfit: 10 }] }),
      getHistory: () => ({ viewRevision: revision, nextCursor: null, partial: false, items: [{ eventId: 'gift',
        gift: { userName: '合成送礼观众', giftId: '1', giftName: '合成小花', num: 2, coinType: 'gold',
          unitPrice: 1, createdAt: new Date().toISOString(), avatarUrl: '' } }] }),
    },
    giftCards: { getProfiles: () => ({ viewRevision: revision, items: [], partial: false,
      day: new Date(Date.now() + 28800000).toISOString().slice(0, 10) }) },
    giftWishes: { getSnapshot: () => wishes },
    heartBoxCollection: { getSnapshot: () => ({ viewRevision: revision, status: 'collecting', count: 37,
      target: 40, remaining: 3, completed: false, stages: [] }) },
    overtime: { getGlobalGiftCatalog: () => ({ gifts: [] }) },
    games: { getSession: () => ({ sessionId: 'game', eventRevision: 1, game: 'number-bomb',
      state: { min: 25, max: 78, lastGuess: 24, turn: 'host', winner: null } }) },
    wheel: { getState: () => ({ entries: [{ label: '合成转盘选项', weight: 1 }], spin: null, lastResult: null }) },
    interactions: { getState: () => interaction },
  } });
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(failures, []); });
  Object.assign(fixture.runtime.settings, { openingEnabled: 'true', openingTitle: '独立开播标题',
    interactionOverlayTitle: '观众投票 👩‍💻❤️' });
  Object.assign(fixture.runtime, {
    gifts: { viewRevision: revision }, giftSprint: { targetRmb: 10000, remainingCrystalBalls: 100 },
    nowPlaying: { source: 'internal', trackTitle: '独立歌曲信息', artists: ['合成歌手'], playing: true },
    lyricState: { trackTitle: '合成歌词曲目', lineText: '独立歌词内容', currentMs: 1000, playing: false, status: 'ready' },
    lyricTimeline: { trackTitle: '合成歌词曲目', lines: [{ startMs: 0, endMs: 10000, text: '独立歌词内容' }] },
  });
  const pages = {};
  for (const [route, content] of [
    ['songlist', '独立歌单曲目'], ['now-playing', '独立歌曲信息'], ['lyrics', '独立歌词内容'],
    ['blindbox', '合成榜单观众'], ['gift-feed', '合成送礼观众'], ['gift-wishes', '许愿合成小花 3/10'],
    ['heart-box-collection', '37'], ['gift-sprint', '100'], ['opening', '独立开播标题'],
    ['games', '37'], ['wheel', '合成转盘选项'], ['interactions', '合成投票选项'], ['gift-effects', null],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(5000);
    pages[route] = page;
    page.on('pageerror', error => failures.push({ route, error: error.message }));
    page.on('response', response => {
      if (response.status() >= 400) failures.push({ route, path: new URL(response.url()).pathname, status: response.status() });
    });
    const url = `${fixture.origin}/${route}`;
    assert.equal((await fetch(url)).status, 200);
    const ready = route === 'gift-effects' ? page.waitForEvent('websocket')
      .then(socket => socket.waitForEvent('framereceived')) : null;
    await page.goto(url);
    if (ready) await ready;
    if (content) await page.getByText(content, { exact: !['gift-sprint', 'lyrics'].includes(route) }).first().waitFor();
  }
  fixture.broadcast({ type: 'gift:guard-thanks', eventId: 'standalone-guard', tier: 'captain',
    userName: '独立上舰观众', months: 1, textMode: 'zh', style: 'classic' });
  await pages['gift-effects'].getByText('独立上舰观众', { exact: true }).waitFor();
  await pages.interactions.getByRole('heading', { name: '观众投票 👩‍💻❤️', exact: true }).waitFor();
  fixture.runtime.nowPlaying = null;
  fixture.broadcast();
  await pages['now-playing'].getByText('独立歌曲信息').waitFor({ state: 'hidden' });
  fixture.runtime.nowPlaying = { source: 'internal', trackTitle: '刷新后歌曲信息', artists: [], playing: true };
  await pages['now-playing'].reload();
  await pages['now-playing'].getByText('刷新后歌曲信息').waitFor();
  interaction.session = { sessionId: 'rating', kind: 'rating', phase: 'finished', connected: true,
    participants: 2, average: 8.25 };
  interaction.revision += 1;
  fixture.broadcast({ type: 'interaction:update', state: interaction });
  await pages.interactions.getByText('8.25', { exact: true }).waitFor();
  interaction.session = null;
  interaction.revision += 1;
  fixture.broadcast({ type: 'interaction:update', state: interaction });
  await pages.interactions.locator('#interactionStage').waitFor({ state: 'hidden' });
  assert.deepEqual(fixture.service.list(), [], 'Fixed component sources do not require a published canvas.');
});

test('standalone sources keep visible bounds without dynamic viewport units', { timeout: 15000 }, async t => {
  const fixture = await startCanvasOutputFixture({ extraContext: { gifts: {
    getBlindBoxStats: () => ({ summary: { boxCount: 20, totalCost: 200, totalValue: 300, totalProfit: 100 },
      perUser: Array.from({ length: 20 }, (_, index) => ({ userName: `高度回归观众${index + 1}`, boxCount: 1, totalProfit: 5 })) }),
  } } });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.setDefaultTimeout(4000);
  // An unknown unit exercises the computed-value failure of pre-dvh Chromium;
  // it also makes @supports false so newer browsers verify the fallback branch.
  await page.route(/\/css\/overlays\/(?:overtime|blindbox)\.css(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replaceAll('dvh', 'unsupportedviewport') });
  });
  assert.equal((await fetch(`${fixture.origin}/overtime`)).status, 200);
  await page.goto(`${fixture.origin}/overtime`);
  await page.getByText('00:02:00', { exact: true }).waitFor({ state: 'attached' });
  const overtimeHeight = await page.locator('#overtimeMachine').evaluate(node => node.getBoundingClientRect().height);
  assert.ok(overtimeHeight > 0, 'The countdown must not collapse to a transparent zero-height container.');
  assert.equal((await fetch(`${fixture.origin}/blindbox`)).status, 200);
  await page.goto(`${fixture.origin}/blindbox`);
  await page.getByText('高度回归观众1', { exact: true }).waitFor();
  const bounds = await page.locator('.blindbox-panel').evaluate(node => ({
    bottom: node.getBoundingClientRect().bottom, scrollable: node.scrollHeight > node.clientHeight,
  }));
  assert.ok(bounds.bottom <= 360, 'The list must stay inside the browser-source viewport.');
  assert.equal(bounds.scrollable, true, 'Rows outside the viewport must remain reachable by scrolling.');
});
