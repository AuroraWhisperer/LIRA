'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { createComponentPreviewSessions } = require('../../src/server/component-preview-sessions');

const state = { draft: { document: {} }, saved: { document: {} }, generation: 0, loaded: true };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

async function fixture(t) {
  const dataDir = createScratchDirectory('opening-canvas-', t);
  const values = { ...DEFAULT_SETTINGS, openingTitle: '经典文案', openingQuality: 'high' };
  const server = await startComponentPreviewServer({ dataDir, getState: () => ({ settings: values }), settings: {
    defaults: DEFAULT_SETTINGS, get: () => values,
    set: (key, value) => { values[key] = value; }, setMany: patch => Object.assign(values, patch),
  } });
  t.after(server.close);
  const { data: session } = await server.post({ action: 'open', component: 'canvas', state });
  const attachmentId = randomUUID();
  await server.post({ action: 'attach', id: session.id, attachmentId, previousAttachmentId: null }, session.token);
  const query = new URLSearchParams({ id: session.id, attachmentId });
  async function request(kind, { patch, style = 'pixel-cassette', file, method = patch || file ? 'POST' : 'GET', token = session.token, origin } = {}) {
    let body;
    const headers = { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) };
    if (file) { body = new FormData(); body.append('file', new Blob([file.bytes]), file.name); }
    else if (patch) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(patch); }
    const response = await fetch(`${server.origin}/api/component-preview/opening/${kind}?${query}&style=${style}`, { method, headers, body });
    return { status: response.status, ...await response.json() };
  }
  return { ...server, dataDir, values, session, query, request };
}

test('canvas edits only the chosen opening profile and shares uploaded media with the desktop', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('config')).status, 200);
  const saved = await f.request('config', { patch: { quality: 'low', showNotes: false, volume: 0.21 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.styles['pixel-cassette'].quality, 'low');
  assert.equal(saved.data.styles['pixel-cassette'].volume, 0.21);
  assert.equal(saved.data.styles.classic.quality, 'high');
  assert.equal(f.values.openingStyle, DEFAULT_SETTINGS.openingStyle);
  assert.equal(f.values.openingEnabled, DEFAULT_SETTINGS.openingEnabled);
  const avatar = await f.request('character', { file: { name: 'avatar.png', bytes: png } });
  assert.equal(avatar.status, 200);
  assert.equal(avatar.data.pixelCharacterName, 'avatar.png');
  assert.equal(avatar.data.characterUrl, '');
  assert.equal((await fetch(`${f.origin}${avatar.data.pixelCharacterUrl}`)).status, 200);
  const desktop = await fetch(`${f.origin}/api/opening/config`, { headers: { Authorization: `Bearer ${f.token}` } }).then(r => r.json());
  assert.equal(desktop.data.pixelCharacterUrl, avatar.data.pixelCharacterUrl);
  assert.equal((await f.request('music', { file: { name: 'opening.mp3', bytes: Buffer.from('synthetic music') } })).status, 200);
  assert.equal((await f.request('music', { method: 'DELETE' })).data.styles['pixel-cassette'].audioUrl, '');
  assert.equal((await f.request('character', { method: 'DELETE' })).data.pixelCharacterUrl, '');
});

test('classic full character and pixel head portrait both start empty and never borrow each other\'s image', async t => {
  const f = await fixture(t);
  const initial = (await f.request('config')).data;
  assert.equal(initial.styles.classic.characterUrl, '');
  assert.equal(initial.styles['pixel-cassette'].pixelCharacterUrl, '');
  const classic = (await f.request('character', { style: 'classic', file: { name: 'full-character.png', bytes: png } })).data;
  assert.ok(classic.styles.classic.characterUrl);
  assert.equal(classic.styles['pixel-cassette'].pixelCharacterUrl, '');
  const portrait = (await f.request('character', { file: { name: 'head-portrait.png', bytes: png } })).data;
  assert.notEqual(portrait.styles.classic.characterUrl, portrait.styles['pixel-cassette'].pixelCharacterUrl);
  const cleared = (await f.request('character', { style: 'classic', method: 'DELETE' })).data;
  assert.equal(cleared.styles.classic.characterUrl, '');
  assert.equal(cleared.styles['pixel-cassette'].pixelCharacterName, 'head-portrait.png');
});

test('canvas opening rejects unrelated fields, bad uploads and unauthorized callers', async t => {
  const f = await fixture(t);
  for (const patch of [{ openingEnabled: 'true' }, { title: '卡带不支持文案' }, { quality: 'bad' }, { volume: 2 }, { constructor: 'x' }]) {
    assert.equal((await f.request('config', { patch })).status, 400);
  }
  assert.equal((await f.request('config', { patch: { title: '新标题' }, style: 'classic' })).status, 200);
  assert.equal(f.values.openingTitle, '新标题');
  assert.equal((await f.request('config', { patch: { quality: 'low' }, style: 'moonlit-fan' })).status, 400);
  assert.equal((await f.request('character', { file: { name: 'fake.png', bytes: Buffer.from('invalid') } })).status, 400);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'opening-character')), false);
  assert.equal((await f.request('config', { token: 'bad' })).status, 403);
  assert.equal((await f.request('config', { token: f.token })).status, 403);
  assert.equal((await f.request('config', { origin: 'https://example.com' })).status, 403);
  const { data: other } = await f.post({ action: 'open', component: 'clock', state: { ...state, draft: {}, saved: {} } });
  assert.equal((await f.request('config', { token: other.token })).status, 403);
  await f.post({ action: 'attach', id: f.session.id, attachmentId: randomUUID(), previousAttachmentId: f.query.get('attachmentId') }, f.session.token);
  assert.equal((await f.request('config')).status, 409);
});

test('revoking a canvas during avatar upload prevents storage and settings changes', async t => {
  const { handleCanvasOpening } = require('../../src/server/routes/opening-preview-routes');
  const dataDir = createScratchDirectory('opening-revoked-upload-', t);
  const sessions = createComponentPreviewSessions();
  const opened = sessions.open({ component: 'canvas', state });
  const attachmentId = randomUUID();
  sessions.browser({ action: 'attach', id: opened.id, attachmentId, previousAttachmentId: null }, opened.token);
  const req = new PassThrough(); req.method = 'POST';
  req.headers = { authorization: `Bearer ${opened.token}`, 'content-type': 'multipart/form-data; boundary=test' };
  const res = { setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  const pending = handleCanvasOpening({ componentPreviews: sessions, system: { dataDir }, settings: {
    set() { assert.fail('A revoked upload cannot change settings'); },
  } }, req, res, new URL(`http://localhost/api/component-preview/opening/character?id=${opened.id}&attachmentId=${attachmentId}&style=pixel-cassette`));
  req.write('--test\r\nContent-Disposition: form-data; name="file"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n');
  sessions.revoke(opened.id);
  req.end(Buffer.concat([png, Buffer.from('\r\n--test--\r\n')]));
  await pending;
  assert.equal(res.status, 410);
  assert.equal(fs.existsSync(path.join(dataDir, 'opening-character')), false);
});
