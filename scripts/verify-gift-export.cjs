'use strict';

// Run with node_modules/electron/dist/electron.exe scripts/verify-gift-export.cjs.
// Synthetic records only; all saved files and Electron state are isolated.
const { app, BrowserWindow, nativeImage } = require('electron');
// A closed command session must stop the check without Electron's error dialog.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error.code === 'EPIPE') app.exit(1);
    else throw error;
  });
}
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { servePageOrAsset } = require('../src/server/page-assets');
const { createGiftExportController } = require('../src/electron/gift-export-controller');
const { createGiftExportRuntime } = require('../src/server/gift-export-runtime');
const scratch = path.resolve(__dirname, '../tmp');
fs.mkdirSync(scratch, { recursive: true });
const root = fs.mkdtempSync(path.join(scratch, 'lira-gift-export-check-'));
const profilePath = path.join(root, 'user-data');
const crashPath = path.join(profilePath, 'crash-dumps');
fs.mkdirSync(crashPath, { recursive: true });
app.setPath('userData', profilePath);
app.setPath('sessionData', profilePath);
app.setPath('crashDumps', crashPath);
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('force-device-scale-factor', process.env.GIFT_TEST_DPI || '1');
app.commandLine.appendSwitch('force-max-texture-size', '4096');
const publicDir = path.resolve(__dirname, '../public');
const requestedAssets = new Set();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  requestedAssets.add(pathname);
  if (pathname === '/api/bilibili/avatar') {
    const row = /\/row-(\d+)\.webp$/.exec(url.searchParams.get('url'));
    const color = row ? `rgb(${Number(row[1])},100,200)` : '#3264c8';
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" fill="${color}"/></svg>`);
    return;
  }
  return servePageOrAsset(publicDir, req, res, url, 'synthetic-export-session');
});

(async () => {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const pageResponse = await fetch(`${baseUrl}/gift-export`);
  assert.equal(pageResponse.status, 200);
  await pageResponse.body.cancel();
  const avatarUrl = 'https://i0.hdslb.com/bfs/face/synthetic.webp';
  const cardItems = [2, 3].map((num, index) => ({
    eventId: `merged-${index}`,
    gift: {
      userName: '旧昵称',
      giftName: '合并测试礼物',
      giftId: 'fixture-gift',
      num,
      unitPrice: index ? 40 : 10,
      guardLevel: 3,
      createdAt: '2026-09-19T01:00:00Z',
    },
  }));
  const historicalItems = cardItems.map((item, index) => ({
    eventId: index === 0 ? 'historical-guard' : 'historical-ticket',
    gift: {
      ...item.gift,
      giftId: index === 0 ? 'guard-3' : 'popularity-ticket',
      giftName: index === 0 ? '舰长' : '人气票',
      avatarUrl: index === 0 ? null : avatarUrl,
      createdAt: '2026-09-18T01:00:00Z',
    },
  }));
  const flowers = [17, 18, 19].map(day => ({
    eventId: `flower-${day}`,
    gift: { userName: '观众A', giftId: 'flower', giftName: '小花花', num: 100, unitPrice: 0.1, avatarUrl,
      createdAt: `2026-09-${day}T12:00:00Z` },
  }));
  // The last 13 records repeat senders from the first 39.
  const batchItems = Array.from({ length: 52 }, (_, index) => {
    const sender = index % 39 + 1;
    return {
      eventId: `batch-${index + 1}`,
      gift: {
        userName: `测试观众${sender}`, giftName: '舰长', giftId: 'guard-3', coinType: 'guard',
        num: 1, unitPrice: 1, guardLevel: [3, 2, 1, 0][(sender - 1) % 4],
        avatarUrl: `https://i0.hdslb.com/bfs/face/row-${sender}.webp`,
      },
    };
  });
  const cardRuntime = createGiftExportRuntime({
    getServices: () => ({
      gifts: {
        getSelection: ({ historical, crossDate, count }) => {
          const items = historical ? historicalItems : crossDate ? flowers : cardItems;
          return { viewRevision: 'fixture', items: count ? batchItems.slice(0, count) : items };
        },
        getViewRevision: () => 'fixture',
      },
      overtimeGiftCatalog: { getGlobalSnapshot: () => ({ gifts: [] }) },
    }),
    getSettingsStore: () => ({ getSettings: () => ({}) }),
    giftCards: {
      getProfiles: async () => ({
        day: '2026-09-19',
        partial: false,
        items: cardItems.map((item) => ({
          eventId: item.eventId,
          senderId: '123',
          userName: '新昵称',
          avatarUrl,
          guardLevel: 1,
          createdAt: item.gift.createdAt,
        })),
      }),
    },
  });
  cardRuntime.configureGiftSync({
    cardAvatars: async ({ eventIds }) => {
      assert.deepEqual(eventIds, ['historical-guard']);
      return { ok: true, items: [{ eventId: 'historical-guard', avatarUrl }] };
    },
    cardGroups: async ({ eventIds }) => {
      if (eventIds[0] === batchItems[0].eventId) {
        return { ok: true, partial: false, groups: batchItems.slice(39).map((item, i) => [batchItems[i].eventId, item.eventId]) };
      }
      assert.deepEqual(eventIds, flowers.map(item => item.eventId));
      return { ok: true, groups: [eventIds], partial: false };
    },
  });
  const controller = createGiftExportController({
    app: { getPath: () => root },
    BrowserWindow,
    nativeImage,
    dialog: {},
    shell: {},
    getBaseUrl: () => baseUrl,
    getMainWindow: () => null,
    runtime: {
      getSetting: () => '',
      getGiftViewRevision: () => 'fixture',
      mergeGiftExport: cardRuntime.mergeGiftExport,
      prepareGiftExport: cardRuntime.prepareGiftExport,
    },
  });
  try {
    const task = await controller.prepare({ historical: true });
    const result = await controller.save({ id: task.id });
    assert.equal(result.ok, true, result.error);
    const file = path.join(result.directory, '礼物_001.png');
    const png = fs.readFileSync(file);
    const width = png.readUInt32BE(16);
    assert.ok(width >= 856 && width <= 8192);
    assert.equal(png.readUInt32BE(20), 304);
    const pixels = nativeImage.createFromBuffer(png).toBitmap();
    assert.equal(pixels[3], 0, 'transparent corner');
    assert.ok(requestedAssets.has('/api/bilibili/avatar'), 'avatar uses the local proxy');
    assert.ok(requestedAssets.has('/img/overlays/danmaku-guard/bubble-captain-frame.webp'), 'captain frame is loaded');
    for (const y of [72, 232]) {
      const avatarPixel = (y * width + 72) * 4;
      assert.deepEqual([...pixels.subarray(avatarPixel, avatarPixel + 4)], [200, 100, 50, 255]);
    }
    console.log('PASS: the historical guard and popularity ticket show the same sender avatar');
    assert.ok(
      pixels.some((value, index) => index % 4 === 3 && value > 0),
      'nonempty picture',
    );
    assert.ok(
      pixels.subarray(width * 160 * 4).some((value, index) => index % 4 === 3 && value > 0),
      'second row must be captured',
    );
    console.log(JSON.stringify({ ok: true, width, height: 304, dpi: process.env.GIFT_TEST_DPI || '1', preview: file }));
    const tierPixel = (bitmap, stride, y) => bitmap.subarray((y * stride + 200) * 4, (y * stride + 200) * 4 + 4);
    const isWarmTier = (pixel) => pixel[2] > pixel[0]; // Electron bitmap is BGRA.
    assert.equal(isWarmTier(tierPixel(pixels, width, 128)), false);
    assert.equal(isWarmTier(tierPixel(pixels, width, 288)), true);
    for (const rowGap of [0, 32]) {
      const next = await controller.configure({ id: task.id, mode: 'combined', background: 'transparent', sortBy: 'amount', rowGap });
      const saved = await controller.save({ id: task.id });
      assert.equal(saved.ok, true, saved.error);
      const bytes = fs.readFileSync(path.join(saved.directory, next.files[0].fileName));
      assert.equal(bytes.readUInt32BE(20), 288 + rowGap);
      const stride = bytes.readUInt32BE(16);
      const bitmap = nativeImage.createFromBuffer(bytes).toBitmap();
      assert.equal(isWarmTier(tierPixel(bitmap, stride, 128)), true);
      assert.equal(tierPixel(bitmap, stride, 144 + rowGap + 7)[3], 0);
      assert.ok(tierPixel(bitmap, stride, 144 + rowGap + 8)[3] > 0);
      assert.equal(isWarmTier(tierPixel(bitmap, stride, 144 + rowGap + 128)), false);
    }
    console.log('PASS: amount order and both spacing endpoints match the captured PNG pixels');
    const single = await controller.prepare({ merge: true });
    await controller.configure({ id: single.id, mode: 'separate', background: 'white' });
    const separate = await controller.save({ id: single.id });
    assert.equal(separate.saved, 2);
    const singlePng = fs.readFileSync(path.join(separate.directory, '礼物_001.png'));
    assert.equal(singlePng.readUInt32BE(20), 144);
    assert.equal(nativeImage.createFromBuffer(singlePng).toBitmap()[3], 255);
    console.log('PASS: combined transparent and separate white PNGs');
    for (const [count, cards, rowGap, expectedPages, mode = 'combined'] of [
      [30, 30, 16, 1], [52, 39, 16, 1], [50, 50, 32, 1], [51, 51, 0, 2], [30, 30, 16, 30, 'separate'],
    ]) {
      const { id } = await controller.prepare({ count });
      const long = await controller.configure({ id, mode, background: 'transparent', rowGap, mergeAcrossDates: cards < count });
      const result = await controller.save({ id, roomGuard: { roomId: '123', count: 1001 } });
      assert.equal(result.ok, true, result.error);
      assert.equal(long.snapshot.items.length, cards);
      assert.equal(result.saved, expectedPages);
      for (const file of long.files) {
        const png = fs.readFileSync(path.join(result.directory, file.fileName));
        const stride = png.readUInt32BE(16);
        assert.equal(stride, 856);
        assert.equal(png.readUInt32BE(20), file.count * 144 + (file.count - 1) * rowGap);
        assert.ok(png.readUInt32BE(20) <= 8768);
        const pixels = nativeImage.createFromBuffer(png).toBitmap();
        for (let row = 0; row < file.count; row++) {
          const offset = ((row * (144 + rowGap) + 72) * stride + 72) * 4;
          assert.deepEqual([...pixels.subarray(offset, offset + 4)], [200, 100, (file.start + row) % 39 + 1, 255], `card ${file.start + row + 1}`);
        }
      }
      console.log(`PASS: ${count} records, all ${cards} cards at ${rowGap}px spacing across ${result.saved} PNG(s) with a 4096px texture limit`);
    }
    assert.ok(requestedAssets.has('/img/admin/gifts/bilibili-guard-captain-thousand.webp'));
    assert.ok(requestedAssets.has('/img/overlays/danmaku-harbor/captain-frame.png'));
    requestedAssets.clear();
    const original = await controller.prepare({ merge: true });
    assert.deepEqual(original.snapshot.items.map(item => item.gift.num), [2, 3]);
    const merged = await controller.configure({ id: original.id, mode: original.mode, background: original.background, mergeAcrossDates: true });
    assert.equal(merged.snapshot.selectedCount, 2);
    assert.equal(merged.snapshot.items.length, 1);
    assert.equal(merged.snapshot.items[0].gift.num, 5);
    assert.equal(merged.snapshot.items[0].gift.userName, '新昵称');
    assert.equal(merged.snapshot.items[0].cardTotalCents, '14000');
    const mergedResult = await controller.save({ id: merged.id });
    assert.equal(mergedResult.ok, true, mergedResult.error);
    const mergedPath = path.join(mergedResult.directory, '礼物_001.png');
    const mergedPng = fs.readFileSync(mergedPath);
    assert.equal(mergedPng.readUInt32BE(20), 144, 'two original rows export as one card');
    assert.ok(requestedAssets.has('/img/overlays/danmaku-guard/bubble-governor-frame.webp'));
    const colorOffset = (128 * mergedPng.readUInt32BE(16) + 200) * 4;
    const color = nativeImage
      .createFromBuffer(mergedPng)
      .toBitmap()
      .subarray(colorOffset, colorOffset + 4);
    assert.ok(
      color[3] > 0 && color[2] > color[0] && color[2] > color[1] * 2,
      'pink tier uses the combined 140 yuan, not the first price times five',
    );
    console.log(JSON.stringify({ ok: true, mergedPreview: mergedPath }));
    const threeDays = await controller.prepare({ crossDate: true });
    assert.equal(threeDays.snapshot.items.length, 3);
    const together = await controller.configure({ id: threeDays.id, mode: 'separate', background: 'white', mergeAcrossDates: true });
    assert.equal(together.snapshot.selectedCount, 3);
    assert.equal(together.snapshot.items[0].gift.num, 300);
    assert.equal(together.snapshot.items[0].cardTotalCents, '3000');
    const saved = await controller.save({ id: together.id });
    assert.equal(saved.ok, true, saved.error);
    assert.equal(saved.saved, 1);
    const flowerPng = path.join(saved.directory, together.files[0].fileName);
    assert.equal(fs.readFileSync(flowerPng).readUInt32BE(20), 144);
    console.log(JSON.stringify({ ok: true, crossDateFlowers: flowerPng }));
  } finally {
    controller.dispose();
    server.close();
  }
  app.exit(0);
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
