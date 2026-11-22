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
const publicDir = path.resolve(__dirname, '../public');
const requestedAssets = new Set();
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  requestedAssets.add(pathname);
  if (pathname === '/api/bilibili/avatar') {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" fill="#3264c8"/></svg>',
    );
    return;
  }
  const file = path.join(publicDir, pathname === '/gift-export' ? 'pages/overlays/gift-export.html' : pathname);
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    'Content-Type',
    {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.png': 'image/png',
    }[path.extname(file)] || 'application/octet-stream',
  );
  res.end(fs.readFileSync(file));
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
  const cardRuntime = createGiftExportRuntime({
    getServices: () => ({
      gifts: {
        getSelection: ({ historical, crossDate }) => ({
          viewRevision: 'fixture', items: crossDate ? flowers : historical ? historicalItems : cardItems,
        }),
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
      assert.deepEqual(eventIds, flowers.map(item => item.eventId));
      return { ok: true, groups: [eventIds], partial: false };
    },
  });
  const controller = createGiftExportController({
    app: { getPath: () => root },
    BrowserWindow,
    dialog: {},
    shell: {},
    getBaseUrl: () => baseUrl,
    getMainWindow: () => null,
    runtime: {
      getSetting: () => '',
      getGiftViewRevision: () => 'fixture',
      mergeGiftExport: cardRuntime.mergeGiftExport,
      prepareGiftExport: (selection) =>
        selection.merge || selection.historical || selection.crossDate
          ? cardRuntime.prepareGiftExport(selection)
          : {
              viewRevision: 'fixture',
              config: { thresholds: [10000, 50000, 100000] },
              catalog: [],
              items: Array.from({ length: selection.count || 2 }, (_, i) => i + 1).map((id) => ({
                eventId: String(id),
                gift: {
                  userName: '中文测试昵称很长时保持头像和数量完整',
                  giftName: '舰长',
                  giftId: 'guard-3',
                  coinType: 'guard',
                  unitPrice: 1,
                  num: 3000,
                  guardLevel: [3, 2, 1, 0][(id - 1) % 4],
                  avatarUrl,
                },
              })),
            },
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
    const single = await controller.prepare({});
    await controller.configure({ id: single.id, mode: 'separate', background: 'white' });
    const separate = await controller.save({ id: single.id });
    assert.equal(separate.saved, 2);
    const singlePng = fs.readFileSync(path.join(separate.directory, '礼物_001.png'));
    assert.equal(singlePng.readUInt32BE(20), 144);
    assert.equal(nativeImage.createFromBuffer(singlePng).toBitmap()[3], 255);
    console.log('PASS: combined transparent and separate white PNGs');
    const long = await controller.prepare({ count: 40 });
    assert.equal(long.files.length, 2);
    const longResult = await controller.save({ id: long.id });
    assert.equal(longResult.ok, true, longResult.error);
    assert.equal(longResult.saved, 2);
    const tall = fs.readFileSync(path.join(longResult.directory, '礼物_001.png'));
    assert.equal(tall.readUInt32BE(20), 6224);
    assert.ok(
      nativeImage
        .createFromBuffer(tall)
        .toBitmap()
        .subarray(width * 6080 * 4)
        .some((v, i) => i % 4 === 3 && v > 0),
    );
    console.log('PASS: 40 records split into 6224px and 144px images; last row visible');
    requestedAssets.clear();
    const merged = await controller.prepare({ merge: true });
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
