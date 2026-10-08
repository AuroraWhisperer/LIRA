'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');
const { createLyricToggleButton, loadModuleExports, response } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

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

test('failed queue reads restore the import control and leave request history available for retry', async () => {
  const button = { disabled: false };
  const state = { importedSongRequestKeys: ['already-imported'], selectedSource: 'qq' };
  const errors = [];
  let failed = true;
  let inserted = 0;
  let saved = 0;
  const { createImportHandler } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/playback/features/import-handler.js'),
    { document: { getElementById: () => button } },
  );
  const handler = createImportHandler({
    playbackState: state,
    importService: {
      async importFromSongQueue() {
        if (failed) throw new Error('读取点歌队列失败');
        return { tracks: [{ id: 'new' }], imported: 1, pending: 0, skipped: 0, importedRequestKeys: ['already-imported', 'new-request'] };
      },
    },
    showError: (error) => errors.push(error.message),
    toast() {},
  });
  const callbacks = { insertPlaybackTracksNext: () => inserted++, savePlaybackState: () => saved++, renderPlayback() {} };
  await handler.importSongQueueToPlayback(callbacks);
  assert.deepEqual(errors, ['读取点歌队列失败']);
  assert.equal(button.disabled, false);
  assert.deepEqual(state.importedSongRequestKeys, ['already-imported']);
  assert.equal(saved, 0);
  failed = false;
  await handler.importSongQueueToPlayback(callbacks);
  assert.equal(inserted, 1);
  assert.equal(saved, 1);
  assert.equal(button.disabled, false);
  assert.deepEqual(state.importedSongRequestKeys, ['already-imported', 'new-request']);
});

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

test('fullscreen manual browsing holds position until follow resumes', async () => {
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js'),
  );
  const player = new FullscreenPlayer();
  player.lyricsContainer = {
    scrollTop: 600,
    clientHeight: 300,
    classList: { toggle() {} },
    querySelector: () => ({ offsetTop: 300, clientHeight: 60 }),
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
  const html = readAdminHtml();
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

test('playback drawer and queue have unique title anchors in the actual page', () => {
  const tags = [...readAdminHtml().matchAll(/<[^/!][^>]*>/g)].map(([tag]) => tag);
  for (const id of ['playbackDrawerTitle', 'queuePopupTitle']) {
    assert.equal(tags.filter((tag) => new RegExp(`\\sid=["']${id}["']`).test(tag)).length, 1);
  }
});
