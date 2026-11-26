'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const openBrowser = useSharedBrowser();

test('reopening the paused fullscreen player immediately shows and seeks the current lyrics', async t => {
  const browser = openBrowser();
  t.after(() => browser.close());
  const fullscreen = fs.readFileSync(path.resolve(__dirname, '../../public/pages/admin/playback/fullscreen.html'), 'utf8');
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><meta charset="utf-8">
    <button id="playerAppearanceOpenBtn">打开播放器</button><div class="playback-player-panel"></div>
    <audio id="music-player"></audio>${fullscreen}` });
  t.after(() => fixture.close());
  const page = await browser.newPage();
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);

  const result = await page.evaluate(async () => {
    const { PlayerWorkspace } = await import('/js/admin/player-workspace.js');
    const { FullscreenPlayer } = await import('/js/playback/ui/fullscreen.js');
    const { createRenderer } = await import('/js/playback/core/renderer.js');
    const { createEventHandlers } = await import('/js/playback/core/event-handlers.js');
    const workspace = new PlayerWorkspace();
    workspace.initWorkspaceControls();
    const player = new FullscreenPlayer();
    player.init();
    const track = (title, startMs) => ({ id: title, title, lyrics: { lines: [
      { startMs: 0, text: `${title}开头` }, { startMs, text: `${title}第二句` },
    ] } });
    const state = { current: track('松', 1000) };
    const audio = document.getElementById('music-player');
    audio.currentTime = 4;
    let timeUpdates = 0;
    audio.addEventListener('timeupdate', () => timeUpdates++);
    const renderer = createRenderer({ playbackState: state, getPlaybackAudio: () => audio,
      uiRenderer: { getFullscreenPlayer: () => player } });
    let openRenders = 0;
    createEventHandlers({ playbackState: state, getPlaybackAudio: () => audio,
      renderFullscreenPlayer() { openRenders++; renderer.renderFullscreenPlayer(); },
    }).setupEventHandlers();
    const seeks = [];
    player.setSeekCallback(time => { seeks.push(time); return true; });
    const read = () => ({
      title: document.getElementById('playerFsTitle').textContent,
      active: document.querySelector('#playerFsLyrics .active .lyric-text')?.textContent,
    });

    document.getElementById('playerAppearanceOpenBtn').click();
    renderer.renderFullscreenPlayer();
    const first = read();
    document.getElementById('playerFsClose').click();
    state.current = track('竹', 3000);
    renderer.renderFullscreenPlayer();
    const closed = read();
    document.querySelector('.playback-player-panel').click();
    const reopened = read();
    workspace.openFullscreenPlayer(); // Already open.
    document.querySelector('#playerFsLyrics .active .lyric-seek-btn').click();
    return { first, closed, reopened, paused: audio.paused, timeUpdates, openRenders, seeks };
  });
  assert.deepEqual(result, {
    first: { title: '松', active: '松第二句' }, closed: { title: '竹', active: '松第二句' },
    reopened: { title: '竹', active: '竹第二句' }, paused: true, timeUpdates: 0, openRenders: 2, seeks: [3],
  });
});
