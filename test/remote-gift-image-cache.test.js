'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createRemoteGiftImageCache,
  MAX_IMAGE_BYTES,
} = require('../src/bilibili/gift/remote-gift-image-cache');

const QUIET_LOGGER = { debug() {}, warn() {} };

test('downloads configured server images into a reusable local cache', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-gift-images-'),
  );
  try {
    let calls = 0;
    const cache = createRemoteGiftImageCache({
      dataDir,
      imageBaseUrl: 'https://api.example.test',
      fetch: async (url, options) => {
        calls += 1;
        assert.equal(url, 'https://api.example.test/gift-media/images/a.webp');
        assert.equal(options.redirect, 'error');
        return new Response(webpBytes());
      },
      logger: QUIET_LOGGER,
    });

    const first = await cache.cacheGifts([
      {
        id: '1',
        name: '示例礼物',
        imagePath: 'https://api.example.test/gift-media/images/a.webp',
      },
    ]);
    assert.deepEqual(first[0], {
      id: '1',
      name: '示例礼物',
      imagePath: '/overtime-gift-images/a.webp',
    });
    assert.equal(fs.readFileSync(path.join(dataDir, 'overtime-gift-images', 'a.webp')).equals(webpBytes()), true);

    const second = await cache.cacheGifts([
      {
        id: '1',
        name: '示例礼物',
        imagePath: 'https://api.example.test/gift-media/images/a.webp',
      },
    ]);
    assert.equal(second[0].imagePath, '/overtime-gift-images/a.webp');
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rejects untrusted paths and invalid image bytes per gift', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-gift-images-invalid-'),
  );
  try {
    let insecureCalls = 0;
    for (const origin of [
      'http://127.0.0.1:13000',
      'https://127.0.0.1',
      'https://localhost',
      'https://[::1]',
    ]) {
      const insecureCache = createRemoteGiftImageCache({
        dataDir,
        imageBaseUrl: origin,
        fetch: async () => {
          insecureCalls += 1;
          return new Response(webpBytes());
        },
      });
      const insecureResult = await insecureCache.cacheGifts([
        {
          id: 'untrusted-origin',
          name: '非法来源图片',
          imagePath: `${origin}/gift-media/images/insecure.webp`,
        },
      ]);
      assert.equal(insecureResult[0].imagePath, '');
    }
    assert.equal(insecureCalls, 0);
    let calls = 0;
    const cache = createRemoteGiftImageCache({
      dataDir,
      imageBaseUrl: 'https://api.example.test',
      fetch: async () => {
        calls += 1;
        return new Response(Buffer.from('not an image'));
      },
      logger: QUIET_LOGGER,
    });
    const result = await cache.cacheGifts([
      {
        id: '1',
        name: '外站',
        imagePath: 'https://evil.example/gift-media/images/a.webp',
      },
      {
        id: '2',
        name: '路径',
        imagePath: 'https://api.example.test/gift-media/images/../a.webp',
      },
      {
        id: '3',
        name: '错误签名',
        imagePath: 'https://api.example.test/gift-media/images/b.webp',
      },
    ]);
    assert.deepEqual(result.map((gift) => gift.imagePath), ['', '', '']);
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('limits concurrent image downloads and enforces the size ceiling', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-gift-images-limit-'),
  );
  try {
    let active = 0;
    let peak = 0;
    const cache = createRemoteGiftImageCache({
      dataDir,
      imageBaseUrl: 'https://api.example.test',
      concurrency: 2,
      fetch: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return new Response(webpBytes());
      },
      logger: QUIET_LOGGER,
    });
    const gifts = Array.from({ length: 5 }, (_, index) => ({
      id: String(index + 1),
      name: `礼物${index + 1}`,
      imagePath: `https://api.example.test/gift-media/images/${index + 1}.webp`,
    }));
    const result = await cache.cacheGifts(gifts);
    assert.equal(peak <= 2, true);
    assert.equal(result.every((gift) => gift.imagePath), true);
    assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);

    const oversizedCache = createRemoteGiftImageCache({
      dataDir,
      imageBaseUrl: 'https://api.example.test',
      fetch: async () => new Response(Buffer.alloc(MAX_IMAGE_BYTES + 1)),
      logger: QUIET_LOGGER,
    });
    const oversized = await oversizedCache.cacheGifts([
      {
        id: 'oversized',
        name: '超限礼物',
        imagePath:
          'https://api.example.test/gift-media/images/oversized.webp',
      },
    ]);
    assert.equal(oversized[0].imagePath, '');
    assert.equal(
      fs.existsSync(path.join(dataDir, 'overtime-gift-images', 'oversized.webp')),
      false,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function webpBytes() {
  const bytes = Buffer.alloc(16);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(8, 4);
  bytes.write('WEBP', 8, 'ascii');
  return bytes;
}
