'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { readAdminHtml } = require('../helpers/admin-html');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

test('shared controls compose with drawers, collapsible content and song tabs', async (t) => {
  const html = readAdminHtml().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const server = await startComponentPreviewServer({ parentHtml: html });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await server.close(); assert.deepEqual(errors, []); });
  const url = `${server.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    window.clearCalls = 0;
    window.fetch = async (url) => {
      if (url === '/api/database/clear-gifts') window.clearCalls++;
      return new Response(JSON.stringify({ ok: true, data: { items: [], partial: false,
        perUser: [{ viewer: 'synthetic-viewer', userName: '测试观众', boxCount: 1, boxTypeCount: 1,
          totalCost: 1000, totalValue: 500, totalProfit: -500 }],
        summary: { boxCount: 1, totalCost: 1000, totalValue: 500, totalProfit: -500 } } }));
    };
    await import('/js/admin/contextual-help.js');
    const { formsService } = await import('/js/admin/forms.js');
    const { initGiftHistoryDrawer } = await import('/js/admin/gifts/history.js');
    await import('/js/admin/gifts/blindbox.js');
    formsService.initTabs();
    initGiftHistoryDrawer();
    window.selectMain = id => document.querySelectorAll('.main-page').forEach(node => node.classList.toggle('active', node.id === id));
    window.selectMain('giftAssistantPage');
  });

  await page.locator('#giftHistoryOpenBtn').click();
  await page.waitForFunction(() => document.activeElement.id === 'giftHistoryClose');
  await page.locator('#giftHistoryClose').press('Shift+Tab');
  assert.equal(await page.locator('#giftHistoryDrawer').evaluate(node => node.contains(document.activeElement)), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'giftHistoryClose');
  await page.locator('#giftHistoryOpenBtn').evaluate(node => node.focus());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'giftHistoryClose', 'Covered controls cannot take focus.');
  await page.locator('#giftHistoryClearDatabaseBtn').click();
  await page.locator('.lira-confirm-cancel').press('Escape');
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#giftHistoryDrawer').evaluate(node => node.classList.contains('open')), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'giftHistoryClearDatabaseBtn');
  assert.equal(await page.evaluate(() => window.clearCalls), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#giftHistoryDrawer').evaluate(node => node.classList.contains('open')), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'giftHistoryOpenBtn');
  assert.equal(await page.locator('#playerFullscreen').evaluate(node => node.inert), true, 'Closing a drawer preserves existing inert state.');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#giftHistoryDrawer').evaluate(node => node.contains(document.activeElement)), false);

  await page.locator('#blindBoxStatsToggle').click();
  const content = page.locator('#blindBoxStatsCollapsible');
  assert.equal(await content.evaluate(node => node.inert), true);
  await page.locator('#blindBoxStatsToggle').press('Tab');
  assert.equal(await content.evaluate(node => node.contains(document.activeElement)), false);
  await page.locator('#blindBoxStatsToggle').click();
  assert.equal(await content.evaluate(node => node.inert), false);
  await page.locator('#blindBoxStatsToggle').press('Tab');
  assert.equal(await content.evaluate(node => node.contains(document.activeElement)), true);

  await page.evaluate(() => window.selectMain('songAssistantPage'));
  await page.getByRole('tab', { name: '歌库', exact: true }).press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: '设置', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('tab', { name: '设置', exact: true }).press('End');
  assert.equal(await page.getByRole('tabpanel', { name: '桌面歌词设置', exact: true }).isVisible(), true);
  assert.equal(await page.locator('.tabs .tab[tabindex="0"]').count(), 1);
  await page.locator('#desktopLyricPage details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
  const unnamed = (await page.locator('#desktopLyricPage').ariaSnapshot()).split('\n').filter(line => /^\s*- (checkbox|spinbutton|slider|combobox)(:|\s*\[|\s*$)/.test(line));
  assert.deepEqual(unnamed, []);
  assert.equal(await page.getByRole('checkbox', { name: '弹性动画', exact: true }).count(), 1);
  assert.equal(await page.getByRole('spinbutton', { name: '整体缩放', exact: true }).count(), 1);

  const overlayTab = page.getByRole('tab', { name: '浏览器源', exact: true });
  const overlayTabArea = page.locator('.tab-with-help');
  for (const [edge, x, y] of [['left', 0.03, 0.5], ['right', 0.97, 0.5], ['top', 0.5, 0.03], ['bottom', 0.5, 0.97]]) {
    await page.getByRole('tab', { name: '展示板', exact: true }).click();
    const bounds = await overlayTabArea.boundingBox();
    await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
    assert.equal(await overlayTab.getAttribute('aria-selected'), 'true', `Clicking the ${edge} tab edge selects browser sources.`);
    assert.equal(await page.getByRole('tabpanel', { name: '浏览器源', exact: true }).isVisible(), true);
    assert.equal(await page.locator('.tabs .tab[aria-selected="true"]').count(), 1);
  }
  await page.getByRole('tab', { name: '展示板', exact: true }).click();
  const overlayHelp = overlayTabArea.locator('lira-help');
  await overlayHelp.click();
  assert.equal(await overlayHelp.getByRole('tooltip').isVisible(), true);
  assert.equal(await overlayTab.getAttribute('aria-selected'), 'false', 'Browser-source help does not switch tabs.');
  await overlayHelp.press('Escape');

  // Contextual help opens from pointer, focus and keys, but never acts as its label's control.
  await page.getByRole('tab', { name: '展示板', exact: true }).click();
  const sync = page.locator('#songBoardSyncTheme');
  const help = page.locator('label:has(#songBoardSyncTheme) lira-help');
  const tooltip = help.getByRole('tooltip');
  const syncChecked = await sync.isChecked();
  await help.hover();
  assert.equal(await help.getAttribute('aria-expanded'), 'true');
  assert.equal(await tooltip.isVisible(), true);
  await help.click();
  assert.equal(await help.getAttribute('aria-expanded'), 'true', 'Clicking does not toggle the open tooltip.');
  assert.equal(await sync.isChecked(), syncChecked, 'Clicking help inside a label does not toggle its control.');
  await page.mouse.move(0, 0);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  assert.equal(await help.getAttribute('aria-expanded'), 'false');
  await help.hover();
  await page.mouse.move(0, 0);
  assert.equal(await help.getAttribute('aria-expanded'), 'false', 'Pointer leave closes a tooltip without keyboard focus.');
  await help.focus();
  await help.press('Escape');
  assert.equal(await help.getAttribute('aria-expanded'), 'false');
  await help.press('Enter');
  assert.equal(await help.getAttribute('aria-expanded'), 'true');
  assert.equal(await sync.isChecked(), syncChecked, 'Activating help by keyboard does not toggle its control.');
  await help.hover();
  await page.mouse.move(0, 0);
  assert.equal(await help.getAttribute('aria-expanded'), 'true', 'Pointer leave keeps keyboard-focused help open.');
  await help.press('Escape');
  assert.equal(await tooltip.isVisible(), false);

  await page.evaluate(async () => {
    const { formsService } = await import('/js/admin/forms.js');
    const { createEventHandlers } = await import('/js/playback/core/event-handlers.js');
    const { createPlaylistOperations } = await import('/js/playback/operations/playlist-operations.js');
    const { PlaybackBar } = await import('/js/playback/ui/playback-bar.js');
    const { QueuePopup } = await import('/js/playback/ui/queue-popup.js');
    const { escapeHtml } = await import('/js/shared/utils.js');
    window.selectMain('playbackAssistantPage');
    window.testForms = formsService;
    formsService.initWorkspaceControls();
    window.audioPlayCalls = 0;
    window.pendingActions = [];
    const audio = document.getElementById('music-player');
    audio.play = () => { window.audioPlayCalls++; return Promise.resolve(); };
    const state = { selectedSource: 'qq', current: { source: 'qq', sourceSongId: 1, title: '测试歌曲' } };
    const bar = new PlaybackBar();
    const queue = new QueuePopup();
    queue.init();
    window.fetch = async () => new Response(JSON.stringify({ ok: true, data: { playlists: [
      { id: '1', dirId: '1', title: '已添加歌单', containsTrack: true },
      { id: '2', dirId: '2', title: '可添加歌单', containsTrack: false },
    ] } }));
    const playlistOperations = createPlaylistOperations({
      playbackState: state, homeService: {}, toast() {}, showError(error) { throw error; },
      readJsonResponse: response => response.json(), escapeHtml,
    });
    document.getElementById('playbackAddToPlaylistBtn').disabled = false;
    createEventHandlers({
      playbackState: state, getPlaybackAudio: () => audio,
      savePlaybackState() {}, renderPlayback: () => bar.renderProviderState({}, {}, state.selectedSource),
      homeService: { clearHomeState() {} }, searchService: { clearResults() {} },
      renderPlaybackSearchResults() {}, closePlaybackDrawer() {},
      refreshSelectedMusicProviderState() {}, syncPlaybackLyricWindow() {},
      toggleQueuePopup: () => queue.toggle(), closeQueuePopup: () => queue.close(),
      handlePlaybackPendingAction: action => {
        window.pendingActions.push(action);
        document.getElementById('pendingConfirmPopup').classList.remove('visible');
      },
      addCurrentTrackToPlaylist: () => playlistOperations.addCurrentTrackToPlaylist(),
    }).setupEventHandlers();
  });

  await page.locator('#playerDockToggle').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#playbackPlayerBody').evaluate(node => node.contains(document.activeElement)), false);
  await page.locator('#playerDockToggle').click();
  await page.locator('#playbackPlayPause').focus();
  await page.evaluate(() => window.testForms.openFullscreenPlayer());
  await page.waitForFunction(() => document.activeElement.id === 'playerFsClose');
  await page.locator('#playbackSearchKeyword').evaluate(node => node.focus());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playerFsClose');
  await page.locator('#playerFsClose').press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playerFsLyrics');
  await page.locator('#playerFsLyrics').press('Space');
  assert.equal(await page.evaluate(() => window.audioPlayCalls), 1);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playerDockToggle', 'The visible shared player stays keyboard accessible.');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playerFsLyrics');
  await page.locator('#playbackQueueBtn').click();
  await page.locator('#queuePopupClose').press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playerFsClose', 'The opened queue joins the player focus cycle.');
  await page.locator('#queuePopupClose').press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playbackQueueBtn');
  await page.locator('#playbackQueueBtn').click();
  await page.locator('#queuePopupClose').press('Escape');
  assert.equal(await page.locator('#queuePopup').evaluate(node => node.classList.contains('open')), false);
  assert.equal(await page.locator('#playerFullscreen').evaluate(node => node.classList.contains('open')), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playbackQueueBtn');
  await page.locator('#pendingConfirmPopup').evaluate(node => node.classList.add('visible'));
  await page.locator('#playerFsClose').press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pendingConfirmRejectBtn', 'A visible request notice stays operable above fullscreen.');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pendingConfirmAcceptBtn');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.pendingActions), ['ignore']);
  assert.equal(await page.locator('#playerFullscreen').evaluate(node => node.classList.contains('open')), true);
  await page.locator('#playerFsClose').press('Shift+Tab');
  assert.equal(await page.locator('#pendingConfirmPopup').evaluate(node => node.contains(document.activeElement)), false);
  await page.locator('#playerFsClose').press('Space');
  assert.equal(await page.locator('#playerFullscreen').evaluate(node => node.classList.contains('open')), false);
  assert.equal(await page.evaluate(() => window.audioPlayCalls), 1, 'Space on a button keeps its native action.');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playbackPlayPause');

  await page.evaluate(() => window.testForms.openFullscreenPlayer());
  await page.locator('#playbackAddToPlaylistBtn').click();
  await page.locator('.playlist-picker-backdrop').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim().includes('可添加歌单')), true);
  await page.locator('.playlist-picker-cancel').press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'playlist-picker-close');
  await page.locator('.playlist-picker-close').press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'playlist-picker-cancel');
  await page.locator('#playbackAddToPlaylistBtn').evaluate(node => node.focus());
  assert.equal(await page.evaluate(() => document.activeElement.className), 'playlist-picker-cancel');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.playlist-picker-backdrop').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playbackAddToPlaylistBtn');
  assert.equal(await page.locator('#playerFullscreen').evaluate(node => node.classList.contains('open')), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#playerFullscreen').evaluate(node => node.classList.contains('open')), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playbackPlayPause');

  await page.getByRole('tab', { name: 'QQ音乐', exact: true }).press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: '网易云音乐', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('tabpanel', { name: '网易云音乐', exact: true }).count(), 1);
  await page.keyboard.press('End');
  assert.equal(await page.getByRole('tab', { name: '全民 K歌', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'QQ音乐', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByRole('tab', { name: '全民 K歌', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('.source-tab[tabindex="0"]').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'playbackSourceQqTab');

  await page.evaluate(() => {
    const popup = document.getElementById('pendingConfirmPopup');
    const before = document.createElement('button');
    before.id = 'pendingFocusBefore';
    before.textContent = '通知之前';
    const after = document.createElement('button');
    after.id = 'pendingFocusAfter';
    after.textContent = '通知之后';
    popup.before(before);
    popup.after(after);
  });
  await page.locator('#pendingFocusBefore').press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pendingFocusAfter', 'A closed request notice has no keyboard stops.');
  await page.locator('#pendingConfirmPopup').evaluate(node => node.classList.add('visible'));
  await page.locator('#pendingFocusBefore').press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pendingConfirmAcceptBtn');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pendingConfirmRejectBtn');
  await page.locator('#pendingConfirmPopup').evaluate(node => node.classList.remove('visible'));
  await page.locator('#pendingFocusBefore').press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pendingFocusAfter');
});
