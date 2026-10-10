'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const MODULE = path.resolve(__dirname, '../../public/js/admin/song-background-image.js');

test('background encoding preserves resolution and caps bytes without falling below 1920 or quality 0.76', async () => {
  const encodes = [];
  let closed = false;
  const canvas = {
    getContext: () => ({ drawImage() {} }),
    toBlob(callback, type, quality) {
      encodes.push([this.width, this.height, type, quality]);
      callback(new Blob([new Uint8Array(this.width > 1920 ? 1100000 : 700000)], { type }));
    },
  };
  const { prepareSongBackground } = await loadModuleExports(MODULE, {
    window: { createImageBitmap: async () => ({ width: 4000, height: 2000, close() { closed = true; } }) },
    document: { createElement: () => canvas },
  });
  const blob = await prepareSongBackground({});
  assert.equal(blob.size, 700000);
  assert.deepEqual(encodes, [
    [2560, 1280, 'image/webp', 0.82], [2560, 1280, 'image/webp', 0.76],
    [1920, 960, 'image/webp', 0.82], [1920, 960, 'image/webp', 0.76],
  ]);
  assert.equal(closed, true);
});

test('small images keep their dimensions and excessive detail fails instead of shrinking further', async () => {
  let closed = 0;
  let oversized = false;
  const sizes = [];
  const canvas = {
    getContext: () => ({ drawImage() {} }),
    toBlob(callback, type) {
      sizes.push([this.width, this.height]);
      callback(new Blob([new Uint8Array(oversized ? 1100000 : 100)], { type }));
    },
  };
  const { prepareSongBackground } = await loadModuleExports(MODULE, {
    window: { createImageBitmap: async () => ({ width: 800, height: 600, close() { closed++; } }) },
    document: { createElement: () => canvas },
  });
  await prepareSongBackground({});
  oversized = true;
  await assert.rejects(prepareSongBackground({}), /BACKGROUND_IMAGE_TOO_DETAILED/);
  assert.ok(sizes.every(([width, height]) => width === 800 && height === 600));
  assert.equal(closed, 2);
});

test('uploaded bytes persist locally, misses fetch once, and failed drafts preserve the confirmed version', async () => {
  const entries = new Map();
  const cache = {
    put: async (url, response) => entries.set(url, response.clone()),
    match: async (url) => entries.get(url)?.clone(),
    keys: async () => Array.from(entries.keys(), (url) => ({ url })),
    delete: async (key) => entries.delete(typeof key === 'string' ? key : key.url),
  };
  let downloads = 0;
  const image = new Blob(['compressed image'], { type: 'image/webp' });
  const { createSongBackgroundImages } = await loadModuleExports(MODULE, {
    URL,
    window: {
      location: { href: 'http://127.0.0.1:3001/admin' }, Response,
      caches: { open: async () => cache, delete: async () => entries.clear() },
    },
    fetch: async (_url, options) => {
      downloads++;
      assert.equal(options.credentials, 'omit');
      assert.equal(options.priority, 'low');
      return new Response(image);
    },
  });
  const images = createSongBackgroundImages();
  const url = 'https://api.example.test/api/public/streamers/a/background?v=one';
  await images.stage(image);
  await images.publish(url, image);
  const reopened = createSongBackgroundImages();
  assert.equal(await (await reopened.read(url)).text(), 'compressed image');
  assert.equal(downloads, 0);
  await reopened.stage(new Blob(['failed candidate']));
  await reopened.discardDraft();
  assert.equal(await (await reopened.read(url)).text(), 'compressed image');
  await reopened.read(`${url}two`);
  await reopened.read(`${url}two`);
  assert.equal(downloads, 1);
  assert.deepEqual(Array.from(entries.keys()), [`${url}two`]);
  await reopened.clear();
  assert.equal(entries.size, 0);
});

test('unavailable cache does not prevent reading an image or misreport a server upload as failed', async () => {
  const { createSongBackgroundImages } = await loadModuleExports(MODULE, {
    URL,
    window: { location: { href: 'http://127.0.0.1:3001/admin' } },
    fetch: async () => new Response(new Blob(['image'], { type: 'image/webp' })),
  });
  const images = createSongBackgroundImages();
  assert.equal(await images.stage(new Blob(['image'])), false);
  assert.equal(await images.publish('https://api.example.test/bg', new Blob(['image'])), false);
  assert.equal(await (await images.read('https://api.example.test/bg')).text(), 'image');
  await images.discardDraft();
  await images.clear();
});
