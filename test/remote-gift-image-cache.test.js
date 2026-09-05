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

    fs.writeFileSync(
      path.join(dataDir, 'overtime-gift-images', 'a.webp'),
      'not an image',
    );
    assert.equal(
      cache.getCachedImagePath(
        'https://api.example.test/gift-media/images/a.webp',
      ),
      '',
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('downloads trusted Bilibili images with stable id-specific cache names', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-gift-images-bilibili-'),
  );
  try {
    const sourceUrl = 'https://i0.hdslb.com/bfs/live/shared.webp';
    const calls = [];
    const progress = [];
    const cache = createRemoteGiftImageCache({
      dataDir,
      imageBaseUrl: 'https://api.example.test',
      fetch: async (url, options) => {
        calls.push({ url, options });
        return new Response(webpBytes());
      },
      logger: QUIET_LOGGER,
    });

    const result = await cache.cacheGifts(
      [
        { id: '101', name: '同名礼物', sourceUrl },
        { id: '102', name: '同名礼物', sourceUrl },
      ],
      { onProgress: (value) => progress.push(value) },
    );

    assert.deepEqual(
      result.map((gift) => gift.imagePath),
      [
        '/overtime-gift-images/101-aa0c9beac01c7884.webp',
        '/overtime-gift-images/102-aa0c9beac01c7884.webp',
      ],
    );
    assert.deepEqual(
      calls.map((call) => call.url).sort(),
      [sourceUrl, sourceUrl],
    );
    assert.equal(calls[0].options.headers.Referer, 'https://live.bilibili.com/');
    assert.equal(calls[0].options.headers['User-Agent'], 'Mozilla/5.0 LIRA/4');
    assert.equal(
      fs.existsSync(path.join(dataDir, 'overtime-gift-images', '101-aa0c9beac01c7884.webp')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(dataDir, 'overtime-gift-images', '102-aa0c9beac01c7884.webp')),
      true,
    );
    assert.deepEqual(
      progress.map((value) => value.completed).sort((a, b) => a - b),
      [1, 2],
    );
    assert.equal(progress.every((value) => value.total === 2 && value.available > 0), true);

    const reused = await cache.cacheGifts([
      { id: '101', name: '同名礼物', sourceUrl },
    ]);
    assert.equal(reused[0].imagePath, result[0].imagePath);
    assert.equal(calls.length, 2);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('stores Bilibili APNG artwork with a locally served PNG extension', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-gift-images-apng-'),
  );
  try {
    const sourceUrl =
      'https://s1.hdslb.com/bfs/live/source.vnd.mozilla.apng';
    const calls = [];
    const cache = createRemoteGiftImageCache({
      dataDir,
      imageBaseUrl: 'https://api.example.test',
      fetch: async (url) => {
        calls.push(url);
        return new Response(pngBytes());
      },
      logger: QUIET_LOGGER,
    });

    const result = await cache.cacheGifts([
      { id: '34929', name: '整蛊盲盒(test)', sourceUrl },
    ]);

    assert.deepEqual(calls, [sourceUrl]);
    assert.match(
      result[0].imagePath,
      /^\/overtime-gift-images\/34929-[a-f0-9]{16}\.png$/,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          dataDir,
          'overtime-gift-images',
          path.posix.basename(result[0].imagePath),
        ),
      ),
      true,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('does not request images from an untrusted Bilibili host', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-gift-images-untrusted-bilibili-'),
  );
  try {
    let calls = 0;
    const cache = createRemoteGiftImageCache({
      dataDir,
      imageBaseUrl: 'https://api.example.test',
      fetch: async () => {
        calls += 1;
        return new Response(webpBytes());
      },
      logger: QUIET_LOGGER,
    });
    const result = await cache.cacheGifts([
      {
        id: '103',
        name: '非法来源图片',
        sourceUrl: 'https://evil.example/bfs/live/blocked.webp',
      },
    ]);
    assert.equal(result[0].imagePath, '');
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('does not transfer Bilibili failures to the server image endpoint', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-gift-images-fallback-'),
  );
  try {
    const calls = [];
    const cache = createRemoteGiftImageCache({
      dataDir,
      imageBaseUrl: 'https://api.example.test',
      fetch: async (url) => {
        calls.push(url);
        if (url.startsWith('https://i0.hdslb.com/'))
          return new Response('unavailable', { status: 503 });
        return new Response(webpBytes());
      },
      logger: QUIET_LOGGER,
    });
    const result = await cache.cacheGifts([
      {
        id: '104',
        name: '回退礼物',
        sourceUrl: 'https://i0.hdslb.com/bfs/live/missing.webp',
        imagePath: 'https://api.example.test/gift-media/images/fallback.webp',
      },
    ]);
    assert.equal(result[0].imagePath, '');
    assert.deepEqual(calls, [
      'https://i0.hdslb.com/bfs/live/missing.webp',
    ]);
    assert.equal(
      cache.getCachedGiftImagePath({
        id: '104',
        name: '回退礼物',
        sourceUrl: 'https://i0.hdslb.com/bfs/live/missing.webp',
        imagePath: 'https://api.example.test/gift-media/images/fallback.webp',
      }),
      '',
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('revisions replace only changed images and keep previous artwork across offline restarts', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-image-revision-'));
  try {
    const calls = [];
    let offline = false;
    const options = {
      dataDir,
      imageBaseUrl: 'https://api.example.test',
      logger: QUIET_LOGGER,
      fetch: async (url) => {
        calls.push(url);
        if (offline) throw new Error('offline');
        return new Response(webpBytes());
      },
    };
    const original = {
      id: '105',
      sourceUrl: 'https://i0.hdslb.com/bfs/live/same.webp',
      imagePath: 'https://api.example.test/gift-media/images/revision-1.webp',
    };
    const unchanged = { ...original, id: '106' };
    const revised = {
      ...original,
      imagePath: 'https://api.example.test/gift-media/images/revision-2.webp',
    };
    let cache = createRemoteGiftImageCache(options);
    const before = await cache.cacheGifts([original, unchanged]);
    assert.equal(cache.isGiftImageCurrent(original), true);
    assert.equal(cache.isGiftImageCurrent(revised), false);

    offline = true;
    cache = createRemoteGiftImageCache(options);
    assert.equal(cache.getCachedGiftImagePath(revised), before[0].imagePath);
    const failed = await cache.cacheGifts([revised, unchanged]);
    assert.equal(failed[0].imagePath, before[0].imagePath);
    assert.equal(cache.isGiftImageCurrent(revised), false);
    assert.equal(calls.length, 3);

    offline = false;
    const updated = await cache.cacheGifts([revised, unchanged]);
    assert.notEqual(updated[0].imagePath, before[0].imagePath);
    assert.equal(updated[1].imagePath, before[1].imagePath);
    assert.equal(cache.isGiftImageCurrent(revised), true);
    assert.equal(calls.length, 4);
    assert.equal(calls.every((url) => url.startsWith('https://i0.hdslb.com/')), true);

    cache = createRemoteGiftImageCache(options);
    assert.equal(cache.getCachedGiftImagePath(revised), updated[0].imagePath);
    await cache.cacheGifts([revised, unchanged]);
    assert.equal(calls.length, 4);
    fs.unlinkSync(path.join(cache.cacheDir, path.posix.basename(updated[0].imagePath)));
    assert.equal(cache.isGiftImageCurrent(revised), false);
    await cache.cacheGifts([revised]);
    assert.equal(calls.length, 5);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('ignores unsafe persisted last-good image mappings', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-image-index-'));
  try {
    const cacheDir = path.join(dataDir, 'overtime-gift-images');
    fs.mkdirSync(cacheDir);
    fs.writeFileSync(path.join(dataDir, 'outside.webp'), webpBytes());
    fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify({
      schemaVersion: 1,
      images: { '107': '../outside.webp', '108': 'bad.svg' },
    }));
    const cache = createRemoteGiftImageCache({
      dataDir,
      imageBaseUrl: 'https://api.example.test',
      logger: QUIET_LOGGER,
    });
    assert.equal(cache.getCachedGiftImagePath({ id: '107' }), '');
    assert.equal(cache.getCachedGiftImagePath({ id: '108' }), '');
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

function pngBytes() {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
}
