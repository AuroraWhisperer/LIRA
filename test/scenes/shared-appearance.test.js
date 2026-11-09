'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { sceneAppearanceKey } = require('../../public/js/shared/scene-shared-appearance.js');
const { getClockConfig } = require('../../src/server/clock-contract');
const { createSceneSharedAppearance, readSceneSharedAppearances } = require('../../src/server/scene-shared-appearance');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { COMPONENT_RESOURCE_PRESETS } = require('../../public/js/shared/component-resource-style.js');
const { createComponentPreviewSessions } = require('../../src/server/component-preview-sessions');
const { handleCanvasAppearance } = require('../../src/server/routes/scene-appearance-routes');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { readNowPlayingConfig, saveNowPlayingConfig } = require('../../src/server/now-playing-settings');
const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
const { buildGiftMotionEvents } = require('../../src/bilibili/gift/motion-config');

function context(t) {
  const values = { ...DEFAULT_SETTINGS, songBoardSyncTheme: 'false', songBoardTitle: '客户端标题' };
  return { values, system: { dataDir: createScratchDirectory('shared-appearance-', t) },
    settings: { defaults: DEFAULT_SETTINGS, get: () => values, setMany: patch => Object.assign(values, patch) } };
}

test('lyric layers share visual settings while retaining their own output filter', t => {
  const ctx = context(t);
  const basic = normalizeSceneConfig('lyrics', { lyricLayer: 'basic' });
  const advanced = normalizeSceneConfig('lyrics', { lyricLayer: 'advanced' });
  const owner = createSceneSharedAppearance(ctx);
  owner.patch('lyrics', advanced, { advancedLyricEnabled: 'true', advancedLyricLayout: 'corners',
    advancedLyricMaterial: 'metallic', advancedLyricLayoutSequence: 'corners,arc', advancedLyricStrokeLayers: '3', advancedLyricHideUnsung: 'false',
    advancedLyricSavedPresets: JSON.stringify([{ id: 'canvas-look', name: '画布搭配', settings: { advancedLyricMaterial: 'metallic' } }]) });
  const next = createSceneSharedAppearance(ctx);
  for (const config of [basic, advanced]) {
    const appearance = next.read('lyrics', config);
    assert.equal(appearance.advancedLyricEnabled, 'true');
    assert.equal(appearance.advancedLyricMaterial, 'metallic');
    assert.equal(appearance.advancedLyricHideUnsung, 'false');
    assert.equal(JSON.parse(appearance.advancedLyricSavedPresets)[0].name, '画布搭配');
    assert.equal(Object.hasOwn(appearance, 'lyricLayer'), false);
  }
  assert.equal(basic.lyricLayer, 'basic');
  assert.equal(advanced.lyricLayer, 'advanced');
  const item = { id: 'lyrics', type: 'lyrics', appearance: { config: advanced } };
  assert.equal(Object.hasOwn(readSceneSharedAppearances(ctx, [item]).lyrics, 'advancedLyricSavedPresets'), false,
    'the editor library must not be copied into the broadcast appearance');
  assert.throws(() => owner.patch('lyrics', advanced, { lyricLayer: 'basic' }));
  assert.throws(() => normalizeSceneConfig('lyrics', { advancedLyricLayoutSequence: 'corners,missing' }));
  assert.throws(() => normalizeSceneConfig('lyrics', { advancedLyricStrokeLayers: '8' }));
});

test('canvas motion edits use each effect owner and reach settlement without copying settings into the layer', t => {
  const ctx = context(t);
  const drop = normalizeSceneConfig('gift-frame', { style: 'gift-drop' });
  const swing = normalizeSceneConfig('gift-frame', { style: 'gift-swing' });
  const owner = createSceneSharedAppearance(ctx);
  owner.patch('gift-frame', drop, { giftDropEnabled: 'true', giftDropThresholdRmb: '1.25', giftDropSize: '128',
    giftDropDurationSeconds: '12', giftDropQuantityMultiplier: '3', giftDropSpeed: '75', giftDropBounce: '40' });
  owner.patch('gift-frame', swing, { giftSwingEnabled: 'true', giftSwingTextMode: 'name-quantity', giftSwingAngle: '24' });
  const current = createSceneSharedAppearance(ctx);
  assert.equal(current.read('gift-frame', drop).giftDropSize, '128');
  assert.equal(Object.hasOwn(current.read('gift-frame', drop), 'giftSwingAngle'), false);
  const [dropEvent, swingEvent] = buildGiftMotionEvents({ id: 19, detection_status: 'final', total_price: 2, num: 4 }, ctx.values);
  assert.equal(dropEvent.motion.size, 128);
  assert.equal(dropEvent.motion.quantityMultiplier, 3);
  assert.equal(dropEvent.motion.durationSeconds, 12);
  assert.equal(swingEvent.motion.textMode, 'name-quantity');
  ctx.values.giftDropSize = '160';
  assert.equal(createSceneSharedAppearance(ctx).read('gift-frame', drop).giftDropSize, '160');
  assert.equal(Object.hasOwn(drop, 'giftDropSize'), false);
  assert.throws(() => current.patch('gift-frame', drop, { giftSwingAngle: '30' }));
  assert.throws(() => current.patch('gift-frame', drop, { giftDropSize: '180', giftDropQuantityMultiplier: '9' }));
  assert.equal(ctx.values.giftDropSize, '160', 'an invalid multi-field edit must not partially save');
});

test('heart box reward visibility follows the shared setting through both entry points', t => {
  const ctx = context(t);
  const config = normalizeSceneConfig('heart-box-collection', { displayStyle: 'compact', showRewards: true });
  createSceneSharedAppearance(ctx).patch('heart-box-collection', config, { showRewards: false });
  assert.equal(ctx.values.heartBoxCollectionShowRewards, 'false');
  assert.equal(createSceneSharedAppearance(ctx).read('heart-box-collection', config).showRewards, false);
  ctx.values.heartBoxCollectionShowRewards = 'true';
  assert.equal(createSceneSharedAppearance(ctx).read('heart-box-collection', config).showRewards, true);
  assert.equal(config.displayStyle, 'compact');
  assert.throws(() => createSceneSharedAppearance(ctx).patch('heart-box-collection', config, { displayStyle: 'task' }));
});

test('rankings share viewing mode while retaining each layer board selection and appearance', t => {
  const ctx = context(t);
  const config = normalizeSceneConfig('live-rankings', { showHot: false, showNew: true, showPopular: false, showArea: false, fontSize: 24 });
  createSceneSharedAppearance(ctx).patch('live-rankings', config, { range: 'all' });
  assert.equal(ctx.values.liveRankingsRange, 'all');
  ctx.values.liveRankingsRange = 'nearby';
  assert.equal(createSceneSharedAppearance(ctx).read('live-rankings', config).range, 'nearby');
  assert.equal(config.showNew, true);
  assert.equal(config.fontSize, 24);
  assert.throws(() => createSceneSharedAppearance(ctx).patch('live-rankings', config, { range: 'invalid' }));
  assert.equal(ctx.values.liveRankingsRange, 'nearby');
  assert.throws(() => createSceneSharedAppearance(ctx).patch('live-rankings', config, { showHot: true }));
});

test('resource lyric appearances preserve each scene layer through reads and saved appearance responses', t => {
  const ctx = context(t);
  const store = createComponentStyleStore(ctx.system.dataDir);
  const pack = randomUUID();
  const preset = COMPONENT_RESOURCE_PRESETS['moonlit-lyrics'];
  const source = `/component-media/${pack}/${'b'.repeat(64)}`;
  const resourceStyle = { id: randomUUID(), preset: 'moonlit-lyrics', preview: `${source}.webp`, width: 960, height: 480,
    resources: Object.fromEntries(preset.resources.map(key => [key, `${source}${key.slice(key.lastIndexOf('.'))}`])) };
  const config = normalizeSceneConfig('lyrics', { ...preset.config, resourceStyle });
  store.stage({ id: pack, styles: [{ id: resourceStyle.id, type: 'lyrics', name: '共享歌词', config }] });
  store.install(pack);
  const items = ['basic', 'advanced'].map(layer => ({ id: layer, type: 'lyrics',
    appearance: { mode: 'independent', config: { ...config, lyricLayer: layer } } }));
  const owner = createSceneSharedAppearance(ctx);
  const saved = owner.patch('lyrics', items[0].appearance.config, { advancedLyricEnabled: 'true', advancedLyricLayout: 'corners' });
  assert.equal(Object.hasOwn(saved, 'lyricLayer'), false, 'saving shared appearance must not replace the instance filter');
  const projected = readSceneSharedAppearances(ctx, items);
  for (const item of items) {
    const effective = { ...item.appearance.config, ...projected[item.id] };
    assert.equal(effective.lyricLayer, item.id);
    assert.equal(effective.advancedLyricLayout, 'corners');
  }
  assert.throws(() => owner.patch('lyrics', config, { lyricLayer: 'advanced' }));
});

test('shared projections prefer desktop settings without rewriting snapshots and both entry points use the same values', t => {
  const ctx = context(t);
  const config = { ...createSceneExtraDefaults('songlist'), songBoardTitle: '旧场景标题', category: '动画' };
  const item = id => ({ id, type: 'songlist', appearance: { mode: 'independent', config } });
  const projected = readSceneSharedAppearances(ctx, [item('first'), item('second')]);
  assert.equal(projected.first.songBoardTitle, '客户端标题');
  assert.deepEqual(projected.first, projected.second);
  assert.equal(Object.hasOwn(projected.first, 'category'), false);
  createSceneSharedAppearance(ctx).patch('songlist', config, { songBoardTitle: '画布修改', songBoardFontSize: '40' });
  assert.equal(ctx.values.songBoardTitle, '画布修改');
  assert.equal(config.songBoardTitle, '旧场景标题');
  ctx.values.songBoardTitle = '客户端再次修改';
  assert.equal(readSceneSharedAppearances(ctx, [item('first')]).first.songBoardTitle, '客户端再次修改');
  createSceneSharedAppearance(ctx).patch('lyrics', createSceneExtraDefaults('lyrics'), { desktopLyricKaraokeMode: 'off' });
  assert.equal(ctx.values.desktopLyricKaraokeEnabled, 'false');
});

test('heart box display parameters share desktop values and canvas edits without changing layout', t => {
  const ctx = context(t);
  const config = createSceneExtraDefaults('blindbox');
  const owner = createSceneSharedAppearance(ctx);
  owner.patch('blindbox', config, { heartBoxOnly: true, blindboxCastleMultiplier: '2.5',
    blindboxShowCastlesRemaining: true, blindboxCastlesRemaining: '0', compact: true, noScroll: false, winnersOnly: false });
  const shared = createSceneSharedAppearance(ctx).read('blindbox', config);
  assert.equal(shared.heartBoxOnly, true);
  assert.equal(shared.blindboxCastleMultiplier, '2.5');
  assert.equal(shared.blindboxCastlesRemaining, '0');
  assert.equal(ctx.values.blindboxCompact, 'true');
  assert.equal(ctx.values.blindboxAutoPages, 'false');
  assert.equal(shared.hideLoss, false, 'legacy loss filter follows the single shared profitability switch');
  owner.patch('blindbox', config, { blindboxCastleMultiplier: '' });
  assert.equal(ctx.values.blindboxCastleMultiplier, '');
  assert.throws(() => owner.patch('blindbox', config, { blindboxCastleMultiplier: '-1' }));
  assert.equal(config.heartBoxOnly, false);
});

test('now-playing settings are shared by desktop and canvas while each scene retains its record style', t => {
  const ctx = context(t);
  const snapshots = [];
  ctx.broadcastSnapshot = reason => snapshots.push(reason);
  const config = { ...createSceneExtraDefaults('now-playing'), style: 'turntable', nowPlayingPart: 'record' };
  saveNowPlayingConfig(ctx, { ...createSceneExtraDefaults('now-playing'), style: 'cover',
    nowPlayingShowArtist: false, nowPlayingRotationSeconds: 28 });
  assert.equal(readNowPlayingConfig(ctx.values).style, 'cover');
  const shared = createSceneSharedAppearance(ctx).read('now-playing', config);
  assert.equal(shared.nowPlayingShowArtist, false);
  assert.equal(shared.nowPlayingRotationSeconds, 28);
  assert.equal(Object.hasOwn(shared, 'style'), false);
  assert.equal(Object.hasOwn(shared, 'nowPlayingPart'), false);
  const text = { ...config, nowPlayingPart: 'text' };
  assert.notEqual(sceneAppearanceKey('now-playing', config), sceneAppearanceKey('now-playing', text));
  assert.equal({ ...config, ...shared }.nowPlayingPart, 'record');
  assert.equal({ ...text, ...shared }.nowPlayingPart, 'text');
  assert.throws(() => createSceneSharedAppearance(ctx).patch('now-playing', config, { nowPlayingPart: 'text' }));
  createSceneSharedAppearance(ctx).patch('now-playing', config, { nowPlayingShowArtist: true, nowPlayingLayout: 'vertical' });
  const reread = readNowPlayingConfig(ctx.values);
  assert.equal(reread.nowPlayingShowArtist, true);
  assert.equal(reread.nowPlayingLayout, 'vertical');
  assert.equal(reread.style, 'cover');
  assert.equal(config.style, 'turntable');
  assert.deepEqual(snapshots, ['settings']);
});

test('invalid now-playing appearance cannot replace saved configuration through either settings writer', t => {
  const ctx = context(t);
  ctx.broadcastSnapshot = () => {};
  saveNowPlayingConfig(ctx, { ...createSceneExtraDefaults('now-playing'), nowPlayingShowRecord: false });
  const before = ctx.values.nowPlayingAppearance;
  assert.throws(() => saveNowPlayingConfig(ctx, { nowPlayingRotationSeconds: -1 }));
  assert.throws(() => createSceneSharedAppearance(ctx).patch('now-playing', createSceneExtraDefaults('now-playing'), { style: 'cover' }));
  const invalid = normalizeSettingsPatch({ nowPlayingAppearance: JSON.stringify({ arbitraryFile: 'private' }) }, DEFAULT_SETTINGS);
  assert.ok(invalid.error);
  assert.equal(ctx.values.nowPlayingAppearance, before);
});

test('style owners keep clock profiles, guard languages and imported resource parameters separate', t => {
  const ctx = context(t);
  const clock = getClockConfig(ctx.values);
  clock.styleOptions.peach.label = '桃色时钟';
  ctx.values.clockStyleOptions = JSON.stringify(clock.styleOptions);
  const owner = createSceneSharedAppearance(ctx);
  assert.equal(owner.read('clock', { ...clock, style: 'peach' }).label, '桃色时钟');
  assert.notEqual(owner.read('clock', { ...clock, style: 'soda' }).label, '桃色时钟');
  owner.patch('guard-thanks', { ...createSceneExtraDefaults('guard-thanks'), style: 'aurora' }, { textMode: 'zh' });
  const next = createSceneSharedAppearance(ctx);
  assert.equal(next.read('guard-thanks', { style: 'aurora' }).textMode, 'zh');
  assert.equal(next.read('guard-thanks', { style: 'classic' }).textMode, 'bilingual');
});

test('desktop precision and select values remain editable through shared canvas settings', t => {
  const ctx = context(t);
  Object.assign(ctx.values, { songBoardSyncTheme: 'true', songBoardFontWeight: '900', desktopLyricFontWeight: '900',
    desktopLyricTextAlign: 'justify', desktopLyricTimeOffsetMs: '150' });
  const board = createSceneExtraDefaults('songlist');
  createSceneSharedAppearance(ctx).patch('songlist', board, { songBoardSyncTheme: 'false' });
  createSceneSharedAppearance(ctx).patch('songlist', board, { songBoardThemeOpacity: '0.48', songBoardTitleFontSize: '80' });
  assert.equal(ctx.values.songBoardThemeOpacity, '0.48');
  assert.equal(ctx.values.songBoardTitleFontSize, '80');
  const lyrics = createSceneExtraDefaults('lyrics');
  createSceneSharedAppearance(ctx).patch('lyrics', lyrics, { desktopLyricBaseOpacity: '0.38' });
  createSceneSharedAppearance(ctx).patch('lyrics', lyrics, { desktopLyricTimeOffsetMs: '250', desktopLyricTextAlign: 'justify' });
  assert.equal(ctx.values.desktopLyricTimeOffsetMs, '250');
  assert.equal(ctx.values.desktopLyricTextAlign, 'justify');
});

test('installed style parameters follow the library, survive removal and never replace resource identities', t => {
  const ctx = context(t);
  const store = createComponentStyleStore(ctx.system.dataDir);
  const pack = randomUUID();
  const preset = COMPONENT_RESOURCE_PRESETS['moonlit-wishes'];
  const source = `/component-media/${pack}/${'a'.repeat(64)}`;
  const resourceStyle = { id: randomUUID(), preset: 'moonlit-wishes', preview: `${source}.webp`, width: 640, height: 143,
    resources: Object.fromEntries(preset.resources.map(key => [key, `${source}${key.slice(key.lastIndexOf('.'))}`])) };
  const config = normalizeSceneConfig('gift-wishes', { ...preset.config, resourceStyle });
  store.stage({ id: pack, styles: [{ id: resourceStyle.id, type: 'gift-wishes', name: '共享样式', config }] });
  store.install(pack);
  createSceneSharedAppearance(ctx).patch('gift-wishes', config, { limit: 4, gap: 24 });
  const clones = t.mock.method(global, 'structuredClone');
  const next = createSceneSharedAppearance(ctx).read('gift-wishes', config);
  assert.equal(clones.mock.calls.filter(call => Array.isArray(call.arguments[0]?.packages)).length, 0,
    'Reading one shared style must not copy the complete library.');
  clones.mock.restore();
  assert.equal(next.limit, 4); assert.equal(next.gap, 24);
  assert.deepEqual(next.resourceStyle, config.resourceStyle);
  assert.equal(config.limit, 1);
  assert.throws(() => createSceneSharedAppearance(ctx).patch('gift-wishes', config, { resourceStyle: {} }));
  store.remove(resourceStyle.id);
  assert.equal(createSceneSharedAppearance(ctx).read('gift-wishes', config).limit, 4);
  assert.throws(() => createSceneSharedAppearance(ctx).patch('gift-wishes', config, { limit: 5 }));
  assert.equal(store.read().packages[0].styles[0].config.limit, 4);
});

test('gift display validation and field allowlists reject the complete patch before writing', t => {
  const ctx = context(t);
  const config = createSceneExtraDefaults('gift-feed');
  const owner = createSceneSharedAppearance(ctx);
  owner.patch('gift-feed', config, { visibleRows: 5, tailStyle: 'swallowtail', textureStyle: 'polka' });
  assert.equal(JSON.parse(ctx.values.giftDisplayConfig).visibleRows, 5);
  const appearance = createSceneSharedAppearance(ctx).read('gift-feed', config);
  assert.equal(appearance.tailStyle, 'swallowtail');
  assert.equal(appearance.textureStyle, 'polka');
  const before = JSON.stringify(ctx.values);
  for (const [type, appearance, patch] of [
    ['gift-feed', config, { threshold1: 200000, visibleRows: 3 }],
    ['gift-feed', config, { textureStyle: 'unknown', visibleRows: 3 }],
    ['lyrics', createSceneExtraDefaults('lyrics'), { desktopLyricScale: 3 }],
    ['songlist', createSceneExtraDefaults('songlist'), { songBoardTitle: '禁止的复合写入', paused: true }],
    ['clock', getClockConfig(ctx.values), { label: '不能绕过客户端控制器' }],
  ]) assert.throws(() => owner.patch(type, appearance, patch));
  assert.equal(JSON.stringify(ctx.values), before);
});

test('canvas appearance access is bounded to a current canvas attachment and rechecked after body read', async t => {
  const ctx = context(t);
  const server = await startComponentPreviewServer({ dataDir: ctx.system.dataDir, settings: ctx.settings,
    getState: () => ({ settings: ctx.values }) });
  t.after(server.close);
  const state = { draft: { document: {} }, saved: { document: {} }, loaded: true, generation: 0 };
  const { data: session } = await server.post({ action: 'open', component: 'canvas', state });
  const attachmentId = randomUUID();
  await server.post({ action: 'attach', id: session.id, attachmentId, previousAttachmentId: null }, session.token);
  const query = new URLSearchParams({ id: session.id, attachmentId });
  const config = createSceneExtraDefaults('lyrics');
  const call = async (body, headers = {}) => {
    const response = await fetch(`${server.origin}/api/component-preview/appearance?${query}`, { method: 'POST', headers: {
      Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const result = await call({ action: 'read', items: [{ type: 'lyrics', config }] });
  assert.equal(result.status, 200, result.error);
  assert.equal(result.data[sceneAppearanceKey('lyrics', config)].desktopLyricFontSize, ctx.values.desktopLyricFontSize);
  assert.equal((await call({ action: 'patch', type: 'lyrics', config, patch: { desktopLyricFontSize: '42' } })).status, 200);
  assert.equal(ctx.values.desktopLyricFontSize, '42');
  assert.equal((await call({ action: 'read', items: [] }, { Origin: 'null' })).status, 403);
  assert.equal((await call({ action: 'read', items: [] }, { Authorization: `Bearer ${server.token}` })).status, 403);
  await server.post({ action: 'revoke', id: session.id });
  assert.equal((await call({ action: 'read', items: [] })).status, 410);

  const sessions = createComponentPreviewSessions();
  const opened = sessions.open({ component: 'canvas', state });
  sessions.browser({ action: 'attach', id: opened.id, attachmentId, previousAttachmentId: null }, opened.token);
  const req = new PassThrough(); req.method = 'POST'; req.headers = { authorization: `Bearer ${opened.token}`, 'content-type': 'application/json' };
  const res = { setHeader() {}, writeHead(status) { this.status = status; }, end() {} };
  const pending = handleCanvasAppearance({ ...ctx, componentPreviews: sessions }, req, res,
    new URL(`http://localhost/api/component-preview/appearance?id=${opened.id}&attachmentId=${attachmentId}`));
  req.write('{"action":"patch",'); sessions.revoke(opened.id);
  req.end(JSON.stringify({ type: 'lyrics', config, patch: { desktopLyricFontSize: '50' } }).slice(1));
  await pending;
  assert.equal(res.status, 410);
  assert.equal(ctx.values.desktopLyricFontSize, '42');
});

test('published output receives current shared appearance without publishing an unsaved layout', async t => {
  const f = await startCanvasOutputFixture(); t.after(f.close);
  const created = f.service.create({ title: '公共参数', canvas: { width: 1280, height: 720 } });
  const id = randomUUID();
  const item = { id, type: 'clock', name: '时钟', x: 20, y: 30, width: 320, height: 180, visible: true, locked: false,
    appearance: { mode: 'independent', config: f.configs.clock } };
  const saved = f.service.save({ id: created.document.id, expectedRevision: 1, document: { ...created.document, items: [item] } });
  f.service.publish({ id: created.document.id, expectedRevision: saved.revision });
  const source = f.service.getSource(created.document.id);
  f.service.save({ id: created.document.id, expectedRevision: saved.revision, document: { ...saved.document, items: [{ ...item, x: 900 }] } });
  const config = getClockConfig(f.runtime.settings);
  config.styleOptions.peach.label = '保存后的共享文案';
  f.runtime.settings.clockStyleOptions = JSON.stringify(config.styleOptions);
  const response = await f.service.getOutput({ ...source, version: 1 });
  assert.equal(response.version, 1); assert.equal(response.document, null);
  assert.equal(response.appearances[id].label, '保存后的共享文案');
  assert.equal((await f.service.getOutput({ ...source, version: 0 })).document.items[0].x, 20);
});
