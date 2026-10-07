'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { createComponentPreviewSessions, SESSION_TTL_MS } = require('../../src/server/component-preview-sessions');
const { handleCanvasTextMedia } = require('../../src/server/routes/scene-text-media-routes');
const { MAX_TEXT_IMAGE_BYTES } = require('../../src/server/scene-text-images');
const { createOverlayToken } = require('../../src/server/access-policy');
const { createScratchDirectory } = require('../helpers/scratch-directory');

const state = { draft: { document: {} }, saved: { document: {} }, generation: 0, loaded: true };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const gif = Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');

async function fixture(t, options = {}) {
  const dataDir = createScratchDirectory('scene-text-media-', t);
  const server = await startComponentPreviewServer({ dataDir, overtime: {
    getGiftCatalog: () => ({ schemaVersion: 3, gifts: [{ id: 'room-gift' }], blindBoxes: [] }),
    getGlobalGiftCatalog: () => ({ schemaVersion: 3, gifts: [{ id: 'all-gift' }], blindBoxes: [] }),
  }, ...options });
  t.after(server.close);
  const { data: session } = await server.post({ action: 'open', component: 'canvas', state });
  const attachmentId = randomUUID();
  await server.post({ action: 'attach', id: session.id, attachmentId, previousAttachmentId: null }, session.token);
  const query = new URLSearchParams({ id: session.id, attachmentId });
  async function request(route, { method = 'GET', body, bearer = session.token, headers = {} } = {}) {
    const response = await fetch(`${server.origin}${route}`, {
      method, body, headers: { Authorization: `Bearer ${bearer}`, ...headers },
    });
    return { status: response.status, ...await response.json() };
  }
  return { ...server, dataDir, session, attachmentId, query, request };
}

test('desktop and attached canvas share bounded image upload and cached gift reads', async t => {
  const f = await fixture(t);
  for (const source of ['room', 'all']) {
    for (const route of [`/api/scenes/text-gifts?source=${source}`,
      `/api/component-preview/text-gifts?${f.query}&source=${source}`]) {
      const result = await f.request(route, { bearer: route.startsWith('/api/scenes/') ? f.token : f.session.token });
      assert.equal(result.status, 200);
      assert.equal(result.data.gifts[0].id, `${source}-gift`);
      assert.equal(result.data.guards.find(gift => gift.id === 'guard-1').name, '总督');
      assert.equal(result.data.schemaVersion, 3);
    }
  }
  const formats = [
    ['image/png', 'png', png], ['image/gif', 'gif', gif],
    ['image/jpeg', 'jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])],
    ['image/webp', 'webp', Buffer.from('524946460400000057454250', 'hex')],
  ];
  for (const [contentType, extension, bytes] of formats) {
    const uploaded = await f.request(`/api/component-preview/text-image?${f.query}`, {
      method: 'POST', body: bytes, headers: { 'Content-Type': contentType },
    });
    assert.equal(uploaded.status, 200);
    assert.match(uploaded.data.imagePath, new RegExp(`^/scene-text-images/[a-f0-9-]{36}\\.${extension}$`));
    const served = await fetch(`${f.origin}${uploaded.data.imagePath}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), contentType);
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes, 'Keep original animated image bytes.');
    const head = await fetch(`${f.origin}${uploaded.data.imagePath}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), bytes.length);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  assert.equal((await f.request('/api/scenes/text-image', { method: 'POST', bearer: f.token,
    body: png, headers: { 'Content-Type': 'image/png' } })).status, 200);
  assert.equal(fs.readdirSync(path.join(f.dataDir, 'scene-text-images')).length, 5);
});

test('text media rejects invalid bytes, unsupported MIME, oversized requests and path escapes', async t => {
  const f = await fixture(t);
  const upload = (body, contentType) => f.request(`/api/component-preview/text-image?${f.query}`, {
    method: 'POST', body, headers: { 'Content-Type': contentType },
  });
  for (const [bytes, mime] of [[Buffer.from('<svg/>'), 'image/svg+xml'], [png, 'image/gif'],
    [Buffer.alloc(0), 'image/png'], [Buffer.from('<html/>'), 'image/png']]) {
    assert.equal((await upload(bytes, mime)).status, 400);
  }
  assert.equal((await upload(Buffer.alloc(MAX_TEXT_IMAGE_BYTES + 1), 'image/png')).status, 413);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'scene-text-images')), false);
  const maximum = Buffer.alloc(MAX_TEXT_IMAGE_BYTES);
  png.copy(maximum);
  assert.equal((await upload(maximum, 'image/png')).status, 200);
  for (const suffix of ['%2e%2e%2fsecret.png', '%2e%2e%5csecret.png', 'image.svg', `${randomUUID()}.png.tmp`]) {
    assert.equal((await fetch(`${f.origin}/scene-text-images/${suffix}`)).status, 404);
  }
  const uploaded = await upload(png, 'image/png');
  assert.equal((await fetch(`${f.origin}${uploaded.data.imagePath}`, { method: 'POST' })).status, 405);
  const file = path.join(f.dataDir, uploaded.data.imagePath);
  fs.writeFileSync(file, '<html>tampered</html>');
  assert.equal((await fetch(`${f.origin}${uploaded.data.imagePath}`)).status, 404);
  assert.equal((await f.request(`/api/component-preview/text-gifts?${f.query}&source=private`)).status, 400);
});

test('uploaded image serving rejects symlinks', async t => {
  const f = await fixture(t);
  const directory = path.join(f.dataDir, 'scene-text-images');
  fs.mkdirSync(directory);
  const target = path.join(f.dataDir, 'private.png');
  fs.writeFileSync(target, png);
  const name = `${randomUUID()}.png`;
  const link = path.join(directory, name);
  try { fs.symlinkSync(target, link); } catch (error) {
    if (error.code !== 'EPERM') throw error;
    // Exercise the same lstat boundary on hosts without file-symlink privileges.
    // The readable image makes a regression to stat/readFile return 200 and fail.
    fs.copyFileSync(target, link);
    const lstat = fs.promises.lstat;
    t.mock.method(fs.promises, 'lstat', async file => file === link
      ? { isFile: () => false, isSymbolicLink: () => true, size: png.length }
      : lstat(file));
    t.diagnostic('File symlinks unavailable; simulated symlink metadata at the lstat boundary.');
  }
  assert.equal((await fetch(`${f.origin}/scene-text-images/${name}`)).status, 404);
});

test('canvas media capability cannot access management APIs or other attachments and origins', async t => {
  let owner = 'first';
  const f = await fixture(t, { getOwner: () => owner });
  const route = `/api/component-preview/text-gifts?${f.query}`;
  assert.equal((await f.request('/api/scenes/text-gifts')).status, 401);
  assert.equal((await f.request('/api/overtime/gifts')).status, 401);
  const overlay = createOverlayToken(f.token, 'clock');
  assert.equal((await f.request('/api/scenes/text-gifts', { bearer: overlay })).status, 403);
  assert.equal((await f.request('/api/scenes/text-image', { method: 'POST', body: png,
    bearer: overlay, headers: { 'Content-Type': 'image/png' } })).status, 403);
  assert.equal((await f.request(route, { bearer: overlay })).status, 403);
  assert.equal((await f.request(route, { bearer: '' })).status, 403);
  assert.equal((await f.request(route, { bearer: f.token })).status, 403);
  for (const origin of ['null', 'https://untrusted.test']) {
    assert.equal((await f.request(route, { headers: { Origin: origin } })).status, 403);
    assert.equal((await f.request(`/api/component-preview/text-image?${f.query}`, { method: 'POST', body: png,
      headers: { 'Content-Type': 'image/png', Origin: origin } })).status, 403);
  }
  const { data: clock } = await f.post({ action: 'open', component: 'clock', state });
  assert.equal((await f.request(`/api/component-preview/text-gifts?id=${clock.id}&attachmentId=${f.attachmentId}`,
    { bearer: clock.token })).status, 403);
  assert.equal((await f.request(`/api/component-preview/text-gifts?id=${f.session.id}`)).status, 409);
  await f.post({ action: 'attach', id: f.session.id, attachmentId: randomUUID(), previousAttachmentId: f.attachmentId }, f.session.token);
  assert.equal((await f.request(route)).status, 409);
  owner = 'second';
  assert.equal((await f.request(route)).status, 410);
});

test('canvas media rejects suspended, unloaded, closed and revoked sessions without renewing leases', () => {
  let now = 0;
  const sessions = createComponentPreviewSessions({ now: () => now });
  function opened(loaded = true) {
    const session = sessions.open({ component: 'canvas', state: { ...state, loaded } });
    const input = { id: session.id, attachmentId: randomUUID() };
    sessions.browser({ ...input, action: 'attach', previousAttachmentId: null }, session.token);
    return { input, token: session.token };
  }
  let session = opened();
  now = SESSION_TTL_MS - 1;
  sessions.authorizeCanvasMedia(session.input, session.token);
  now += 2;
  assert.throws(() => sessions.authorizeCanvasMedia(session.input, session.token), { statusCode: 503 });
  session = opened(false);
  assert.throws(() => sessions.authorizeCanvasMedia(session.input, session.token), { statusCode: 409 });
  session = opened();
  sessions.browser({ ...session.input, action: 'close' }, session.token);
  assert.throws(() => sessions.authorizeCanvasMedia(session.input, session.token), { statusCode: 410 });
  session = opened();
  sessions.revoke(session.input.id);
  assert.throws(() => sessions.authorizeCanvasMedia(session.input, session.token), { statusCode: 410 });
});

test('a slow upload cannot write after its attachment is replaced', async t => {
  const dataDir = createScratchDirectory('scene-text-media-', t);
  const sessions = createComponentPreviewSessions();
  const session = sessions.open({ component: 'canvas', state });
  const attachmentId = randomUUID();
  sessions.browser({ id: session.id, attachmentId, previousAttachmentId: null, action: 'attach' }, session.token);
  const req = new PassThrough();
  req.method = 'POST';
  req.headers = { authorization: `Bearer ${session.token}`, 'content-type': 'image/png' };
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  const url = new URL(`http://localhost/api/component-preview/text-image?id=${session.id}&attachmentId=${attachmentId}`);
  const pending = handleCanvasTextMedia({ system: { dataDir }, componentPreviews: sessions }, req, res, url);
  req.write(png.subarray(0, 8));
  sessions.browser({ id: session.id, attachmentId: randomUUID(), previousAttachmentId: attachmentId, action: 'attach' }, session.token);
  req.end(png.subarray(8));
  await pending;
  assert.equal(res.status, 409);
  assert.equal(fs.existsSync(path.join(dataDir, 'scene-text-images')), false);
});
