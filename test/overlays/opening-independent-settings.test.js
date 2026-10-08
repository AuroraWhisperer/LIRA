'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Readable } = require('node:stream');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
const { getOpeningConfig } = require('../../src/server/opening-service');
const { routes } = require('../../src/server/routes/opening-routes');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { projectOverlayResponse } = require('../../src/server/overlay-projection');
const { serveOpeningMedia } = require('../../src/server/opening-media-http');
const { resolveOpeningAppearance, MOONLIT_OPENING_DEFAULTS } = require('../../public/js/shared/opening-appearance.js');

test('built-in opening profiles and fixed canvas styles keep their own settings', () => {
  const settings = { ...DEFAULT_SETTINGS, openingStyle: 'pixel-cassette', openingQuality: 'high',
    openingShowNotes: 'false', openingAudioVolume: '0.9', openingPixelQuality: 'low', openingPixelAudioVolume: '0.2' };
  const data = getOpeningConfig({ settings: { get: () => settings } });
  assert.equal(data.quality, 'low');
  assert.equal(data.volume, 0.2);
  const projected = projectOverlayResponse('opening', '/api/opening/config', data);
  assert.equal(Object.hasOwn(projected.styles.classic, 'audioName'), false);
  assert.equal(resolveOpeningAppearance(projected, { style: 'classic' }).quality, 'high');
  assert.equal(resolveOpeningAppearance(projected, { style: 'classic' }).showNotes, false);
  assert.equal(resolveOpeningAppearance(projected, { style: 'pixel-cassette' }).showNotes, true);
  assert.equal(resolveOpeningAppearance({ ...projected, enabled: false }, { style: 'classic' }).enabled, false);
  for (const patch of [{ openingPixelQuality: 'bad' }, { openingPixelAudioVolume: 2 }, { openingPixelShowEq: {} }]) {
    assert.ok(normalizeSettingsPatch(patch, DEFAULT_SETTINGS).error);
  }
  assert.deepEqual(normalizeSettingsPatch({ openingPixelQuality: 'low', openingPixelAudioVolume: '0.2' }, DEFAULT_SETTINGS).values,
    { openingPixelQuality: 'low', openingPixelAudioVolume: '0.2' });
});

test('opening media serves only the two selected style files and revokes a cleared selection', async t => {
  const dataDir = createScratchDirectory('opening-selected-media-');
  fs.mkdirSync(path.join(dataDir, 'opening-music'));
  for (const file of ['classic.mp3', 'pixel.mp3', 'unused.mp3']) fs.writeFileSync(path.join(dataDir, 'opening-music', file), file);
  let selected = ['classic.mp3', 'pixel.mp3'];
  const server = http.createServer((req, res) => serveOpeningMedia(dataDir, req, res, new URL(req.url, 'http://127.0.0.1'), () => selected));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const file of selected) {
    const response = await fetch(`${origin}/opening-media/${file}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), file);
  }
  assert.equal((await fetch(`${origin}/opening-media/unused.mp3`)).status, 404);
  selected = ['classic.mp3', ''];
  assert.equal((await fetch(`${origin}/opening-media/pixel.mp3`)).status, 404);
  assert.equal((await fetch(`${origin}/opening-media/classic.mp3`)).status, 200);
});

test('package appearance overrides global copy and preserves old sparse scene configs', () => {
  assert.deepEqual(normalizeSceneConfig('opening', { style: 'classic' }), { style: 'classic' });
  const config = normalizeSceneConfig('opening', { style: 'moonlit-fan', ...MOONLIT_OPENING_DEFAULTS, title: '包内标题', showNotes: false });
  const rendered = resolveOpeningAppearance({ enabled: true, style: 'classic', title: '经典标题', audioUrl: '/opening-media/classic.mp3' },
    { ...config, resourceStyle: { preset: 'moonlit-opening' } });
  assert.equal(rendered.title, '包内标题');
  assert.equal(rendered.footer, '风起花汀，静候君来');
  assert.equal(rendered.audioUrl, '');
  assert.equal(rendered.showNotes, false);
  assert.equal(resolveOpeningAppearance({ title: '经典标题' }, { style: 'moonlit-fan', resourceStyle: { preset: 'moonlit-opening' } }).title, '月渡花汀');
  assert.throws(() => normalizeSceneConfig('opening', { title: 'x'.repeat(21) }));
  assert.throws(() => normalizeSceneConfig('opening', { showNotes: 'maybe' }));
});

test('pixel music upload and removal never replace the classic music slot', async t => {
  const dataDir = createScratchDirectory('opening-independent-');
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dataDir, 'opening-music'));
  fs.writeFileSync(path.join(dataDir, 'opening-music/classic.mp3'), 'classic');
  const values = { ...DEFAULT_SETTINGS, openingAudioFile: 'classic.mp3', openingAudioName: '经典音乐' };
  const context = { system: { dataDir }, settings: { get: () => values, set: (key, value) => { values[key] = value; } }, broadcastSnapshot() {} };
  const req = Readable.from([Buffer.from('--test\r\nContent-Disposition: form-data; name="file"; filename="pixel.mp3"\r\nContent-Type: audio/mpeg\r\n\r\npixel\r\n--test--\r\n')]);
  req.headers = { 'content-type': 'multipart/form-data; boundary=test' };
  let payload;
  const res = { writeHead(status) { this.status = status; }, end(body) { payload = JSON.parse(body); } };
  const query = new URLSearchParams('style=pixel-cassette');
  await routes['POST /api/opening/music'](context, { req, query }, res);
  assert.equal(res.status, 200);
  assert.equal(values.openingAudioFile, 'classic.mp3');
  assert.equal(payload.data.styles['pixel-cassette'].audioName, 'pixel.mp3');
  assert.equal(payload.data.styles.classic.audioName, '经典音乐');
  await routes['DELETE /api/opening/music'](context, { query }, res);
  assert.equal(values.openingPixelAudioFile, '');
  assert.equal(values.openingAudioFile, 'classic.mp3');
});
