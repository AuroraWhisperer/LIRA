'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createHybridGiftSaleCatalogService } = require('../src/bilibili/gift/hybrid-catalog');
const { STATE_FILE_NAME } = require('../src/bilibili/gift/gift-catalog-initializer');

const HOURS_12 = 12 * 60 * 60 * 1000;
const LOGGER = { warn() {}, debug() {} };

test('authorized startup checks the persisted ETag without downloading unchanged images', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-startup-'));
  let service;
  try {
    const requests = [];
    const updates = [];
    let imageCalls = 0;
    let now = Date.parse('2026-09-05T00:00:00Z');
    const options = {
      dataDir,
      now: () => now,
      onUpdated: (snapshot) => updates.push(snapshot),
      fetchRemote: async (request) => {
        requests.push(request);
        return requests.length === 1
          ? catalog('1')
          : { notModified: true, etag: '"1"' };
      },
      fetchImage: async () => {
        imageCalls += 1;
        return new Response(webpBytes());
      },
    };
    service = createService(options);
    await service.initializeGlobalCatalog({ force: true, reason: 'authorized-startup' });
    service.stop();
    service = createService(options);
    assert.equal(service.isGlobalCatalogInitialized(), true);
    assert.equal(service.getInitializationState().background, false);
    await service.initializeGlobalCatalog({ force: true, reason: 'authorized-startup' });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].etag, '"1"');
    assert.equal(imageCalls, 1);
    assert.equal(service.getInitializationState().total, 0);
    const gift = service.getGlobalSnapshot().gifts[0];
    const beforeRepair = updates.at(-1);
    fs.unlinkSync(path.join(dataDir, 'overtime-gift-images', path.posix.basename(gift.imagePath)));
    now += HOURS_12;
    await service.initializeGlobalCatalog({ force: true });
    assert.equal(requests.length, 3);
    assert.equal(imageCalls, 2);
    assert.equal(service.getInitializationState().total, 1);
    assert.equal(service.getInitializationState().background, true);
    assert.equal(updates.length, 3);
    assert.equal(updates.at(-1).gifts[0].imagePath, gift.imagePath);
    assert.notEqual(updates.at(-1).assetsUpdatedAt, beforeRepair.assetsUpdatedAt);
  } finally {
    service?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('checks every 12 hours, retries failed images on 304, and stops polling', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-09-05T00:00:00Z') });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-schedule-'));
  let service;
  try {
    let catalogCalls = 0;
    const imageCalls = [];
    const updates = [];
    service = createService({
      dataDir,
      onUpdated: (snapshot) => updates.push(snapshot),
      fetchRemote: async () => ++catalogCalls === 1
        ? catalog('1')
        : { notModified: true, etag: '"1"' },
      fetchImage: async (url) => {
        imageCalls.push(url);
        return imageCalls.length === 1
          ? new Response('offline', { status: 503 })
          : new Response(webpBytes());
      },
    });
    service.start();
    service.start();
    await service.initializeGlobalCatalog({ force: true });
    assert.equal(imageCalls.length, 1);
    assert.equal(updates[0].gifts[0].imagePath, '');
    t.mock.timers.tick(HOURS_12 - 1);
    assert.equal(catalogCalls, 1);

    let ready = nextReady(service);
    t.mock.timers.tick(1);
    await ready;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(catalogCalls, 2);
    assert.equal(imageCalls.length, 2);
    assert.equal(updates.length, 2);
    assert.equal(updates[1].version, '1');
    assert.match(updates[1].gifts[0].imagePath, /^\/overtime-gift-images\//);

    ready = nextReady(service);
    t.mock.timers.tick(HOURS_12);
    await ready;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(catalogCalls, 3);
    assert.equal(imageCalls.length, 2);
    assert.equal(updates.length, 2);
    assert.equal(service.getInitializationState().total, 0);
    service.stop();
    t.mock.timers.tick(HOURS_12 * 2);
    assert.equal(catalogCalls, 3);
  } finally {
    service?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('publishes local artwork only after downloads complete and preserves room membership', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-ready-'));
  let service;
  try {
    const updates = [];
    let beginDownload;
    const started = new Promise((resolve) => { beginDownload = resolve; });
    let beginSecondDownload;
    const secondStarted = new Promise((resolve) => { beginSecondDownload = resolve; });
    let downloadCalls = 0;
    let releaseDownload;
    service = createService({
      dataDir,
      onUpdated: (snapshot) => updates.push(snapshot),
      fetchRemote: async () => ({
        ...catalog('1'),
        gifts: [...catalog('1').gifts, { ...catalog('1').gifts[0], id: '2' }],
      }),
      fetchImage: async () => {
        downloadCalls += 1;
        if (downloadCalls === 1) beginDownload();
        else beginSecondDownload();
        await new Promise((resolve) => { releaseDownload = resolve; });
        return new Response(webpBytes());
      },
      imageConcurrency: 1,
    });
    const initialization = service.initializeGlobalCatalog({ force: true });
    await started;
    assert.equal(updates.length, 0);
    releaseDownload();
    await secondStarted;
    releaseDownload();
    await initialization;
    assert.equal(updates.length, 1);
    assert.equal(updates[0].gifts.every((gift) => gift.imagePath.startsWith('/overtime-gift-images/')), true);
    assert.deepEqual(service.getSnapshot().gifts.map((gift) => gift.id), ['1']);
    assert.equal(service.getSnapshot().gifts[0].imagePath, updates[0].gifts[0].imagePath);
  } finally {
    service?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a newer catalog arriving during an image scan is completed without an extra catalog fetch', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-latest-'));
  let service;
  try {
    let current = catalog('1');
    let release;
    let started;
    const downloadStarted = new Promise((resolve) => { started = resolve; });
    let calls = 0;
    const downloads = [];
    const updates = [];
    const remoteCatalog = {
      getSnapshot: () => current,
      refresh: async () => { calls += 1; return current; },
    };
    service = createService({
      dataDir,
      remoteCatalog,
      onUpdated: (snapshot) => updates.push(snapshot),
      fetchImage: async (url) => {
        downloads.push(url);
        if (downloads.length === 1) {
          started();
          await new Promise((resolve) => { release = resolve; });
        }
        return new Response(webpBytes());
      },
    });
    const pending = service.initializeGlobalCatalog({ force: true });
    await downloadStarted;
    current = catalog('2');
    current.gifts[0].sourceUrl = 'https://i0.hdslb.com/bfs/live/changed.webp';
    assert.equal(service.initializeGlobalCatalog({ refresh: false }), pending);
    release();
    await pending;
    assert.equal(calls, 1);
    assert.equal(downloads.length, 2);
    assert.equal(service.getInitializationState().version, '2');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].version, '2');
  } finally {
    service?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('metadata-only changes stay silent and incremental progress counts only changed artwork', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-incremental-'));
  let service;
  try {
    let current = catalog('1');
    current.gifts.push({ ...current.gifts[0], id: '2' });
    current.gifts.push({ ...current.gifts[0], id: '3', sourceUrl: '', imagePath: '' });
    let imageCalls = 0;
    const states = [];
    const updates = [];
    service = createService({
      dataDir,
      onUpdated: (snapshot) => updates.push(snapshot),
      fetchRemote: async () => current,
      fetchImage: async () => {
        imageCalls += 1;
        return new Response(webpBytes());
      },
    });
    service.onInitializationStateChanged((state) => states.push(state));
    await service.initializeGlobalCatalog({ force: true });
    states.length = 0;
    current.version = '2';
    current.gifts[0].name = 'Renamed gift';
    current.gifts[0].priceRaw = 200;
    await service.initializeGlobalCatalog({ force: true });
    assert.equal(states.some((state) => state.phase === 'images'), false);
    assert.equal(imageCalls, 2);
    assert.equal(updates.at(-1).gifts[0].name, 'Renamed gift');
    assert.equal(updates.at(-1).gifts[0].priceRaw, 200);
    const completion = JSON.parse(fs.readFileSync(
      path.join(dataDir, STATE_FILE_NAME), 'utf8',
    ));
    assert.equal(completion.available, 2);
    assert.equal(completion.failed, 1);

    states.length = 0;
    current.version = '3';
    current.gifts[0].imagePath = 'https://api.example.test/gift-media/images/revised.webp';
    await service.initializeGlobalCatalog({ force: true });
    assert.equal(imageCalls, 3);
    assert.equal(states.filter((state) => state.phase === 'images')
      .every((state) => state.status === 'updating' && state.total === 1), true);
    assert.equal(service.getInitializationState().total, 1);
    assert.equal(service.getInitializationState().failed, 0);
  } finally {
    service?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('stopping suppresses notifications from an in-flight image scan', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-stop-'));
  let service;
  try {
    let release;
    let started;
    const downloadStarted = new Promise((resolve) => { started = resolve; });
    const updates = [];
    service = createService({
      dataDir,
      onUpdated: (snapshot) => updates.push(snapshot),
      fetchRemote: async () => catalog('1'),
      fetchImage: async () => {
        started();
        await new Promise((resolve) => { release = resolve; });
        return new Response(webpBytes());
      },
    });
    const pending = service.initializeGlobalCatalog({ force: true });
    await downloadStarted;
    service.stop();
    release();
    await pending;
    assert.equal(updates.length, 0);
  } finally {
    service?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function createService(options) {
  const room = { source: 'local', version: 'room-1', gifts: [{ id: '1', name: 'Room gift' }] };
  return createHybridGiftSaleCatalogService({
    local: { getSnapshot: () => room, refresh: async () => room },
    imageBaseUrl: 'https://api.example.test',
    logger: LOGGER,
    ...options,
  });
}

function catalog(version) {
  return {
    schemaVersion: 2,
    source: 'server',
    version,
    etag: `"${version}"`,
    updatedAt: '2026-09-05T00:00:00Z',
    blindBoxes: [],
    gifts: [{
      id: '1',
      name: 'Gift',
      coinType: 'gold',
      priceRaw: 100,
      active: true,
      isBlindBox: false,
      sourceUrl: 'https://i0.hdslb.com/bfs/live/one.webp',
      imagePath: 'https://api.example.test/gift-media/images/one.webp',
    }],
  };
}

function nextReady(service) {
  return new Promise((resolve) => {
    const unsubscribe = service.onInitializationStateChanged((state) => {
      if (state.status !== 'ready') return;
      unsubscribe();
      resolve(state);
    });
  });
}

function webpBytes() {
  const bytes = Buffer.alloc(16);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(8, 4);
  bytes.write('WEBP', 8, 'ascii');
  return bytes;
}
