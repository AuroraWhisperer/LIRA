'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { DESKTOP_LYRIC_DEFAULTS } = require('../../public/js/lyrics/desktop-lyric-defaults.js');
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

function context(t) {
  const values = { ...DEFAULT_SETTINGS, songBoardSyncTheme: 'false', songBoardTitle: '客户端标题' };
  return { values, system: { dataDir: createScratchDirectory('shared-appearance-', t) },
    settings: { defaults: DEFAULT_SETTINGS, get: () => values, setMany: patch => Object.assign(values, patch) } };
}

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
  const lyrics = createSceneSharedAppearance(ctx).read('lyrics', createSceneExtraDefaults('lyrics'));
  for (const key of Object.keys(DESKTOP_LYRIC_DEFAULTS).filter(key => key !== 'desktopLyricKaraokeEnabled')) {
    assert.ok(Object.hasOwn(lyrics, key), `Canvas is missing ${key}`);
  }
  createSceneSharedAppearance(ctx).patch('lyrics', createSceneExtraDefaults('lyrics'), { desktopLyricKaraokeMode: 'off' });
  assert.equal(ctx.values.desktopLyricKaraokeEnabled, 'false');
});

test('heart box display parameters share desktop values and canvas edits without changing layout', t => {
  const ctx = context(t);
  const config = createSceneExtraDefaults('blindbox');
  const owner = createSceneSharedAppearance(ctx);
  owner.patch('blindbox', config, { heartBoxOnly: true, blindboxCastleMultiplier: '2.5',
    blindboxShowCastlesRemaining: true, blindboxCastlesRemaining: '0', blindboxShowOpenedSinceCastle: true,
    compact: true, noScroll: false, winnersOnly: false, themeFontScale: '1.5', overlayFontWeight: '600',
    overlayFontFamily: 'Arial', themeBackground: '#112233', themeOpacity: '0.8', themeText: '#ffffff',
    themePrimary: '#aabbcc', themeAccent: '#ddeeff' });
  const shared = createSceneSharedAppearance(ctx).read('blindbox', config);
  assert.equal(shared.heartBoxOnly, true);
  assert.equal(shared.blindboxCastleMultiplier, '2.5');
  assert.equal(shared.blindboxCastlesRemaining, '0');
  assert.equal(ctx.values.blindboxShowOpenedSinceCastle, 'true');
  assert.equal(ctx.values.blindboxCompact, 'true');
  assert.equal(ctx.values.blindboxAutoPages, 'false');
  assert.equal(shared.compact, true);
  assert.equal(shared.noScroll, false);
  assert.equal(shared.hideLoss, false, 'legacy loss filter follows the single shared profitability switch');
  for (const key of ['overlayFontFamily', 'overlayFontWeight', 'themeFontScale', 'themeBackground', 'themeOpacity',
    'themeText', 'themePrimary', 'themeAccent']) assert.equal(shared[key], ctx.values[key]);
  owner.patch('blindbox', config, { blindboxCastleMultiplier: '' });
  assert.equal(ctx.values.blindboxCastleMultiplier, '');
  assert.throws(() => owner.patch('blindbox', config, { blindboxCastleMultiplier: '-1' }));
  assert.equal(config.heartBoxOnly, false);
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
  assert.equal(createSceneSharedAppearance(ctx).read('songlist', board).songBoardThemeOpacity, '0.48');
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
  const next = createSceneSharedAppearance(ctx).read('gift-wishes', config);
  assert.equal(next.limit, 4); assert.equal(next.gap, 24);
  assert.deepEqual(next.resourceStyle, config.resourceStyle);
  assert.equal(config.limit, 1);
  assert.throws(() => createSceneSharedAppearance(ctx).patch('gift-wishes', config, { resourceStyle: {} }), /公共显示参数/);
  store.remove(resourceStyle.id);
  assert.equal(createSceneSharedAppearance(ctx).read('gift-wishes', config).limit, 4);
  assert.throws(() => createSceneSharedAppearance(ctx).patch('gift-wishes', config, { limit: 5 }), /样式已移除/);
  assert.equal(store.read().packages[0].styles[0].config.limit, 4);
});

test('gift display validation and field allowlists reject the complete patch before writing', t => {
  const ctx = context(t);
  const config = createSceneExtraDefaults('gift-feed');
  const owner = createSceneSharedAppearance(ctx);
  owner.patch('gift-feed', config, { visibleRows: 5 });
  assert.equal(JSON.parse(ctx.values.giftDisplayConfig).visibleRows, 5);
  const before = JSON.stringify(ctx.values);
  for (const [type, appearance, patch] of [
    ['gift-feed', config, { threshold1: 200000, visibleRows: 3 }],
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
  assert.equal(result.data[sceneAppearanceKey('lyrics', config)].desktopLyricFontSize, '56');
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
