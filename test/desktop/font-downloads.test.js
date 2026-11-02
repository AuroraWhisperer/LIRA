'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { createFontLibrary } = require('../../src/fonts/font-library');
const { downloadFont, sha256 } = require('../../src/fonts/font-download');
const { fonts: catalog } = require('../../src/fonts/catalog.json');

const bytes = text => Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(12), Buffer.from(text)]);
function entry(id, content = bytes(id)) {
  return { id, label: id, family: `Font ${id}`, format: 'woff2', size: content.length,
    sha256: sha256(content), bundled: [], sources: [{ url: `https://cdn.jsdelivr.net/test/${id}`, downloadSize: content.length }] };
}
async function fixture(t, fonts, fetch) {
  const scratch = path.resolve(__dirname, '../../tmp/font-tests');
  await fs.mkdir(scratch, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratch, 'cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { dataDir: root, publicDir: path.join(root, 'public'), fonts, fetch };
  const library = createFontLibrary(options);
  t.after(() => library.close());
  return { library, options, directory: path.join(root, 'cache/fonts') };
}

test('font manifest pins complete fonts and development copies without a LIRA origin', async () => {
  assert.ok(catalog.length > 0, 'shared display fonts have a bundled catalog');
  for (const font of catalog) {
    assert.match(font.sha256, /^[a-f0-9]{64}$/);
    assert.ok(font.size < 32 * 1024 * 1024);
    for (const source of font.sources) {
      assert.ok(['cdn.jsdelivr.net', 'github.com', 'raw.githubusercontent.com'].includes(new URL(source.url).hostname));
      assert.ok(!source.url.includes('AuroraWhisperer/LIRA'));
      assert.ok(source.downloadSize > 0);
    }
    for (const file of font.bundled)
      assert.equal(sha256(await fs.readFile(path.resolve(__dirname, '../../public/fonts', file.path))), file.sha256);
  }
});

test('first download is single-flight with two workers; subsequent startup uses zero network', async t => {
  let active = 0; let peak = 0; let requests = 0;
  const fonts = ['one', 'two', 'three'].map(id => entry(id));
  const { library, options, directory } = await fixture(t, fonts, async url => {
    requests++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return new Response(bytes(url.split('/').at(-1)));
  });
  const states = []; library.onStateChanged(state => states.push(state));
  const first = library.initialize();
  assert.equal(library.initialize(), first);
  assert.equal((await first).status, 'ready');
  assert.equal(peak, 2); assert.equal(requests, 3);
  assert.equal(states.at(-1).completed, 3);
  assert.equal((await fs.readdir(directory)).some(file => file.endsWith('.tmp')), false);
  const restored = createFontLibrary(options); t.after(() => restored.close());
  assert.equal((await restored.initialize()).total, 0);
  assert.equal(requests, 3);
  assert.deepEqual((await restored.readFont('one')).bytes, bytes('one'));
  await fs.writeFile(path.join(directory, `${fonts[1].sha256}.woff2`), 'truncated');
  assert.equal((await restored.initialize()).total, 1);
  assert.equal(requests, 4);
});

for (const code of ['EPERM', 'EBUSY']) test(`font index replacement recovers from ${code} without downloading again`, async t => {
  let requests = 0; let blocked = 0; let replacements = 0;
  const { library, directory } = await fixture(t, ['one', 'two'].map(id => entry(id)), async url => {
    requests++;
    return new Response(bytes(url.split('/').at(-1)));
  });
  const rename = fs.rename;
  const temporaryFiles = new Set();
  t.mock.method(fs, 'rename', async (source, target) => {
    if (target === path.join(directory, 'index.json') && replacements++ > 0 && blocked < 2) {
      blocked++; temporaryFiles.add(source);
      throw Object.assign(new Error('Synthetic temporary index lock'), { code });
    }
    return rename(source, target);
  });
  assert.equal((await library.initialize()).status, 'ready');
  assert.equal(blocked, 2);
  assert.equal(temporaryFiles.size, 1);
  assert.equal(requests, 2);
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(directory, 'index.json'))).fonts).sort(), ['one', 'two']);
  assert.equal((await fs.readdir(directory)).some(file => file.endsWith('.tmp')), false);
});

test('persistent font index locks keep the old index and allow a later cached retry', async t => {
  const { library, options, directory } = await fixture(t, [entry('one')], async () => new Response(bytes('one')));
  await library.initialize();
  const indexPath = path.join(directory, 'index.json');
  const previous = await fs.readFile(indexPath, 'utf8');
  let requests = 0; let attempts = 0;
  const updated = entry('one', bytes('updated'));
  const next = createFontLibrary({ ...options, fonts: [updated], fetch: async () => { requests++; return new Response(bytes('updated')); } });
  t.after(() => next.close());
  const rename = fs.rename;
  const temporaryFiles = new Set();
  const locked = t.mock.method(fs, 'rename', async (source, target) => {
    if (target === indexPath) {
      attempts++; temporaryFiles.add(source);
      throw Object.assign(new Error('Synthetic persistent index lock'), { code: 'EPERM' });
    }
    return rename(source, target);
  });
  assert.equal((await next.initialize()).status, 'error');
  assert.equal(attempts, 5);
  assert.equal(temporaryFiles.size, 1);
  assert.equal(await fs.readFile(indexPath, 'utf8'), previous);
  assert.deepEqual((await library.readFont('one')).bytes, bytes('one'));
  assert.equal((await fs.readdir(directory)).some(file => file.endsWith('.tmp')), false);
  locked.mock.restore();
  assert.equal((await next.initialize()).status, 'ready');
  assert.equal(requests, 1);
});

test('all shared fonts initialize on a clean offline install without downloads or a cache', async t => {
  const { options, directory } = await fixture(t, catalog);
  let requests = 0;
  const library = createFontLibrary({ ...options, publicDir: path.resolve(__dirname, '../../public'),
    fetch: async () => { requests++; throw new Error('Offline'); } });
  t.after(() => library.close());
  const state = await library.initialize();
  assert.equal(state.status, 'ready');
  assert.equal(state.total, 0);
  assert.equal(requests, 0);
  for (const font of catalog) {
    assert.ok(library.stylesheet().includes(`font-family: '${font.family}'`), font.id);
    for (const file of font.bundled) {
      assert.ok(library.stylesheet().includes(`/fonts/${file.path}`), file.path);
      for (const alias of file.aliases || [])
        assert.ok(library.stylesheet().includes(`font-family: '${alias}'`), alias);
    }
  }
  await assert.rejects(fs.access(directory), { code: 'ENOENT' });
});

test('failed revision keeps the last good font; retry downloads only that revision', async t => {
  const old = entry('one');
  const { library, options, directory } = await fixture(t, [old], async () => new Response(bytes('one')));
  await library.initialize();
  const replacement = bytes('new font');
  const updated = entry('one', replacement);
  let fail = true; let requests = 0;
  const next = createFontLibrary({ ...options, fonts: [updated], fetch: async () => {
    requests++; return new Response(fail ? bytes('tampered') : replacement);
  } });
  t.after(() => next.close());
  const pending = next.initialize();
  assert.deepEqual((await next.readFont('one')).bytes, bytes('one'));
  assert.equal((await pending).status, 'error');
  assert.deepEqual((await next.readFont('one')).bytes, bytes('one'));
  fail = false;
  assert.equal((await next.initialize()).status, 'ready');
  assert.deepEqual((await next.readFont('one')).bytes, replacement);
  assert.equal(requests, 2);
  const index = JSON.parse(await fs.readFile(path.join(directory, 'index.json'), 'utf8'));
  assert.equal(index.fonts.one.sha256, updated.sha256);
  await assert.rejects(fs.access(path.join(directory, `${old.sha256}.woff2`)), { code: 'ENOENT' });
});

test('closing cancels downloads, settles HTTP waiters and leaves no partial font', async t => {
  const started = Promise.withResolvers();
  const { library, directory } = await fixture(t, [entry('one'), entry('two'), entry('three')], async (_url, { signal }) => {
    started.resolve();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const pending = library.initialize();
  await started.promise;
  const waiting = library.readFont('three');
  await library.close();
  await pending;
  assert.equal(await waiting, null);
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal((await library.initialize()).status, 'idle');
});

test('download rejects corrupt bytes, oversize and private redirects; approved mirror can recover', async () => {
  const font = entry('one');
  const signal = new AbortController().signal;
  await assert.rejects(downloadFont(font, { signal, fetch: async () => new Response(bytes('bad')) }), /FONT_HASH_INVALID/);
  await assert.rejects(downloadFont(font, { signal, fetch: async () => new Response(bytes('too large')) }), /FONT_SIZE_INVALID/);
  let calls = 0;
  await assert.rejects(downloadFont(font, { signal, fetch: async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  } }), /FONT_SOURCE_INVALID/);
  assert.equal(calls, 1);
  const mirrored = { ...font, sources: [font.sources[0], { ...font.sources[0], url: 'https://raw.githubusercontent.com/fonts/one' }] };
  calls = 0;
  assert.deepEqual(await downloadFont(mirrored, { signal, fetch: async () => {
    calls++; return calls === 1 ? new Response(null, { status: 503 }) : new Response(bytes('one'));
  } }), bytes('one'));
  assert.equal(calls, 2);
});

test('an interrupted index restores from verified files without downloading again', async t => {
  const font = entry('one'); let requests = 0;
  const { library, options, directory } = await fixture(t, [font], async () => { requests++; return new Response(bytes('one')); });
  await library.initialize();
  await fs.writeFile(path.join(directory, 'index.json'), '{');
  const restored = createFontLibrary(options); t.after(() => restored.close());
  assert.equal((await restored.initialize()).total, 0);
  assert.equal(requests, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'index.json'))).fonts.one.sha256, font.sha256);
});
