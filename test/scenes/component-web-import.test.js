'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PassThrough, Readable } = require('node:stream');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { createComponentWebLibrary } = require('../../src/server/component-web-library');
const { MAX_WEB_BYTES, readWebUpload, webResourceUrl } = require('../../src/server/component-web-files');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { handleStyles } = require('../../src/server/routes/component-style-routes');
const { createOverlayToken } = require('../../src/server/access-policy');
const { SCENE_TYPES } = require('../../public/js/shared/scene-components.js');
const { createScratchDirectory } = require('../helpers/scratch-directory');

const image = Buffer.from([137, 80, 78, 71, 0, 10, 255, 13, 128]);
const description = { type: 'clock', entry: 'index.html', name: '第三方时钟', width: 640, height: 360 };
const bytes = value => Buffer.isBuffer(value) ? value : Buffer.from(value);
const files = entries => entries.map(([name, value]) => ({ path: name, stream: Readable.from([bytes(value)]) }));

function upload(entries) {
  return Buffer.concat([Buffer.from(`${JSON.stringify(entries.map(([name, value]) => ({ path: name, size: bytes(value).length })))}\n`),
    ...entries.map(([, value]) => bytes(value))]);
}

async function fixture(t) {
  const dataDir = createScratchDirectory('component-web-import-');
  const server = await startComponentPreviewServer({ dataDir });
  t.after(async () => { await server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  async function request(action, body, { token = server.token, headers = {}, query = '' } = {}) {
    const response = await fetch(`${server.origin}/api/component-styles/${action}${query}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  return { ...server, dataDir, request,
    add: (entries, details = description, options = {}) => request('web', upload(entries), {
      ...options, query: `?description=${encodeURIComponent(JSON.stringify(details))}`,
    }) };
}

function assertEmptyLibrary(dataDir) {
  const store = createComponentStyleStore(dataDir);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(fs.existsSync(store.root) ? fs.readdirSync(store.root) : [], []);
}

test('HTML bundles preserve relative resources and serve isolated executable pages with correct MIME', async t => {
  const f = await fixture(t);
  const entries = [
    ['widgets/时钟.html', '<!doctype html><link rel="stylesheet" href="../css/theme.css"><script type="module" src="../js/main.mjs"></script><img src="../images/frame%20one.png"><h1>时钟</h1>'],
    ['css/theme.css', '@import "palette.css"; @font-face { font-family: digits; src: url("../fonts/digits.woff2"); } body { background: url("../images/frame%20one.png"); }'],
    ['css/palette.css', ':root { --clock-color: #ace; }'],
    ['js/main.mjs', 'document.querySelector("h1").textContent = "12:34";'],
    ['images/frame one.png', image], ['fonts/digits.woff2', Buffer.from([0, 255, 0, 11])],
    ['images/frame.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'], ['config.json', '{"test":true}'],
  ];
  const result = await f.add(entries, { ...description, entry: entries[0][0] });
  assert.equal(result.status, 200, result.error);
  const style = result.data.styles[0];
  assert.equal(style.type, 'browser');
  assert.equal(style.category, 'clock');
  assert.deepEqual(style.config, { url: webResourceUrl(result.data.id, entries[0][0]), viewportWidth: 640, viewportHeight: 360 });
  assert.deepEqual(normalizeSceneConfig('browser', style.config), style.config);
  const types = ['text/html; charset=utf-8', 'text/css; charset=utf-8', 'text/css; charset=utf-8',
    'text/javascript; charset=utf-8', 'image/png', 'font/woff2', 'image/svg+xml', 'application/json'];
  for (const [index, [name, content]] of entries.entries()) {
    const response = await fetch(`${f.origin}${webResourceUrl(result.data.id, name)}`);
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get('content-type'), types[index], name);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes(content));
    if (/\.(?:html|svg)$/.test(name)) {
      const policy = response.headers.get('content-security-policy');
      assert.match(policy, /sandbox allow-scripts(?:;|$)/);
      assert.doesNotMatch(policy, /allow-same-origin|allow-forms|allow-top-navigation/);
      assert.match(policy, /object-src 'none'/);
      assert.match(policy, /form-action 'none'/);
    }
  }
  const head = await fetch(`${f.origin}${style.config.url}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(bytes(entries[0][1]).length));
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${f.origin}${style.config.url}`, { method: 'POST' })).status, 405);
});

test('the imported danmaku host is anonymously readable with an opaque sandbox and no injected credentials', async t => {
  const f = await fixture(t);
  for (const route of ['/imported-danmaku', '/pages/overlays/imported-danmaku.html?componentPreview=1&sceneComponent=1']) {
    const response = await fetch(`${f.origin}${route}`, { headers: { Origin: 'null' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(response.headers.get('content-security-policy'), 'sandbox allow-scripts');
    assert.equal(response.headers.get('x-frame-options'), null);
    const html = await response.text();
    assert.match(html, /\/js\/overlays\/imported-danmaku\.js/);
    assert.doesNotMatch(html, /__API_TOKEN__|__PLAYBACK_SNAPSHOT_WRITER__/);
    assert.equal(html.includes(f.token), false);
  }
  assert.equal((await fetch(`${f.origin}/imported-danmaku`, { method: 'POST' })).status, 405);
});

test('binary upload framing handles split headers and arbitrary binary boundaries without corruption', async t => {
  const f = await fixture(t);
  const entries = [['index.html', '<img src="frame.png">'], ['frame.png', image], ['empty.json', '']];
  const body = upload(entries);
  const chunks = Array.from({ length: Math.ceil(body.length / 3) }, (_, index) => body.subarray(index * 3, index * 3 + 3));
  const result = await createComponentWebLibrary(f.dataDir).add(readWebUpload(Readable.from(chunks)), description, () => {});
  const root = path.join(createComponentStyleStore(f.dataDir).directory(result.id), 'web');
  for (const [name, content] of entries) assert.deepEqual(fs.readFileSync(path.join(root, name)), bytes(content));
  assert.equal(result.bytes, entries.reduce((sum, [, content]) => sum + bytes(content).length, 0));
});

test('CSS imports retain component defaults for every native category and recognize supported danmaku hosts', async t => {
  const f = await fixture(t);
  for (const type of SCENE_TYPES.filter(type => type !== 'browser')) {
    const result = await f.add([['style.css', 'body { color: #abcdef; }']], { ...description, type, entry: 'style.css' });
    assert.equal(result.status, 200, `${type}: ${result.error}`);
    const style = result.data.styles[0];
    assert.equal(style.type, type);
    assert.equal(style.config.cssStyle.engine, 'native');
    assert.deepEqual(normalizeSceneConfig(type, style.config), style.config);
  }
  for (const [source, engine] of [
    ['yt-live-chat-text-message-renderer #content { color: red; }', 'blivechat'],
    ['.danmaku-author-face { width: 32px; } .danmaku-content { color: gold; }', 'blc'],
    ['/* yt-live-chat-text-message-renderer */ body { color: blue; }', 'native'],
  ]) {
    const result = await f.add([['chat.css', source]], { ...description, type: 'danmaku', entry: 'chat.css' });
    assert.equal(result.status, 200, result.error);
    assert.equal(result.data.styles[0].config.cssStyle.engine, engine);
  }
  for (const [type, source] of [['browser', 'body { color: red; }'], ['clock', 'yt-live-chat-text-message-renderer { color: red; }'],
    ['danmaku', '.event--message { color: red; }']]) {
    const result = await f.add([['style.css', source]], { ...description, type, entry: 'style.css' });
    assert.equal(result.status, 400);
  }
});

test('CSS host recognition follows imported stylesheets rather than only the entry file', async t => {
  const f = await fixture(t);
  for (const [selector, engine] of [['yt-live-chat-text-message-renderer', 'blivechat'], ['.danmaku-content', 'blc']]) {
    const result = await f.add([
      ['style.css', '@import "nested/chat.css";'],
      ['nested/chat.css', `@import "palette.css"; ${selector} { color: #abcdef; }`],
      ['nested/palette.css', ':root { --text-color: white; }'],
    ], { ...description, type: 'danmaku', entry: 'style.css' });
    assert.equal(result.status, 200, result.error);
    assert.equal(result.data.styles[0].config.cssStyle.engine, engine);
  }
});

test('missing HTML and nested CSS dependencies reject the import and remove all staged resources', async t => {
  const f = await fixture(t);
  for (const entries of [
    [['index.html', '<img src="missing.png">']],
    [['index.html', '<link href="theme.css">'], ['theme.css', '@import "nested/palette.css";']],
    [['index.html', '<link href="theme.css">'], ['theme.css', 'body { background: url("missing.png"); }']],
    [['index.html', '<script src="missing.js"></script>']],
    [['index.html', '<img src="file:///C:/private/image.png">']],
    [['index.html', '<img src="/images/frame.png">']],
    [['index.html', '<img src="../../outside.png">']],
    [['other.html', '<h1>Wrong entry</h1>']],
  ]) {
    const result = await f.add(entries);
    assert.equal(result.status, 400, entries[0][1]);
    assertEmptyLibrary(f.dataDir);
  }
});

test('inline CSS, unquoted HTML attributes, srcset and linked HTML cannot hide missing companion files', async t => {
  for (const [name, html] of [
    ['style element', '<style>body { background: url("missing.png"); }</style>'],
    ['style attribute', '<div style="background: url(\'missing.png\')">Clock</div>'],
    ['unquoted source', '<script src=missing.js></script>'],
    ['responsive images', '<img srcset="missing.png 1x, missing-large.png 2x">'],
    ['compact responsive images', '<img srcset="existing.png 1x,missing-large.png 2x">'],
    ['nested page', '<iframe src="missing.html"></iframe>'],
    ['quoted CSS path with spaces', '<style>body { background: url("missing frame.png"); }</style>'],
  ]) await t.test(name, async t => {
    const f = await fixture(t);
    const result = await f.add([['index.html', html], ['existing.png', image]]);
    assert.equal(result.status, 400, html);
    assert.match(result.error, /缺少配套资源/);
    assertEmptyLibrary(f.dataDir);
  });
});

test('complete HTML dependencies import with comments, remote URLs and quoted CSS filenames', async t => {
  const f = await fixture(t);
  const result = await f.add([
    ['index.html', '<!-- <img src="unused.png"> --><style>/* url("unused.png") */ body { background: url("images/frame one.png"); }</style><img src=images/frame.png srcset="images/frame.png 1x, images/frame-large.png 2x"><iframe src="nested/frame.html"></iframe><script src="https://example.test/remote.js"></script>'],
    ['nested/frame.html', '<link href="../theme.css"><img src="../images/frame.png?version=1#image">'],
    ['theme.css', '/* @import "unused.css"; */ body { color: red; background-image: url(data:image/png;base64,AQID); }'],
    ['images/frame one.png', image], ['images/frame.png', image], ['images/frame-large.png', image],
  ]);
  assert.equal(result.status, 200, result.error);
  assert.equal(createComponentStyleStore(f.dataDir).list().length, 1);
});

test('script fetch URLs use the document base while module imports use the importing file', async t => {
  const f = await fixture(t);
  const result = await f.add([
    ['index.html', '<script type="module" src="js/main.mjs"></script>'],
    ['js/main.mjs', 'import { value } from "./dependency.mjs"; fetch("data/config.json"); new URL("images/frame.png", document.baseURI);'],
    ['js/dependency.mjs', 'export const value = 1;'],
    ['data/config.json', '{"clock":true}'], ['images/frame.png', image],
  ]);
  assert.equal(result.status, 200, result.error);
  assert.equal(createComponentStyleStore(f.dataDir).list().length, 1);
});

test('bundle paths and upload size declarations reject traversal, aliases and incomplete or trailing data', async t => {
  const f = await fixture(t);
  const valid = upload([['index.html', '<h1>Clock</h1>']]);
  const invalid = [
    ...['../escape.js', '/absolute.js', 'C:/absolute.js', 'folder\\escape.js', '.hidden.js', 'CON.js', 'folder./x.js', 'bad.exe']
      .map(name => upload([['index.html', '<h1>Clock</h1>'], [name, 'test']])),
    upload([['index.html', '<h1>Clock</h1>'], ['IMAGE.PNG', image], ['image.png', image]]),
    valid.subarray(0, valid.length - 1), Buffer.concat([valid, Buffer.from('extra')]),
    Buffer.from('not-json\n'), Buffer.from('[]\n'),
    ...[-1, 1.5, MAX_WEB_BYTES + 1].map(size => Buffer.from(`${JSON.stringify([{ path: 'index.html', size }])}\n`)),
  ];
  for (const body of invalid) {
    const result = await f.request('web', body, { query: `?description=${encodeURIComponent(JSON.stringify(description))}` });
    assert.equal(result.status, 400, result.error);
    assertEmptyLibrary(f.dataDir);
  }
  const large = await f.add([['index.html', `<h1>${'x'.repeat(4 * 1024 * 1024)}</h1>`]]);
  assert.equal(large.status, 400);
  assertEmptyLibrary(f.dataDir);
});

test('interrupted imports and revoked authorization never commit or retain staged data', async t => {
  const f = await fixture(t);
  const library = createComponentWebLibrary(f.dataDir);
  const stream = new PassThrough();
  let authorized = true;
  let authorizationChecks = 0;
  const pending = library.add([{ path: 'index.html', stream }], description, () => {
    authorizationChecks++;
    if (!authorized) throw Object.assign(new Error('Preview expired'), { statusCode: 410 });
  });
  const rejected = assert.rejects(pending, { statusCode: 410 });
  stream.write('<h1>');
  authorized = false;
  stream.end('Clock</h1>');
  await rejected;
  assert.equal(authorizationChecks, 1);
  const interrupted = Readable.from((async function* () { yield Buffer.from('<h1>'); throw new Error('Upload disconnected'); })());
  await assert.rejects(library.add([{ path: 'index.html', stream: interrupted }], description, () => {}), /Upload disconnected/);
  assertEmptyLibrary(f.dataDir);
});

test('a temporary EPERM while installing web resources retries and commits exactly one complete package', async t => {
  const f = await fixture(t);
  const store = createComponentStyleStore(f.dataDir);
  const originalRename = fs.renameSync;
  let attempts = 0;
  let authorizationChecks = 0;
  fs.renameSync = (from, to) => {
    if (path.dirname(from) === store.root && path.basename(from).startsWith('.pending-') && ++attempts === 1) {
      throw Object.assign(new Error('Temporary Windows file lock'), { code: 'EPERM', syscall: 'rename', path: from, dest: to });
    }
    return originalRename(from, to);
  };
  try {
    const imported = await createComponentWebLibrary(f.dataDir).add(files([['index.html', '<h1>Clock</h1>']]),
      description, () => { authorizationChecks++; });
    assert.ok(attempts >= 2 && attempts <= 5);
    assert.ok(authorizationChecks >= attempts);
    assert.equal(store.list().length, 1);
    assert.equal(fs.readFileSync(path.join(store.directory(imported.id), 'web', 'index.html'), 'utf8'), '<h1>Clock</h1>');
    assert.deepEqual(fs.readdirSync(store.root).sort(), [imported.id, 'index.backup.json', 'index.json'].sort());
  } finally { fs.renameSync = originalRename; }
});

test('revocation during a Windows rename retry prevents installation and removes the pending bundle', async t => {
  const f = await fixture(t);
  const store = createComponentStyleStore(f.dataDir);
  const originalRename = fs.renameSync;
  let authorized = true;
  let attempts = 0;
  fs.renameSync = (from, to) => {
    if (path.dirname(from) === store.root && path.basename(from).startsWith('.pending-') && ++attempts === 1) {
      queueMicrotask(() => { authorized = false; });
      throw Object.assign(new Error('Temporary Windows file lock'), { code: 'EPERM', syscall: 'rename', path: from, dest: to });
    }
    return originalRename(from, to);
  };
  try {
    await assert.rejects(createComponentWebLibrary(f.dataDir).add(files([['index.html', '<h1>Clock</h1>']]), description, () => {
      if (!authorized) throw Object.assign(new Error('Preview authorization expired'), { statusCode: 410 });
    }), { statusCode: 410 });
    assert.equal(attempts, 1);
    assertEmptyLibrary(f.dataDir);
  } finally { fs.renameSync = originalRename; }
});

test('rename recovery does not replay a failed library index commit', async t => {
  const f = await fixture(t);
  const store = createComponentStyleStore(f.dataDir);
  const originalRename = fs.renameSync;
  const indexPath = path.join(store.root, 'index.json');
  let packageRenameAttempts = 0;
  let packageRenames = 0;
  let indexRenames = 0;
  fs.renameSync = (from, to) => {
    const installing = path.dirname(from) === store.root && path.basename(from).startsWith('.pending-');
    if (installing) {
      assert.equal(indexRenames, 0, 'Installation must not replay after an index commit failure');
      if (++packageRenameAttempts === 1) {
        throw Object.assign(new Error('Temporary Windows file lock'), { code: 'EPERM', syscall: 'rename', path: from, dest: to });
      }
    }
    if (to === indexPath) {
      indexRenames++;
      throw Object.assign(new Error('Index write failed'), { code: 'EPERM', syscall: 'rename', path: from, dest: to });
    }
    const result = originalRename(from, to);
    if (installing) packageRenames++;
    return result;
  };
  try {
    await assert.rejects(createComponentWebLibrary(f.dataDir).add(files([['index.html', '<h1>Clock</h1>']]), description, () => {}),
      { code: 'EPERM', dest: indexPath });
    assert.equal(packageRenames, 1);
    assert.equal(indexRenames, 5);
    assertEmptyLibrary(f.dataDir);
  } finally { fs.renameSync = originalRename; }
});

test('a persistent Windows rename lock exhausts bounded retries and removes staged files', { timeout: 3000 }, async t => {
  const f = await fixture(t);
  const store = createComponentStyleStore(f.dataDir);
  const originalRename = fs.renameSync;
  let attempts = 0;
  fs.renameSync = (from, to) => {
    if (path.dirname(from) === store.root && path.basename(from).startsWith('.pending-')) {
      attempts++;
      throw Object.assign(new Error('Persistent Windows file lock'), { code: 'EPERM', syscall: 'rename', path: from, dest: to });
    }
    return originalRename(from, to);
  };
  try {
    await assert.rejects(createComponentWebLibrary(f.dataDir).add(files([['index.html', '<h1>Clock</h1>']]), description, () => {}), { code: 'EPERM' });
    assert.equal(attempts, 5);
    assertEmptyLibrary(f.dataDir);
  } finally { fs.renameSync = originalRename; }
});

test('upload routes require admin or the current canvas attachment and reject opaque imported-page origins', async t => {
  const f = await fixture(t);
  const entries = [['index.html', '<h1>Clock</h1>']];
  assert.equal((await f.add(entries, description, { token: '' })).status, 401);
  assert.equal((await f.add(entries, description, { token: createOverlayToken(f.token, 'clock') })).status, 403);
  assert.equal((await f.add(entries, description, { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await f.add(entries, description, { headers: { Origin: 'https://third-party.test' } })).status, 403);
  const state = { draft: { document: {} }, saved: { document: {} }, loaded: true, generation: 0 };
  const { data: session } = await f.post({ action: 'open', component: 'canvas', state });
  const attachmentId = randomUUID();
  const query = new URLSearchParams({ id: session.id, attachmentId, description: JSON.stringify(description) });
  const endpoint = `${f.origin}/api/component-preview/styles/web?${query}`;
  const send = headers => fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, ...headers }, body: upload(entries) });
  assert.equal((await send()).status, 409);
  await f.post({ action: 'attach', id: session.id, attachmentId, previousAttachmentId: null }, session.token);
  assert.equal((await send({ Origin: 'null' })).status, 403);
  const accepted = await send();
  assert.equal(accepted.status, 200, await accepted.text());
  await f.post({ action: 'open', component: 'canvas', state });
  assert.equal((await send()).status, 410);
  assert.equal(createComponentStyleStore(f.dataDir).list().length, 1);
});

test('installed HTML and CSS survive server restart and remain available after library removal', async t => {
  const f = await fixture(t);
  const imported = [];
  for (const [entry, source] of [['index.html', '<h1>Clock</h1>'], ['style.css', 'body { color: red; }']]) {
    const result = await f.add([[entry, source]], { ...description, entry });
    assert.equal(result.status, 200, result.error);
    imported.push(result.data.styles[0]);
  }
  await f.close();
  const restarted = await startComponentPreviewServer({ dataDir: f.dataDir });
  t.after(restarted.close);
  assert.deepEqual(createComponentStyleStore(f.dataDir).list().flatMap(pack => pack.styles), imported);
  for (const style of imported) {
    createComponentStyleStore(f.dataDir).remove(style.id);
    const source = style.config.url || style.config.cssStyle.src;
    const response = await fetch(`${restarted.origin}${source}`);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  assert.deepEqual(createComponentStyleStore(f.dataDir).list().flatMap(pack => pack.styles), []);
});

test('web serving cannot follow resource junctions or expose library metadata and encoded traversal', async t => {
  const f = await fixture(t);
  const result = await f.add([['index.html', '<h1>Clock</h1>']]);
  assert.equal(result.status, 200, result.error);
  const outside = path.join(f.dataDir, 'private');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.json'), '{"secret":true}');
  fs.symlinkSync(outside, path.join(createComponentStyleStore(f.dataDir).directory(result.data.id), 'web', 'linked'), 'junction');
  for (const resource of ['linked/secret.json', '%2e%2e%2fpackage.json', '%2e%2e%5cpackage.json', 'missing.png']) {
    const response = await fetch(`${f.origin}/component-web/${result.data.id}/${resource}`);
    assert.equal(response.status, 404, resource);
  }
});

async function pickRoute(context, body, token = context.sessionToken) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  let result;
  const res = { destroyed: false, setHeader() {}, writeHead(status) { this.status = status; },
    end(value) { result = { status: this.status, ...JSON.parse(value) }; } };
  await handleStyles(context, req, res, new URL('http://127.0.0.1/api/component-styles/pick-web'));
  return result;
}

test('native import routes handle cancellation, unavailable chooser and authorization revoked while choosing', async t => {
  const f = await fixture(t);
  const context = { sessionToken: f.token, system: { dataDir: f.dataDir } };
  const body = { kind: 'html', description };
  assert.equal((await pickRoute(context, body)).status, 503);
  context.system.pickComponentWebFile = async () => null;
  assert.deepEqual(await pickRoute(context, body), { status: 200, ok: true, data: null });
  let fileReads = 0;
  context.system.pickComponentWebFile = async () => {
    context.sessionToken = 'changed-desktop-session';
    return { entry: 'index.html', files: (async function* () { fileReads++; yield files([['index.html', '<h1>Clock</h1>']])[0]; })() };
  };
  assert.equal((await pickRoute(context, body, f.token)).status, 403);
  assert.equal(fileReads, 0);
  assertEmptyLibrary(f.dataDir);
  context.sessionToken = f.token;
  context.system.pickComponentWebFile = async kind => {
    assert.equal(kind, 'html');
    return { entry: 'index.html', files: files([['index.html', '<h1>Clock</h1>']]) };
  };
  const imported = await pickRoute(context, { ...body, description: { ...description, entry: '../not-selected.html' } });
  assert.equal(imported.status, 200, imported.error);
  assert.match(imported.data.styles[0].config.url, /\/index\.html$/);
});

test('automatic file selection streams bytes without exposing paths and rechecks authorization before opening', async t => {
  const f = await fixture(t);
  let opened = 0;
  const selected = { name: '图片.webp', size: image.length, open() { opened++; return Readable.from([image]); } };
  const context = { sessionToken: f.token, system: { dataDir: f.dataDir, pickComponentWebFile: async kind => {
    assert.equal(kind, 'auto'); return selected;
  } } };
  const req = Readable.from([Buffer.from(JSON.stringify({ kind: 'auto', description }))]);
  Object.assign(req, { method: 'POST', headers: { authorization: `Bearer ${f.token}` } });
  const res = new PassThrough(); const headers = {}; const chunks = [];
  res.setHeader = (key, value) => { headers[key] = value; };
  res.writeHead = (status, values) => { assert.equal(status, 200); Object.assign(headers, values); };
  res.on('data', chunk => chunks.push(chunk));
  await handleStyles(context, req, res, new URL('http://127.0.0.1/api/component-styles/pick-web'));
  assert.deepEqual(Buffer.concat(chunks), image);
  assert.equal(headers['Content-Type'], 'application/octet-stream');
  assert.equal(decodeURIComponent(headers['X-Lira-Filename']), '图片.webp');
  assert.equal(opened, 1);
  context.system.pickComponentWebFile = async () => { context.sessionToken = 'revoked'; return selected; };
  assert.equal((await pickRoute(context, { kind: 'auto', description }, f.token)).status, 403);
  assert.equal(opened, 1);
  assertEmptyLibrary(f.dataDir);
});
