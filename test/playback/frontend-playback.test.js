'use strict';

const { readAdminFragmentHtml, readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');
const { createLyricToggleButton, loadModuleExports, response } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('match diagnosis uses import platform priority and fallback without scoring empty searches', async (t) => {
  for (const scenario of [
    { title: 'current song wins over selected tab', current: 'qq', selected: 'netease', qq: 95, netease: 99, searched: ['qq'], chosen: 'qq' },
    { title: 'secondary platform can auto accept', current: 'qq', selected: 'qq', qq: 60, netease: 95, searched: ['qq', 'netease'], chosen: 'netease' },
    { title: 'highest score wins when both need confirmation', current: 'local', selected: 'netease', qq: 70, netease: 60, searched: ['netease', 'qq'], chosen: 'qq' },
    { title: 'equal fallback scores preserve priority', current: 'qq', selected: 'netease', qq: 60, netease: 60, searched: ['qq', 'netease'], chosen: 'qq' },
    { title: 'empty platforms explain no candidates', selected: 'netease', searched: ['netease', 'qq'] },
    { title: 'failed first platform continues to fallback', selected: 'qq', qq: 'error', netease: 95, searched: ['qq', 'netease'], chosen: 'netease' },
  ]) await t.test(scenario.title, async () => {
    const calls = [];
    const { MatchService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/services/match-service.js'), {
      fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push({ url, body });
        const platform = body.platform || body.candidates[0].source;
        const score = scenario[platform];
        if (score === 'error') throw new Error('模拟连接失败');
        return response({ ok: true, data: url.endsWith('/search') ? { tracks: score
          ? [{ id: `${platform}:song`, title: '候选歌', artists: ['歌手'], source: platform }] : [] }
          : { results: [{ track: body.candidates[0], score, autoAccept: score >= 90, reasons: ['歌手一致'] }] } });
      },
    });
    const service = new MatchService({ state: { current: { source: scenario.current }, selectedSource: scenario.selected }, readJsonResponse: (r) => r.payload });
    const diagnosis = await service.testMatch('歌名', '歌手', 180000);
    assert.deepEqual(calls.filter(({ url }) => url.endsWith('/search')).map(({ body }) => body.platform), scenario.searched);
    assert.equal(calls[0].body.keyword, '歌名 歌手');
    for (const { body } of calls.filter(({ url }) => url.endsWith('/match-track'))) {
      assert.equal(body.durationMs, 180000);
      assert.equal(body.candidates.length, 1);
    }
    if (scenario.chosen) {
      assert.equal(diagnosis.results[0].track.source, scenario.chosen);
      assert.equal(diagnosis.results[0].score, scenario[scenario.chosen]);
      assert.match(diagnosis.searchSummary, new RegExp(`本次采用${scenario.chosen === 'qq' ? 'QQ 音乐' : '网易云音乐'}`));
    } else {
      assert.equal(diagnosis.results.length, 0);
      assert.equal(calls.length, 2, 'empty search results are not sent for scoring');
      assert.match(diagnosis.emptyReason, /没有搜到候选/);
    }
    if (scenario.qq === 'error') assert.match(diagnosis.searchSummary, /QQ 音乐：模拟连接失败/);
  });
});

test('queue rows highlight the current request without marking another request of the same song active', async () => {
  const { renderQueueRow } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/ui/components.js'));
  const song = { id: 'qq:same-song', source: 'qq', title: '同一首歌', artists: ['歌手'] };
  const current = { ...song, songRequestKey: '["1","2026-10-08T09:00:00Z"]' };
  const waiting = { ...song, songRequestKey: '["2","2026-10-08T09:00:01Z"]' };
  for (const origin of ['normal', 'radio']) {
    assert.doesNotMatch(renderQueueRow(waiting, origin, 0, false, current, origin), /playback-queue-row active/);
    assert.match(renderQueueRow(current, origin, 0, false, current, origin), /playback-queue-row active/);
    assert.doesNotMatch(renderQueueRow(song, origin, 0, false, current, origin), /playback-queue-row active/);
    assert.doesNotMatch(renderQueueRow(waiting, origin, 0, false, song, origin), /playback-queue-row active/);
    assert.match(renderQueueRow(song, origin, 0, false, song, origin), /playback-queue-row active/);
  }
  assert.doesNotMatch(renderQueueRow(current, 'normal', 0, false, current, 'radio'), /playback-queue-row active/);
});

test('song import filters handled request IDs before the batch limit and keeps later requests reachable', async () => {
  const { ImportService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/services/import-service.js'));
  const matchedIds = [];
  const service = new ImportService({
    matchService: {
      async matchQueueItem(item) {
        matchedIds.push(item.id);
        return { autoAccept: true, track: { id: 'same-song', title: '同一首歌' } };
      },
    },
  });
  const items = Array.from({ length: 31 }, (_, index) => ({ id: index + 1, created_at: '2026-10-08T09:00:00Z' }));
  service.fetchSongQueue = async () => ({ items: [...items, items[30]] });
  const first = await service.importFromSongQueue({ maxItems: 30 });
  assert.equal(first.imported, 30);
  const second = await service.importFromSongQueue({ maxItems: 30, importedRequestKeys: first.importedRequestKeys });
  assert.equal(second.imported, 1);
  assert.equal(second.tracks[0].songRequestKey, JSON.stringify(['31', items[30].created_at]));
  const third = await service.importFromSongQueue({ maxItems: 30, importedRequestKeys: second.importedRequestKeys });
  assert.equal(third.imported, 0);
  assert.deepEqual(matchedIds, items.map((item) => item.id));
});

test('song import retries failed matches and distinguishes reused numeric IDs by creation time', async () => {
  const { ImportService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/services/import-service.js'));
  let failed = true;
  let createdAt = '2026-10-08T09:00:00Z';
  const service = new ImportService({
    matchService: {
      async matchQueueItem() { return failed ? null : { autoAccept: true, track: { id: 'same-song' } }; },
    },
  });
  service.fetchSongQueue = async () => ({ items: [{ id: 1, created_at: createdAt }] });
  const first = await service.importFromSongQueue();
  assert.equal(first.skipped, 1);
  assert.equal(first.importedRequestKeys.length, 0);
  failed = false;
  const retry = await service.importFromSongQueue({ importedRequestKeys: first.importedRequestKeys });
  assert.equal(retry.imported, 1);
  const duplicate = await service.importFromSongQueue({ importedRequestKeys: retry.importedRequestKeys });
  assert.equal(duplicate.imported, 0);
  createdAt = '2026-10-09T09:00:00Z';
  const afterClear = await service.importFromSongQueue({ importedRequestKeys: retry.importedRequestKeys });
  assert.equal(afterClear.imported, 1);
  assert.equal(afterClear.importedRequestKeys.length, 1, 'keys for requests no longer active are pruned');
  assert.notEqual(afterClear.importedRequestKeys[0], retry.importedRequestKeys[0]);
});

test('timed out queue reads restore the import control and leave request history available for retry', async () => {
  const button = { disabled: false, dataset: {} };
  const state = { importedSongRequestKeys: ['already-imported'], selectedSource: 'qq' };
  const errors = [];
  let failed = true;
  let inserted = 0;
  let saved = 0;
  const { ImportService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/playback/services/import-service.js'), {
      AbortSignal: {
        timeout(ms) {
          assert.equal(ms, 10000);
          return AbortSignal.abort(new DOMException('Timed out', 'TimeoutError'));
        },
      },
      fetch: async (_url, options) => {
        assert.ok(options?.signal, 'queue reads must have a timeout');
        if (failed) options.signal.throwIfAborted();
        return response({ ok: true, data: { queue: { waiting: [{ id: 'new-request', song_name: '歌名' }] } } });
      },
    },
  );
  const { createImportHandler } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/playback/features/import-handler.js'),
    { document: { getElementById: () => button } },
  );
  const handler = createImportHandler({
    playbackState: state,
    importService: new ImportService({
      readJsonResponse: (r) => r.payload,
      matchService: { async matchQueueItem() { return { autoAccept: true, track: { id: 'new' } }; } },
    }),
    showError: (error) => errors.push(error.message),
    toast() {},
  });
  const callbacks = { insertPlaybackTracksNext: () => inserted++, savePlaybackState: () => saved++, renderPlayback() {} };
  await handler.importSongQueueToPlayback(callbacks);
  assert.deepEqual(errors, ['读取点歌队列超时，请稍后重试']);
  assert.equal(button.disabled, false);
  assert.deepEqual(state.importedSongRequestKeys, ['already-imported']);
  assert.equal(saved, 0);
  failed = false;
  await handler.importSongQueueToPlayback(callbacks);
  assert.equal(inserted, 1);
  assert.equal(saved, 1);
  assert.equal(button.disabled, false);
  assert.deepEqual(Array.from(state.importedSongRequestKeys), ['["new-request",""]']);
});

for (const stalledUrl of ['/api/music/search', '/api/music/match-track']) {
  test(`song matching times out ${stalledUrl} and continues with the fallback platform`, async () => {
    const controllers = [];
    const { MatchService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/services/match-service.js'), {
      AbortSignal: {
        timeout(ms) {
          assert.equal(ms, 30000);
          const controller = new AbortController();
          controllers.push(controller);
          return controller.signal;
        },
      },
      fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        const platform = body.platform || body.candidates[0].source;
        if (platform === 'qq' && url === stalledUrl) {
          assert.ok(options.signal, 'matching requests must have a timeout');
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
            queueMicrotask(() => controllers[0].abort(new DOMException('Timed out', 'TimeoutError')));
          });
        }
        return response({ ok: true, data: url.endsWith('/search')
          ? { tracks: [{ id: platform, source: platform, title: '歌名' }] }
          : { results: [{ autoAccept: true, score: 100, track: body.candidates[0] }] } });
      },
    });
    const service = new MatchService({ readJsonResponse: (r) => r.payload });
    const matched = await service.matchQueueItem({ song_name: '歌名' }, ['qq', 'netease']);
    assert.equal(matched.track.source, 'netease');
    assert.equal(controllers.length, 2);
    assert.equal(controllers[0].signal.aborted, true);
  });
}

test('playback success paths do not emit per-render or per-lyric console output', () => {
  const rendererSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'core', 'renderer.js'),
    'utf8',
  );
  const fullscreenSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js'),
    'utf8',
  );

  assert.doesNotMatch(rendererSource, /renderPlayback called/);
  assert.doesNotMatch(rendererSource, /Calling renderProviderState/);
  assert.doesNotMatch(fullscreenSource, /renderLyrics: re-rendering lyrics/);
  assert.doesNotMatch(fullscreenSource, /renderLyrics: lyric index changed/);
  assert.doesNotMatch(fullscreenSource, /scrollToActiveLyric:/);
  assert.match(fullscreenSource, /notifyMediaPlayFailure\(error, audio\)/);
});

test('fullscreen trial lyrics highlight and seek within the playable excerpt', async () => {
  const audio = { currentTime: 2, duration: 30, paused: false };
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/playback/ui/fullscreen.js'),
    { document: { getElementById: () => audio } },
  );
  const player = new FullscreenPlayer();
  const lines = [{ startMs: 0, text: '开头' }, { startMs: 30000, text: '试听' }];
  const track = { playbackTrial: true, playbackTrialStartMs: 30000, lyrics: { lines } };
  player.lyricsContainer = { querySelectorAll: () => lines, classList: { toggle() {} }, addEventListener() {} };
  const highlighted = [];
  player.updateLyricHighlight = (index) => highlighted.push(index);
  player.scrollToActiveLyric = () => {};
  const clickLyric = (startMs) => player.handleLyricClick({
    target: { closest: () => ({ dataset: { lyricStartMs: String(startMs) } }) },
  });
  player.renderLyrics(track, audio);
  assert.equal(highlighted.at(-1), 1);
  clickLyric(35000);
  assert.equal(audio.currentTime, 5);
  clickLyric(0);
  assert.equal(audio.currentTime, 5, 'lyrics before the excerpt cannot seek to the wrong line');
  clickLyric(70000);
  assert.equal(audio.currentTime, 5, 'lyrics after the excerpt cannot seek outside the audio');
  track.playbackTrial = false;
  audio.duration = 180;
  player.renderLyrics(track, audio);
  assert.equal(highlighted.at(-1), 0);
  clickLyric(35000);
  assert.equal(audio.currentTime, 35);
});

test('fullscreen track text and lyric highlights update only when their visible values change', async () => {
  const { FullscreenPlayer } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/ui/fullscreen.js'));
  const player = new FullscreenPlayer();
  let textWrites = 0;
  const textNode = () => {
    let text = '';
    return { get textContent() { return text; }, set textContent(value) { text = value; textWrites++; } };
  };
  player.titleEl = textNode();
  player.artistEl = textNode();
  const track = { title: '歌曲', artists: ['歌手'] };
  player.renderTrackInfo(track);
  for (let index = 0; index < 20; index++) player.renderTrackInfo({ ...track });
  assert.equal(textWrites, 2);
  player.renderTrackInfo({ title: '另一首', artists: ['另一位'] });
  assert.equal(player.titleEl.textContent, '另一首');
  assert.equal(player.artistEl.textContent, '另一位');

  let highlights = 0;
  const nodes = Array.from({ length: 2 }, () => {
    const node = { active: false };
    node.classList = { toggle(_name, active) { node.active = active; highlights++; } };
    return node;
  });
  player.lyricsContainer = { querySelectorAll: () => nodes, addEventListener() {} };
  player.updateLyricHighlight(0);
  for (let index = 0; index < 20; index++) player.updateLyricHighlight(0);
  assert.equal(highlights, 2);
  player.updateLyricHighlight(1);
  assert.deepEqual(nodes.map(node => node.active), [false, true]);
  player.updateLyricHighlight(0);
  assert.deepEqual(nodes.map(node => node.active), [true, false]);
  player._lastLyricLines = [{ text: '原文', translation: '翻译' }, { text: '第二句' }];
  player._toggleLyricMode('trans');
  nodes.forEach(node => { node.active = false; });
  player.updateLyricHighlight(0);
  assert.deepEqual(nodes.map(node => node.active), [true, false], 'rebuilding translated lines invalidates the highlight');
  player.updateLyricHighlight(-1);
  assert.deepEqual(nodes.map(node => node.active), [false, false]);
});

test('reopening fullscreen refreshes same-track lyrics and seek times without rebuilding unchanged lines', async () => {
  const audio = { currentTime: 1.8, duration: 180, paused: false };
  const { FullscreenPlayer } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/ui/fullscreen.js'), {
    document: { getElementById: () => audio },
  });
  const { createPlaybackStateActions } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/state/actions.js'));
  const player = new FullscreenPlayer();
  const state = { current: { id: 'qq:same-song', lyrics: { lines: [
    { startMs: 0, text: '旧歌词' }, { startMs: 5000, text: '旧第二句' },
  ] } }, history: [], displayHistory: [] };
  const actions = createPlaybackStateActions(state);
  let open = true;
  let rows = [];
  let rebuilds = 0;
  let highlights = 0;
  const listeners = new Map();
  player.fsEl = { classList: { contains: () => open } };
  player.scrollToActiveLyric = () => {};
  player.lyricsContainer = {
    classList: { toggle() {} },
    querySelectorAll: () => rows,
    addEventListener: (type, listener) => listeners.set(type, listener),
    set innerHTML(value) {
      rebuilds++;
      const starts = [...value.matchAll(/data-lyric-start-ms="([^"]+)"/g)];
      rows = [...value.matchAll(/<span class="lyric-text">([^<]*)<\/span>/g)].map((match, index) => {
        const row = { textContent: match[1], dataset: { lyricStartMs: starts[index][1] }, active: false };
        row.classList = { toggle(_name, active) { row.active = active; highlights++; } };
        return row;
      });
    },
  };
  player.render(state.current, audio);
  const oldRow = rows[0];
  assert.equal(oldRow.textContent, '旧歌词');
  open = false;
  actions.beginTrack({ id: 'qq:same-song' });
  player.render(state.current, audio);
  actions.setLyrics('qq:same-song', { lines: [
    { startMs: 1500, text: '更新歌词' }, { startMs: 5500, text: '更新第二句' },
  ] });
  player.render(state.current, audio);
  open = true;
  player.render(state.current, audio);
  assert.deepEqual(rows.map(row => row.textContent), ['更新歌词', '更新第二句']);
  assert.notEqual(rows[0], oldRow);
  assert.deepEqual(rows.map(row => row.active), [true, false]);
  listeners.get('click')({ target: { closest: () => rows[0] } });
  assert.equal(audio.currentTime, 1.5, 'the existing click handler reads the replacement lyric timestamp');
  const renderedRows = rows;
  const renderedCounts = { rebuilds, highlights };
  for (let index = 0; index < 20; index++) player.render(state.current, audio);
  assert.equal(rows, renderedRows);
  assert.deepEqual({ rebuilds, highlights }, renderedCounts, 'unchanged lyric arrays keep their nodes and highlight');
});

test('fullscreen manual browsing holds position until follow resumes', async () => {
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js'),
  );
  const player = new FullscreenPlayer();
  player.lyricsContainer = {
    scrollTop: 600,
    clientHeight: 300,
    classList: { toggle() {} },
    querySelector: () => ({ offsetTop: 300, clientHeight: 60, querySelector: () => null }),
  };
  player.followBtn = { hidden: true };
  player.setManualBrowsing(true);
  player.scrollToActiveLyric();
  assert.equal(player.lyricsContainer.scrollTop, 600);
  assert.equal(player.followBtn.hidden, false);
  player.setManualBrowsing(false);
  player.scrollToActiveLyric();
  assert.equal(player.lyricsContainer.scrollTop, 230);
  assert.equal(player.followBtn.hidden, true);
  player.fsEl = { dataset: { playerLayout: 'lyrics' } };
  player.scrollToActiveLyric();
  assert.equal(player.lyricsContainer.scrollTop, 180, 'lyrics-only mode centers the active line');
  player.fsEl = null;
  player.lyricsContainer.querySelector = () => ({ offsetTop: 300, clientHeight: 1200, querySelector: () => null });
  player.scrollToActiveLyric();
  assert.equal(player.lyricsContainer.scrollTop, 300, 'large wrapped lyrics keep their beginning visible');
});

test('oversized lyric positioning skips leading blank space and accounts for preview zoom', async () => {
  const { scrollActiveLyricIntoView } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'lyric-layout.js'),
  );
  for (const scale of [1, 0.5]) {
    const container = {
      scrollTop: 300, clientHeight: 300,
      querySelector: () => ({ offsetTop: 300, clientHeight: 1200, querySelector: () => ({ firstChild: {} }) }),
      getBoundingClientRect: () => ({ top: 100, height: 300 * scale }),
      ownerDocument: { createRange: () => ({
        setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ top: 100 + 700 * scale }),
      }) },
    };
    scrollActiveLyricIntoView(container);
    assert.equal(container.scrollTop, 1000);
    container.scrollTop = 300;
    scrollActiveLyricIntoView(container, { center: true });
    assert.equal(container.scrollTop, 946, 'oversized lyrics start below the lyrics-only edge fade');
  }
});

test('fullscreen resets lyric mode before rendering a different track', async () => {
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js'),
  );
  const player = new FullscreenPlayer();
  let renderedMode = '';

  player.fsEl = { classList: { contains: () => true } };
  player.lyricMode = 'trans';
  player._lastLyricTrackId = 'old-track';
  player.lyricTogglesEl = { style: {} };
  player.renderTrackInfo = () => {};
  player.renderArtwork = () => {};
  player.applyBackgroundTheme = () => {};
  player.updateVinylAnimation = () => {};
  player.renderLyrics = () => {
    renderedMode = player.lyricMode;
  };

  player.render({ id: 'new-track', lyrics: { lines: [] } }, { paused: false });

  assert.equal(renderedMode, 'none');
  assert.equal(player.lyricMode, 'none');
  assert.equal(player._lastLyricTrackId, 'new-track');
});

test('fullscreen lyric buttons follow available track data in romanization-first order', async () => {
  const html = readAdminFragmentHtml('pages/admin/playback/fullscreen.html');
  const romaButtonPosition = html.indexOf('id="fsRomaToggleBtn"');
  const translationButtonPosition = html.indexOf('id="fsTranslationToggleBtn"');

  assert.ok(romaButtonPosition >= 0, 'romanization button should exist');
  assert.ok(translationButtonPosition >= 0, 'translation button should exist');
  assert.ok(romaButtonPosition < translationButtonPosition, 'romanization button should be above translation');

  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js'),
  );
  const player = new FullscreenPlayer();
  player.lyricTogglesEl = { style: {} };
  player.romaToggleBtn = createLyricToggleButton();
  player.translationToggleBtn = createLyricToggleButton();

  player._updateLyricToggles({ lyrics: { lines: [{ roma: 'romaji' }] } });
  assert.equal(player.lyricTogglesEl.style.display, 'flex');
  assert.equal(player.romaToggleBtn.style.display, 'grid');
  assert.equal(player.translationToggleBtn.style.display, 'none');

  player._updateLyricToggles({
    lyrics: { lines: [{ translation: '中文译' }] },
  });
  assert.equal(player.romaToggleBtn.style.display, 'none');
  assert.equal(player.translationToggleBtn.style.display, 'grid');

  player._updateLyricToggles({
    lyrics: { lines: [{ roma: 'romaji', translation: '中文译' }] },
  });
  assert.equal(player.romaToggleBtn.style.display, 'grid');
  assert.equal(player.translationToggleBtn.style.display, 'grid');

  player._updateLyricToggles({ lyrics: { lines: [{ text: '原文' }] } });
  assert.equal(player.lyricTogglesEl.style.display, 'none');
  assert.equal(player.romaToggleBtn.style.display, 'none');
  assert.equal(player.translationToggleBtn.style.display, 'none');
});

test('fullscreen lyric buttons switch mutually exclusively and close the active mode', async () => {
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js'),
  );
  const player = new FullscreenPlayer();
  let renderCount = 0;

  player.romaToggleBtn = createLyricToggleButton();
  player.translationToggleBtn = createLyricToggleButton();
  player._lastLyricLines = [{ text: '原文' }];
  player.renderLyricLines = () => {
    renderCount += 1;
  };

  player._toggleLyricMode('roma');
  assert.equal(player.lyricMode, 'roma');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), true);
  assert.equal(player.translationToggleBtn.classList.contains('mode-trans'), false);

  player._toggleLyricMode('trans');
  assert.equal(player.lyricMode, 'trans');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), false);
  assert.equal(player.translationToggleBtn.classList.contains('mode-trans'), true);

  player._toggleLyricMode('trans');
  assert.equal(player.lyricMode, 'none');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), false);
  assert.equal(player.translationToggleBtn.classList.contains('mode-trans'), false);
  assert.equal(renderCount, 3);
});

test('liked tracks continue past fifty full pages', async () => {
  let requestCount = 0;
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      async fetch(_url, options) {
        const { offset } = JSON.parse(options.body);
        requestCount += 1;
        const tracks =
          offset < 5100
            ? Array.from({ length: 100 }, (_, index) => ({
                id: `track-${offset + index}`,
              }))
            : [];
        return response({ ok: true, data: { tracks } });
      },
    },
  );
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    readJsonResponse: async (result) => result.payload,
  });

  const result = await loader._fetchLikedTracksAll('Liked');

  assert.equal(result.items.length, 5100);
  assert.equal(requestCount, 52);
});

test('liked tracks stop when a provider repeats a full page', async () => {
  let requestCount = 0;
  const repeatedTracks = Array.from({ length: 100 }, (_, index) => ({
    id: `track-${index}`,
  }));
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      async fetch() {
        requestCount += 1;
        return response({ ok: true, data: { tracks: repeatedTracks } });
      },
    },
  );
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    readJsonResponse: async (result) => result.payload,
  });

  const result = await loader._fetchLikedTracksAll('Liked');

  assert.equal(result.items.length, 100);
  assert.equal(requestCount, 2);
});

test('only the latest playback search updates state and renders', async () => {
  const pending = new Map();
  const renderedIds = [];
  let keyword = 'old';
  const document = {
    getElementById() {
      return { textContent: '' };
    },
  };
  const { SearchService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'search-service.js'),
    {
      fetch(_url, options) {
        const request = JSON.parse(options.body);
        return new Promise((resolve) => pending.set(request.keyword, resolve));
      },
    },
  );
  const searchService = new SearchService({
    state: { selectedSource: 'test' },
    readJsonResponse: async (searchResponse) => searchResponse.payload,
  });
  const { createSearchHandler } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'features', 'search-handler.js'),
    { document },
  );
  const handler = createSearchHandler({
    playbackState: {},
    searchService,
    value(id) {
      return id === 'playbackSearchKeyword' ? keyword : '9';
    },
    toast() {},
    renderPlaybackSearchResults() {
      renderedIds.push(searchService.getResults()[0]?.id ?? '');
    },
  });

  const oldSearch = handler.runPlaybackSearch();
  keyword = 'new';
  const newSearch = handler.runPlaybackSearch();
  pending.get('new')(response({ ok: true, data: { tracks: [{ id: 'new-result' }] } }));
  await newSearch;
  pending.get('old')(response({ ok: true, data: { tracks: [{ id: 'old-result' }] } }));
  await oldSearch;

  assert.equal(searchService.getResults()[0]?.id, 'new-result');
  assert.deepEqual(renderedIds, ['new-result']);
});

test('playback overlays mount unique titles and lyric controls in the actual page', () => {
  const tags = [...readAdminHtml().matchAll(/<[^/!][^>]*>/g)].map(([tag]) => tag);
  for (const id of ['playbackDrawerTitle', 'queuePopupTitle', 'fsRomaToggleBtn', 'fsTranslationToggleBtn']) {
    assert.equal(tags.filter((tag) => new RegExp(`\\sid=["']${id}["']`).test(tag)).length, 1);
  }
});
