'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');
const {
  createLyricToggleButton,
  loadModuleExports,
  response,
} = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

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
  assert.ok(
    romaButtonPosition < translationButtonPosition,
    'romanization button should be above translation',
  );

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
  assert.equal(
    player.translationToggleBtn.classList.contains('mode-trans'),
    false,
  );

  player._toggleLyricMode('trans');
  assert.equal(player.lyricMode, 'trans');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), false);
  assert.equal(
    player.translationToggleBtn.classList.contains('mode-trans'),
    true,
  );

  player._toggleLyricMode('trans');
  assert.equal(player.lyricMode, 'none');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), false);
  assert.equal(
    player.translationToggleBtn.classList.contains('mode-trans'),
    false,
  );
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
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'playback',
      'services',
      'search-service.js',
    ),
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
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'playback',
      'features',
      'search-handler.js',
    ),
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
  pending.get('new')(
    response({ ok: true, data: { tracks: [{ id: 'new-result' }] } }),
  );
  await newSearch;
  pending.get('old')(
    response({ ok: true, data: { tracks: [{ id: 'old-result' }] } }),
  );
  await oldSearch;

  assert.equal(searchService.getResults()[0]?.id, 'new-result');
  assert.deepEqual(renderedIds, ['new-result']);
});

test('playback workspace keeps semantic hierarchy and presentation typography', () => {
  const html = readAdminHtml();
  const playbackCssDir = path.join(ROOT_DIR, 'public', 'css', 'playback');
  const playbackCssFiles = [
    'dialogs.css',
    'drawer.css',
    'fullscreen.css',
    'header.css',
    'player.css',
    'queue-modal.css',
    'responsive.css',
    'song-row.css',
    path.join('panels', 'confirm-dialog.css'),
    path.join('panels', 'discovery.css'),
    path.join('panels', 'match.css'),
    path.join('panels', 'queue.css'),
    path.join('panels', 'search.css'),
    path.join('panels', 'track-menu.css'),
    path.join('panels', 'user-and-health.css'),
    path.join('panels', 'wesing.css'),
  ];
  const playbackCss = playbackCssFiles
    .map((file) => fs.readFileSync(path.join(playbackCssDir, file), 'utf8'))
    .join('\n');
  const drawerSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'drawer.js'),
    'utf8',
  );
  const queueSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'queue-popup.js'),
    'utf8',
  );

  assert.doesNotMatch(html, /class="ui-page-title playback-workspace-title"/);
  assert.match(html, /id="playbackDrawerTitle" class="ui-section-title"/);
  assert.match(html, /id="queuePopupTitle" class="ui-section-title"/);
  assert.doesNotMatch(playbackCss, /^\s*;\s*$/m);

  assert.match(playbackCss, /\.player-fs-title\s*\{[\s\S]*?font-size:\s*42px;/);
  assert.match(playbackCss, /\.lyric-text\s*\{[\s\S]*?font-size:\s*32px;/);
  assert.match(
    playbackCss,
    /\.playback-quality-btn\s*\{[\s\S]*?font-size:\s*var\(--type-size-control\);/,
  );
  assert.match(
    playbackCss,
    /\.queue-popup-head strong\s*\{[\s\S]*?font-size:\s*var\(--type-size-section-title\);/,
  );

  assert.match(drawerSource, /playback-drawer-loading ui-body/);
  assert.match(
    drawerSource,
    /playback-drawer-state playback-drawer-error ui-caption/,
  );
  assert.match(
    drawerSource,
    /playback-drawer-state playback-drawer-empty ui-caption/,
  );
  assert.match(queueSource, /<h3 class="ui-card-title">/);
});
