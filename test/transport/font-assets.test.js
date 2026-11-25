'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { createFontLibrary } = require('../../src/fonts/font-library');
const { fonts } = require('../../src/fonts/catalog.json');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { createResourceLibrary } = require('../../src/resources/resource-library');
const { sha256 } = require('../../src/fonts/font-download');
const { serveFontAsset } = require('../../src/server/font-assets');

test('cold font HTTP never blocks rendering, then serves verified fonts with HEAD/CORS', async t => {
  const scratch = path.resolve(__dirname, '../../tmp/font-tests');
  await fs.mkdir(scratch, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(scratch, 'http-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const font = { ...fonts.find(font => font.id === 'smiley'), bundled: [] };
  font.sources = [{ url: 'https://cdn.jsdelivr.net/test/font', downloadSize: font.size }];
  const bytes = await fs.readFile(path.resolve(__dirname, '../../public/fonts/player/smiley.woff2'));
  const download = Promise.withResolvers();
  const library = createFontLibrary({ dataDir, publicDir: dataDir, fonts: [font], fetch: () => download.promise });
  t.after(() => library.close());
  const fixture = await startComponentPreviewServer({ fontLibrary: library });
  t.after(() => fixture.close());
  const initializing = library.initialize();
  const stylesheet = await fetch(`${fixture.origin}/css/shared/display-fonts.css`);
  assert.equal(stylesheet.status, 200);
  assert.doesNotMatch(await stylesheet.text(), /\/font-library\/smiley/);
  assert.equal((await fetch(`${fixture.origin}/font-library/smiley`)).status, 404);
  download.resolve(new Response(bytes));
  await initializing;
  const response = await fetch(`${fixture.origin}/font-library/smiley`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'font/woff2');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.match(await (await fetch(`${fixture.origin}/css/shared/display-fonts.css`)).text(), /\/font-library\/smiley/);
  assert.equal((await (await fetch(`${fixture.origin}/font-library/status`)).json()).status, 'ready');
  const open = fs.open;
  let fontFile;
  let bodyReads = 0;
  t.mock.method(fs, 'open', async (filename, ...args) => {
    const handle = await open(filename, ...args);
    if (path.basename(filename) === `${font.sha256}.${font.format}`) {
      fontFile = filename;
      const read = handle.readFile.bind(handle);
      handle.readFile = (...args) => { bodyReads++; return read(...args); };
    }
    return handle;
  });
  const head = await fetch(`${fixture.origin}/font-library/smiley`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(Number(head.headers.get('content-length')), bytes.length);
  const conditional = () => fetch(`${fixture.origin}/font-library/smiley?v=${font.sha256}`,
    { headers: { 'If-None-Match': response.headers.get('etag') } });
  const hit = await conditional();
  assert.equal(hit.status, 304);
  assert.equal(bodyReads, 0);
  await fs.writeFile(fontFile, Buffer.alloc(bytes.length));
  assert.equal((await conditional()).status, 404);
  assert.equal((await fetch(`${fixture.origin}/font-library/unknown`)).status, 404);
  assert.equal((await fetch(`${fixture.origin}/font-library/%2e%2e%2findex.json`)).status, 404);
  assert.equal((await fetch(`${fixture.origin}/admin`)).status, 401);
});

test('CDN fonts and a cold image keep their original local URLs and never expose cache paths', async t => {
  const scratch = path.resolve(__dirname, '../../tmp/font-tests');
  await fs.mkdir(scratch, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(scratch, 'resources-http-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const font = fonts.find(font => font.id === 'smiley');
  const fontPath = `fonts/${font.bundled[0].path}`;
  const bytes = await fs.readFile(path.resolve(__dirname, '../../public', fontPath));
  const image = Buffer.from('a deterministic image fixture');
  const files = [{ path: fontPath, size: bytes.length, sha256: sha256(bytes) },
    { path: 'img/test-map.png', size: image.length, sha256: sha256(image) }];
  const gate = Promise.withResolvers();
  let requests = 0;
  const resources = createResourceLibrary({ dataDir, publicDir: dataDir, files, fetch: async url => {
    requests++;
    if (url.endsWith('/manifest.json')) return Response.json({ version: 1, files });
    await gate.promise;
    return new Response(url.endsWith('.png') ? image : bytes);
  } });
  t.after(() => resources.close());
  const library = createFontLibrary({ dataDir, publicDir: dataDir, fonts: [font], resources });
  t.after(() => library.close());
  const fixture = await startComponentPreviewServer({ fontLibrary: library, resourceLibrary: resources });
  t.after(() => fixture.close());
  const initializing = library.initialize();
  const pendingImage = fetch(`${fixture.origin}/img/test-map.png`);
  gate.resolve();
  assert.equal((await initializing).status, 'ready');
  assert.deepEqual(Buffer.from(await (await pendingImage).arrayBuffer()), image);
  const response = await fetch(`${fixture.origin}/${fontPath}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'font/woff2');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const css = await (await fetch(`${fixture.origin}/css/shared/display-fonts.css`)).text();
  assert.ok(css.includes(`/${fontPath}?v=${sha256(bytes)}`));
  const versioned = `${fixture.origin}/${fontPath}?v=${sha256(bytes)}`;
  const warm = await fetch(versioned, { headers: { 'If-None-Match': `"${sha256(bytes)}"` } });
  assert.equal(warm.status, 304);
  assert.match(warm.headers.get('cache-control'), /immutable/);
  assert.equal((await warm.arrayBuffer()).byteLength, 0);
  const head = await fetch(`${fixture.origin}/img/test-map.png`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), image.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(requests, 3, 'Local requests share the startup downloads.');
});

test('font status waits observe retries and release subscriptions on change, timeout and disconnect', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let state = { status: 'error', completed: 0, completedAt: 'failed' };
  const listeners = new Set();
  const library = {
    getState: () => state,
    onStateChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const request = () => {
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      setHeader() {},
      writeHead() {},
      end(body) { this.body = JSON.parse(body); },
    });
    const pending = serveFontAsset(library, { method: 'GET' }, response,
      new URL('http://local.test/font-library/status?after=error%3A0%3Afailed'));
    return { response, pending };
  };

  const waiting = request();
  assert.equal(listeners.size, 1);
  state = { status: 'checking', completed: 0, completedAt: '' };
  for (const listener of listeners) listener(state);
  await waiting.pending;
  assert.equal(waiting.response.body.status, 'checking');
  assert.equal(listeners.size, 0);

  const alreadyChanged = request();
  await alreadyChanged.pending;
  assert.equal(alreadyChanged.response.body.status, 'checking', 'Changes before subscription are returned immediately.');
  assert.equal(listeners.size, 0);

  state = { status: 'error', completed: 0, completedAt: 'failed' };
  const expired = request();
  t.mock.timers.tick(29999);
  assert.equal(expired.response.body, undefined);
  t.mock.timers.tick(1);
  await expired.pending;
  assert.equal(expired.response.body.status, 'error');
  assert.equal(listeners.size, 0);

  const cancelled = request();
  cancelled.response.destroyed = true;
  cancelled.response.emit('close');
  await cancelled.pending;
  assert.equal(cancelled.response.body, undefined);
  assert.equal(listeners.size, 0);
});
