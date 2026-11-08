'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { normalizeSceneConfig, createSceneComponentPorts } = require('../../src/server/scene-components');
const { normalizeSceneExtraConfig } = require('../../src/server/scene-extra-config');
const { normalizeSceneDocument } = require('../../src/scenes/scene-contract');
const { createSceneStore } = require('../../src/storage/scene-store');
const { migrateScenes, migrateComponentOutputSizes, migrateCanvasPresets, migrateSceneDeletion } = require('../../src/storage/scene-migration');
const { createSceneService } = require('../../src/scenes/scene-service');
const { createSceneExtraDisplay } = require('../../src/server/scene-extra-display');
const { createSongStore } = require('../../src/storage/song-store');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { listSongs } = require('../../src/music/song-service');
const { createGameSessionService } = require('../../src/games/game-session-service');
const { chooseGameWord } = require('../helpers/draw-guess');

function documentFor(type, config = createSceneExtraDefaults(type)) {
  return { schemaVersion: 1, id: randomUUID(), title: '新组件', canvas: { width: 1920, height: 1080 },
    items: [{ id: randomUUID(), type, name: type, x: 10, y: 20, width: 400, height: 300,
      visible: true, locked: false, appearance: { mode: 'independent', config } }] };
}

test('heart collection loads older style-only configurations and preserves the explicit rewards switch', () => {
  for (const displayStyle of ['task', 'compact']) {
    assert.equal(normalizeSceneConfig('heart-box-collection', { displayStyle }).showRewards, true);
    const config = normalizeSceneConfig('heart-box-collection', { displayStyle, showRewards: false });
    const saved = normalizeSceneDocument(documentFor('heart-box-collection', config), { normalizeConfig: normalizeSceneConfig });
    assert.equal(saved.items[0].appearance.config.showRewards, false);
  }
});

test('conditional scene data prepares unchanged songs and lyric timelines once but keeps the playback clock live', t => {
  let owner = { scope: 'a', epoch: 1 }, revision = 1, currentMs = 0;
  let songReads = 0, lineReads = 0;
  let timeline = { lines: Array.from({ length: 500 }, (_, index) => ({ startMs: index * 1000,
    get text() { lineReads++; return `line-${index}`; } })) };
  const songs = Array.from({ length: 5000 }, (_, id) => ({ id, name: `song-${id}` }));
  const extra = createSceneExtraDisplay({ getOwner: () => owner, displayPorts: { songs: {
    getChangeToken: () => revision, list() { songReads++; return songs; },
  } } });
  const ports = createSceneComponentPorts({ getExtraDisplay: extra,
    getState: () => ({ lyricState: { currentMs }, lyricTimeline: timeline }) });
  const firstVersions = { known: {}, current: {} };
  const first = ports.getDisplayData(['songlist', 'lyrics'], { dataVersions: firstVersions });
  assert.equal(first.songlist.songs.length, 5000);
  assert.equal(first.lyrics.lyricTimeline.lines.length, 500);
  first.songlist.songs[0].name = 'consumer mutation';
  for (let index = 1; index < 3; index++) {
    currentMs = index * 250;
    const versions = { known: firstVersions.current, current: {} };
    const data = ports.getDisplayData(['songlist', 'lyrics'], { dataVersions: versions });
    assert.equal(Object.hasOwn(data, 'songlist'), false);
    assert.equal(Object.hasOwn(data.lyrics, 'lyricTimeline'), false);
    assert.equal(data.lyrics.lyricState.currentMs, currentMs);
  }
  assert.equal(songReads, 1);
  assert.equal(lineReads, 500);
  revision++;
  timeline = { lines: [{ startMs: 0, text: 'changed' }] };
  const changed = ports.getDisplayData(['songlist', 'lyrics'], { dataVersions: { known: firstVersions.current, current: {} } });
  assert.equal(changed.songlist.songs[0].name, 'song-0');
  assert.equal(changed.lyrics.lyricTimeline.lines[0].text, 'changed');
  owner = { scope: 'b', epoch: 2 };
  assert.ok(ports.getDisplayData(['songlist'], { dataVersions: { known: firstVersions.current, current: {} } }).songlist);
  assert.ok(ports.getDisplayData(['lyrics'], {}).lyrics.lyricTimeline, 'legacy reads remain complete');
});

test('mixed scenes skip unchanged queue, wheel and game reads but reconcile changes and owner transitions', () => {
  let time = 0;
  let owner = { scope: 'a', epoch: 1 };
  const reads = { queue: 0, wheel: 0, games: 0 };
  const extra = createSceneExtraDisplay({ getOwner: () => owner, displayPorts: {
    wheel: { getState() { reads.wheel++; return { entries: [] }; } },
    games: { getSession() { reads.games++; return null; } },
  } });
  const ports = createSceneComponentPorts({ getOwner: () => owner, now: () => time, getExtraDisplay: extra,
    getState(fields) {
      if (fields.includes('queue')) reads.queue++;
      return { queue: [], superChats: [], roomGuard: { roomId: '123', count: 1 },
        lyricState: { currentMs: time }, lyricTimeline: null };
    } });
  let versions = {};
  function read() {
    const request = { dataVersions: { known: versions, current: {} } };
    const result = ports.getDisplayData(['queue', 'wheel', 'games', 'lyrics'], request);
    versions = request.dataVersions.current;
    return result;
  }
  read();
  for (let index = 1; index <= 20; index++) {
    time += 100;
    const data = read();
    assert.equal(Object.hasOwn(data, 'queue'), false);
    assert.equal(Object.hasOwn(data, 'wheel'), false);
    assert.equal(Object.hasOwn(data, 'games'), false);
    assert.equal(data.lyrics.lyricState.currentMs, time);
  }
  assert.deepEqual(reads, { queue: 1, wheel: 1, games: 1 });
  ports.invalidateDisplay(['queue']);
  assert.ok(read().queue);
  assert.deepEqual(reads, { queue: 2, wheel: 1, games: 1 });
  time = 5000;
  assert.ok(read().wheel, 'periodic reconciliation still reads state without a notification');
  owner = { scope: 'b', epoch: 2 };
  assert.ok(read().games, 'old-owner versions cannot suppress the new baseline');
  assert.ok(ports.getDisplayData(['queue', 'wheel', 'games'], {}).queue, 'legacy requests remain complete');
});

test('negotiated scene game parts follow independent drawing and score revisions while chat stays live', t => {
  let owner = { scope: 'a', epoch: 1 };
  let ports;
  let canvasCopies = 0, scoreCopies = 0;
  const games = createGameSessionService({ monotonicNow: () => 1000, setTimeout: () => null, clearTimeout() {},
    drawGuessWords: [{ word: '猫', category: '动物' }], broadcast: () => ports?.invalidateDisplay(['games']) });
  t.after(() => games.dispose());
  const extra = createSceneExtraDisplay({ getOwner: () => owner, displayPorts: { games: {
    getSession: games.getSession,
    getDisplaySession(known) {
      const value = games.getDisplaySession(known);
      if (value.session?.state.canvas) canvasCopies++;
      if (value.session?.state.scores) scoreCopies++;
      return value;
    },
  } } });
  ports = createSceneComponentPorts({ getOwner: () => owner, getExtraDisplay: extra, getState: () => ({}) });
  games.start({ game: 'draw-guess', totalRounds: 2 }); chooseGameWord(games);
  games.draw({ action: 'append', clientId: 'p', strokeId: 's', color: '#222034', width: 4,
    points: [{ x: 0.1, y: 0.1 }] });
  let known = {};
  function read(incrementalParts = true) {
    const request = { incrementalParts, dataVersions: { known, current: {} } };
    const value = ports.getDisplayData(['games'], request);
    known = request.dataVersions.current;
    return value.games?.session;
  }
  const first = read();
  assert.equal(first.state.canvas.strokes[0].points.length, 1);
  const initialVersions = { ...known };
  assert.equal(read(), undefined);
  assert.deepEqual(known, initialVersions, 'an unchanged top-level game read retains its part acknowledgements');
  for (let index = 0; index < 30; index++) {
    games.handleDanmaku({ uid: String(index + 1), message: `chat-${index}` });
    const value = read();
    assert.equal(value.danmaku.at(-1).message, `chat-${index}`);
    assert.equal(value.state.canvas, undefined);
    assert.equal(value.state.correct, undefined);
    assert.equal(value.state.scores, undefined);
  }
  assert.equal(canvasCopies, 1);
  assert.equal(scoreCopies, 1);
  games.handleDanmaku({ uid: '1', message: '猫' });
  const scored = read();
  assert.equal(scored.state.scores[0].score, 10);
  assert.equal(scored.state.canvas, undefined);
  games.updateDanmakuAvatar({ uid: '1', avatarUrl: 'https://i0.hdslb.com/a.png' });
  assert.equal(read().state.scores, undefined, 'avatar hydration does not invalidate drawing or scores');
  games.draw({ action: 'clear', clientId: 'p' });
  const cleared = read();
  assert.equal(cleared.state.canvas.strokes.length, 0);
  assert.equal(cleared.state.scores, undefined);
  games.handleDanmaku({ uid: '2', message: 'legacy' });
  assert.ok(read(false).state.canvas, 'old consumers still receive full nested snapshots after game changes');
  assert.equal(known.gamesCanvas, undefined);
  assert.equal(known.gamesScores, undefined);
  owner = { scope: 'b', epoch: 2 };
  known = initialVersions;
  const newOwner = read();
  assert.ok(newOwner.state.canvas);
  assert.equal(newOwner.state.scores[0].score, 10);
  games.move({ action: 'finish-round' }); games.move({ action: 'reveal-answer' }); games.move({ action: 'next-round' });
  const nextRound = read();
  assert.equal(nextRound.state.round, 2);
  assert.deepEqual(nextRound.state.correct, []);
  assert.equal(nextRound.state.scores[0].score, 10);
  assert.deepEqual(nextRound.state.canvas.strokes, []);
  games.stop();
  assert.equal(read(), null);
  games.start({ game: 'number-bomb' });
  assert.equal(read().game, 'number-bomb');
  assert.equal(games.getSession().state.secret, undefined);
});

test('scene gift feeds reuse full scans, cards and catalog while checking independent profile changes', async () => {
  let now = Date.parse('2026-09-19T08:00:00Z');
  let historyReads = 0, catalogReads = 0, profileRevision = 'one';
  let contentRevision = 'a'.repeat(64);
  const day = '2026-09-19';
  const items = Array.from({ length: 5000 }, (_, index) => ({ eventId: `gift-${index}`,
    sortId: 5000 - index, sortTime: '2026-09-19T01:00:00Z',
    gift: { userName: 'before', giftId: '1', giftName: 'gift', num: 1, unitPrice: 1, createdAt: '2026-09-19T01:00:00Z' } }));
  const displayPorts = {
    gifts: { getViewRevision: () => 'source', getHistory(options) {
      historyReads++;
      if (options.contentRevision === contentRevision) return { viewRevision: 'source', contentRevision, unchanged: true, items: [], nextCursor: null };
      if (options.delta && options.contentRevision === 'a'.repeat(64)) return { viewRevision: 'source', contentRevision,
        delta: true, removedEventIds: [], items: [items[0]], nextCursor: null };
      const offset = Number(options.cursor || 0);
      return { viewRevision: 'source', contentRevision, items: items.slice(offset, offset + 100),
        nextCursor: offset + 100 < items.length ? String(offset + 100) : null };
    } },
    giftCards: { getProfiles: async () => ({ viewRevision: 'source', day, contentRevision: profileRevision,
      items: items.map(item => ({ eventId: item.eventId, senderId: '123', userName: profileRevision, createdAt: item.gift.createdAt })) }) },
    overtime: { getGlobalGiftCatalog() { catalogReads++; return { gifts: [] }; } },
  };
  const read = createSceneExtraDisplay({ displayPorts, getOwner: () => ({ scope: 'a', epoch: 1 }), now: () => now });
  const versions = { known: {}, current: {} };
  const first = await read('gift-feed', undefined, { dataVersions: versions });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].gift.num, 5000);
  for (let index = 1; index < 3; index++) {
    now += 6000;
    assert.equal(await read('gift-feed', undefined, { dataVersions: { known: versions.current, current: {} } }), undefined);
  }
  assert.equal(historyReads, 52);
  assert.equal(catalogReads, 1);
  assert.equal((await read('gift-feed')).items, first.items, 'legacy output reuses the prepared cards');
  now += 6000; profileRevision = 'two';
  const changed = await read('gift-feed', undefined, { dataVersions: { known: versions.current, current: {} } });
  assert.equal(changed.items[0].gift.userName, 'two');
  now += 6000;
  contentRevision = 'b'.repeat(64);
  items.unshift({ ...items[0], eventId: 'new', sortId: 5001 });
  const beforeDelta = historyReads;
  const incremental = await read('gift-feed');
  assert.equal(historyReads - beforeDelta, 1);
  assert.equal(incremental.items[0].gift.num, 5001);
  read.invalidate(['gift-feed']);
  await read('gift-feed');
  assert.equal(catalogReads, 2);
});

test('mixed lyric scenes reuse the song query until a write or owner change, without delaying lyrics', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(SONG_SCHEMA);
  db.exec("INSERT INTO songs(name, created_at, updated_at) VALUES ('first', '', '')");
  const store = createSongStore(db);
  let owner = { scope: 'streamer-a', epoch: 1 };
  let reads = 0;
  let currentMs = 100;
  const displayPorts = { songs: {
    getChangeToken: store.getChangeToken,
    list(options) { reads++; return listSongs(store, options); },
  } };
  const display = createSceneExtraDisplay({ displayPorts, getOwner: () => owner });
  const ports = createSceneComponentPorts({ getExtraDisplay: display,
    getState: () => ({ lyricState: { currentMs, playing: true }, lyricTimeline: { lines: [] } }) });
  const read = () => ports.getDisplayData(['songlist', 'lyrics'], {});
  const first = read();
  assert.equal(first.songlist.songs[0].name, 'first');
  first.songlist.songs[0].name = 'consumer mutation';
  currentMs = 350;
  const second = read();
  assert.equal(second.lyrics.lyricState.currentMs, 350);
  assert.equal(second.songlist.songs[0].name, 'first');
  assert.equal(reads, 1);
  db.exec("UPDATE songs SET name='updated'");
  assert.equal(read().songlist.songs[0].name, 'updated');
  assert.equal(reads, 2);
  db.exec('UPDATE songs SET is_enabled=0');
  assert.deepEqual(read().songlist.songs, []);
  assert.equal(reads, 3);
  owner = { scope: 'streamer-b', epoch: 1 };
  read();
  assert.equal(reads, 4);
  owner.epoch++;
  read();
  assert.equal(reads, 5);
  display.invalidate(['songlist']);
  read();
  assert.equal(reads, 6);
});

test('standalone color alpha survives scene normalization while paired opacity retains its own field', () => {
  for (const [type, definition] of Object.entries(SCENE_EXTRA_COMPONENTS)) {
    for (const [key, field] of Object.entries(definition.fields)) {
      if (field.type !== 'color') continue;
      if (field.opacity) {
        const config = normalizeSceneConfig(type, { ...createSceneExtraDefaults(type), [key]: '#123456', [field.opacity]: 0 });
        const saved = normalizeSceneDocument(documentFor(type, config), { normalizeConfig: normalizeSceneConfig });
        assert.equal(saved.items[0].appearance.config[key], '#123456');
        assert.equal(Number(saved.items[0].appearance.config[field.opacity]), 0);
        continue;
      }
      const config = { ...createSceneExtraDefaults(type), [key]: '#12345680' };
      const saved = normalizeSceneDocument(documentFor(type, config), { normalizeConfig: normalizeSceneConfig });
      assert.equal(saved.items[0].appearance.config[key], '#12345680');
    }
  }
});

test('backgrounds default to empty and preserve explicit legacy presets through template import', () => {
  const { importSceneTemplate } = require('../../public/js/admin/scene-template.js');
  const input = documentFor('background', { style: 'moonlit' });
  assert.deepEqual(normalizeSceneConfig('background', {}), createSceneExtraDefaults('background'));
  const imported = importSceneTemplate(input);
  assert.deepEqual(imported.bindings, []);
  assert.equal(imported.document.items[0].appearance.config.style, 'moonlit');
  assert.notEqual(imported.document.items[0].id, input.items[0].id);
});

test('windowlight backgrounds preserve manual scenes and timed rotation through scene normalization', () => {
  const config = normalizeSceneConfig('background', { style: 'windowlight', sceneMode: 'auto', windowScene: 'rainy', sceneIntervalSeconds: 37 });
  const scene = normalizeSceneDocument(documentFor('background', config), { normalizeConfig: normalizeSceneConfig });
  assert.equal(scene.items[0].appearance.config.sceneMode, 'auto');
  assert.equal(scene.items[0].appearance.config.windowScene, 'rainy');
  assert.equal(scene.items[0].appearance.config.sceneIntervalSeconds, 37);
  for (const seconds of [9, 10.5, 3601]) {
    assert.throws(() => normalizeSceneConfig('background', { style: 'windowlight', sceneIntervalSeconds: seconds }), { code: 'INVALID_SCENE_CONFIG' });
  }
  for (const snapshot of [{ sceneMode: 'auto' }, { windowScene: 'rainy' }, { sceneIntervalSeconds: 60 }]) {
    assert.throws(() => normalizeSceneConfig('background', { style: 'windowlight', backgroundDefaults: snapshot }), { code: 'INVALID_SCENE_CONFIG' });
  }
});

test('background parameters preserve legacy fit and validate default snapshots independently', () => {
  const { getBackgroundAppearance } = require('../../public/js/shared/background-appearance.js');
  const { createMediaStyle } = require('../../public/js/shared/component-media-style.js');
  const mediaStyle = createMediaStyle('background', { id: randomUUID(), kind: 'video', width: 1920, height: 1080,
    src: `/component-media/${randomUUID()}/${'a'.repeat(64)}.webm` });
  mediaStyle.volume = 0.25;
  const legacy = normalizeSceneConfig('background', { style: 'none', mediaStyle });
  assert.equal(legacy.fit, 'fill');
  assert.equal(legacy.volume, 0.25);
  for (const key of ['fit', 'volume']) assert.throws(() => normalizeSceneConfig('background', { ...legacy, [key]: null }), { code: 'INVALID_SCENE_CONFIG' });
  const defaults = { opacity: 0.7, blur: 4, fit: 'contain', playbackRate: 0.75 };
  const config = normalizeSceneConfig('background', { ...legacy, opacity: 0.4, blur: 12, backgroundDefaults: defaults });
  assert.equal(config.opacity, 0.4);
  assert.deepEqual(config.backgroundDefaults, getBackgroundAppearance(defaults));
  const normalized = normalizeSceneDocument(documentFor('background', config), { normalizeConfig: normalizeSceneConfig });
  assert.deepEqual(normalized.items[0].appearance.config, config);
  assert.notEqual(normalized.items[0].appearance.config.backgroundDefaults, config.backgroundDefaults);
  for (const value of [null, [], { blur: 31 }, { playbackRate: 0.4 }, { opacity: -0.1 }, { volume: 1.1 },
    { overlayColor: 'url(private)' }, { style: 'moonlit' }, { backgroundDefaults: {} }, { token: 'secret' }]) {
    assert.throws(() => normalizeSceneConfig('background', { style: 'none', backgroundDefaults: value }), { code: 'INVALID_SCENE_CONFIG' });
  }
  assert.throws(() => normalizeSceneConfig('opening', { style: 'original', backgroundDefaults: defaults }), { code: 'INVALID_SCENE_CONFIG' });
});

test('background filters validate relations and preserve authored defaults through scene normalization', () => {
  const filters = { colorProcessing: 'standard', temperature: 35, tint: -10, liftRed: 0.05, gammaBlue: 1.2, gainGreen: 0.9,
    preserveLuminance: false, shadowColor: '#789abc', shadowStrength: 0.2,
    glowMode: 'star', glowStrength: 0.8, glowThreshold: 0.65, glowSoftness: 0.15, irisBlur: 12,
    vignetteOpacity: 0.3, levelsChannel: 'b', inputBlack: 10, inputWhite: 230, gamma: 1.2, grainSize: 2.5, grainStrength: 0.1 };
  const config = normalizeSceneConfig('background', { ...filters, backgroundDefaults: filters });
  const scene = normalizeSceneDocument(documentFor('background', config), { normalizeConfig: normalizeSceneConfig });
  for (const [key, value] of Object.entries(filters)) {
    assert.equal(scene.items[0].appearance.config[key], value);
    assert.equal(scene.items[0].appearance.config.backgroundDefaults[key], value);
  }
  for (const invalid of [{ inputBlack: 50, inputWhite: 50 }, { outputBlack: 150, outputWhite: 100 }, { gamma: 0 },
    { glowMode: 'unknown' }, { liftBlue: .001 }]) {
    assert.throws(() => normalizeSceneConfig('background', invalid), { code: 'INVALID_SCENE_CONFIG' });
  }
  assert.throws(() => normalizeSceneConfig('background', { backgroundDefaults: { inputBlack: 50, inputWhite: 50 } }), { code: 'INVALID_SCENE_CONFIG' });
});

test('background color processing preserves old non-neutral values and defaults new appearances to standard', () => {
  const { getBackgroundAppearance } = require('../../public/js/shared/background-appearance.js');
  for (const [config, mode] of [
    [{}, 'standard'], [{ temperature: 0, tint: '0' }, 'standard'], [{ glowStrength: .3 }, 'standard'],
    [{ temperature: 20 }, 'legacy'], [{ tint: '-10' }, 'legacy'], [{ midtoneStrength: .2 }, 'legacy'],
    [{ colorProcessing: 'standard', temperature: 20 }, 'standard'],
    [{ colorProcessing: 'legacy', temperature: 0 }, 'legacy'],
  ]) {
    const normalized = normalizeSceneConfig('background', { ...config, backgroundDefaults: config });
    assert.equal(getBackgroundAppearance(config).colorProcessing, mode);
    assert.equal(normalized.colorProcessing, mode);
    assert.equal(normalized.backgroundDefaults.colorProcessing, mode);
    assert.deepEqual(normalizeSceneConfig('background', normalized), normalized);
  }
});

test('opening appearances preserve client-following, built-in and suite styles', () => {
  assert.deepEqual(normalizeSceneConfig('opening', {}), { style: 'original' });
  for (const style of ['classic', 'pixel-cassette', 'moonlit-fan']) {
    assert.deepEqual(normalizeSceneConfig('opening', { style }), { style });
  }
  assert.throws(() => normalizeSceneConfig('opening', { style: 'unknown' }), { code: 'INVALID_SCENE_CONFIG' });
  assert.throws(() => normalizeSceneConfig('opening', { style: 'moonlit-fan', enabled: true }), { code: 'INVALID_SCENE_CONFIG' });
});

test('guard thanks preserves legacy event styles and saves each explicit built-in style', () => {
  const defaults = normalizeSceneConfig('guard-thanks', {});
  assert.equal(defaults.style, 'follow');
  assert.equal(defaults.textMode, 'follow');
  assert.equal(normalizeSceneConfig('guard-thanks', { textMode: 'en' }).textMode, 'en');
  for (const style of ['aurora', 'classic']) {
    const saved = normalizeSceneConfig('guard-thanks', { style, textMode: 'zh' });
    assert.equal(saved.style, style);
    assert.equal(saved.textMode, 'zh');
  }
  assert.throws(() => normalizeSceneConfig('guard-thanks', { style: 'unknown' }), { code: 'INVALID_SCENE_CONFIG' });
});

test('each extra component accepts all declared presets and preserves its geometry and parameter types', () => {
  for (const [type, definition] of Object.entries(SCENE_EXTRA_COMPONENTS)) {
    for (const preset of definition.variants) {
      const config = { ...createSceneExtraDefaults(type), ...(definition.variantKey ? { [definition.variantKey]: preset.value } : {}) };
      const input = documentFor(type, config);
      const output = normalizeSceneDocument(input, { normalizeConfig: normalizeSceneConfig });
      assert.deepEqual(output, input);
      assert.notEqual(output.items[0].appearance.config, input.items[0].appearance.config);
    }
  }
});

test('extra config validation owns invalid input classes, numeric coercion and color alpha rules', () => {
  for (const config of [null, [], 'value', Object.create({ style: 'none' })]) {
    assert.throws(() => normalizeSceneExtraConfig('background', config), { code: 'INVALID_SCENE_CONFIG' });
  }
  for (const value of [NaN, Infinity, -0.01, 1.01, '', {}, 0.001]) {
    assert.throws(() => normalizeSceneExtraConfig('background', { opacity: value }), { code: 'INVALID_SCENE_CONFIG' });
  }
  for (const value of [0, '0.42', 1]) {
    assert.equal(normalizeSceneExtraConfig('background', { opacity: value }).opacity, Number(value));
  }
  assert.equal(normalizeSceneExtraConfig('lyrics', { desktopLyricFontSize: 36 }).desktopLyricFontSize, '36');
  for (const value of ['yes', 1, null]) {
    assert.throws(() => normalizeSceneExtraConfig('games', { showTitle: value }), { code: 'INVALID_SCENE_CONFIG' });
  }
  for (const value of [true, false, 'true', 'false']) {
    assert.equal(normalizeSceneExtraConfig('games', { showTitle: value }).showTitle, value === true || value === 'true');
  }
  for (const value of ['red', '#fff', 'url(private)', 123]) {
    assert.throws(() => normalizeSceneExtraConfig('wheel', { textColor: value }), { code: 'INVALID_SCENE_CONFIG' });
  }
  for (const value of ['#123456', '#12345600', '#12345680']) {
    assert.equal(normalizeSceneExtraConfig('wheel', { textColor: value }).textColor, value);
  }
  assert.throws(() => normalizeSceneExtraConfig('background', { overlayColor: '#12345680' }), { code: 'INVALID_SCENE_CONFIG' });
  assert.equal(normalizeSceneExtraConfig('songlist', { songBoardSongColor: '' }).songBoardSongColor, '');
  assert.throws(() => normalizeSceneExtraConfig('background', { style: '__proto__' }), { code: 'INVALID_SCENE_CONFIG' });
  for (const value of [{}, 'title\u0000']) {
    assert.throws(() => normalizeSceneExtraConfig('songlist', { songBoardTitle: value }), { code: 'INVALID_SCENE_CONFIG' });
  }
});

test('extra component schemas reject field limits, private configuration and unowned shared modes', () => {
  for (const [type, definition] of Object.entries(SCENE_EXTRA_COMPONENTS)) {
    const defaults = createSceneExtraDefaults(type);
    assert.throws(() => normalizeSceneConfig(type, { ...defaults, token: 'private' }), { code: 'INVALID_SCENE_CONFIG' });
    for (const [key, field] of Object.entries(definition.fields)) {
      const value = field.type === 'number' ? field.max + 1
        : field.type === 'select' ? 'unknown'
          : ['text', 'textarea'].includes(field.type) ? 'x'.repeat(field.maxLength + 1) : undefined;
      if (value !== undefined) assert.throws(() => normalizeSceneConfig(type, { ...defaults, [key]: value }), `${type}.${key}`);
      if (field.type === 'number' && field.optional) assert.equal(normalizeSceneConfig(type, { ...defaults, [key]: '' })[key], '');
    }
    const doc = documentFor(type); doc.items[0].appearance = { mode: 'shared' };
    assert.throws(() => normalizeSceneDocument(doc, { normalizeConfig: normalizeSceneConfig }));
  }
  assert.throws(() => normalizeSceneConfig('gift-feed', { ...createSceneExtraDefaults('gift-feed'), threshold2: 100 }));
});

test('asynchronous output rejects account changes and source revocation before releasing any display data', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close()); migrateScenes(db); migrateComponentOutputSizes(db); migrateCanvasPresets(db); migrateSceneDeletion(db);
  const owner = { scope: 'synthetic-owner', epoch: 1 };
  let release;
  const service = createSceneService({ store: createSceneStore(db), getOwner: () => owner,
    normalizeConfig: normalizeSceneConfig, getDefaultConfig: createSceneExtraDefaults,
    getDisplayData: () => new Promise((resolve) => { release = resolve; }),
    secretCodec: { isAvailable: () => true, encrypt: (value) => Buffer.from(value).toString('base64'),
      decrypt: (value) => Buffer.from(value, 'base64').toString() } });
  const created = service.create({ title: '直播场景', canvas: { width: 1920, height: 1080 } });
  const doc = { ...documentFor('gift-wishes'), id: created.document.id };
  const saved = service.save({ id: doc.id, expectedRevision: created.revision, document: doc });
  service.publish({ id: doc.id, expectedRevision: saved.revision });
  const source = service.getSource(doc.id);
  const pendingOwner = service.getOutput({ ...source, version: 0 });
  owner.epoch++;
  release({ 'gift-wishes': { items: [{ label: 'private' }] } });
  await assert.rejects(pendingOwner, { code: 'SCENE_OWNER_CHANGED' });
  const pendingToken = service.getOutput({ ...source, version: 0 });
  service.rotate(doc.id);
  release({ 'gift-wishes': { items: [] } });
  await assert.rejects(pendingToken, { code: 'SCENE_ACCESS_DENIED' });
});

test('sprint canvas projects only the existing countdown and templates contain no business state', () => {
  const { exportSceneTemplate, importSceneTemplate } = require('../../public/js/admin/scene-template.js');
  const state = { giftSprint: { targetRmb: 1000, remainingCrystalBalls: 7, receivedRmb: 300, private: 'hidden' } };
  const display = createSceneExtraDisplay({ displayPorts: { system: { getState: () => state } } });
  assert.deepEqual(display('gift-sprint'), { targetRmb: 1000, remainingCrystalBalls: 7 });
  state.giftSprint = null;
  assert.equal(display('gift-sprint'), null);
  const document = documentFor('gift-sprint');
  const imported = importSceneTemplate(exportSceneTemplate(document));
  assert.deepEqual(imported.document.items[0].appearance, { mode: 'independent', config: {} });
  assert.deepEqual(imported.bindings.map(({ component, kind, source }) => ({ component, kind, source })),
    [{ component: 'gift-sprint', kind: 'source', source: 'gift-sprint' }]);
});

test('extra display projection excludes game secrets, keeps lyrics separate from settings and shares slow reads', async () => {
  const owner = { scope: 'a', epoch: 1 };
  let reads = 0;
  let revision = 'gift-a';
  const displayPorts = {
    system: { getState: () => ({ settings: { roomId: 'private' }, lyricState: { lineText: '真实歌词', playing: true, private: 'hidden' }, lyricTimeline: { lines: [] } }) },
    games: { getSession: () => ({ game: 'number-bomb', state: { min: 1, max: 100, secret: 32 }, token: 'hidden' }) },
    gifts: { getViewRevision: () => revision },
    settings: { get: () => ({ openingEnabled: 'true', openingStyle: 'pixel-cassette', openingTitle: '即将开播', secret: 'hidden' }) },
    giftWishes: { getSnapshot: async () => { reads++; return { items: [], guards: [{ name: 'private' }], sourceId: 1 }; } },
  };
  const display = createSceneExtraDisplay({ displayPorts, getOwner: () => owner });
  assert.equal(display('opening').style, 'pixel-cassette');
  assert.equal(display('opening').enabled, true);
  assert.equal(display('opening').secret, undefined);
  assert.deepEqual(display('games'), { session: { game: 'number-bomb', state: { min: 1, max: 100 } } });
  assert.deepEqual(display('lyrics'), { lyricState: { lineText: '真实歌词', playing: true }, lyricTimeline: { lines: [] } });
  const [first, second] = await Promise.all([display('gift-wishes'), display('gift-wishes')]);
  assert.deepEqual(first, { items: [] }); assert.deepEqual(second, first); assert.equal(reads, 1);
  await display('gift-wishes'); assert.equal(reads, 1);
  revision = 'gift-b'; await display('gift-wishes'); assert.equal(reads, 2);
  owner.epoch++; await display('gift-wishes'); assert.equal(reads, 3);
});

test('targeted display invalidation refreshes configuration immediately and an older pending read cannot replace the new cache', async () => {
  let label = '原许愿';
  let reads = 0;
  let release;
  const displayPorts = {
    gifts: { getViewRevision: () => 'unchanged-gift-revision' },
    giftWishes: { getSnapshot() {
      reads++;
      if (reads === 1) return new Promise(resolve => { release = resolve; });
      return { items: [{ label }] };
    } },
  };
  const display = createSceneExtraDisplay({ displayPorts, getOwner: () => ({ scope: 'owner', epoch: 1 }) });
  const pending = display('gift-wishes');
  await Promise.resolve();
  label = '更新后许愿';
  display.invalidate(['gift-wishes']);
  assert.deepEqual(await display('gift-wishes'), { items: [{ label }] });
  release({ items: [{ label: '原许愿' }] });
  await pending;
  assert.deepEqual(await display('gift-wishes'), { items: [{ label }] });
  assert.equal(reads, 2);
  display.invalidate(['gift-feed']);
  await display('gift-wishes');
  assert.equal(reads, 2, 'Unrelated invalidation must retain the wish cache.');
});
