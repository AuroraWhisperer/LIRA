'use strict';

// Run with node_modules/electron/dist/electron.exe scripts/verify-gift-export.cjs.
// Synthetic records only; all saved files and Electron state are isolated.
const { app, BrowserWindow, nativeImage } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createGiftExportController } = require('../src/electron/gift-export-controller');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-export-check-'));
app.setPath('userData', path.join(root, 'user-data'));
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('force-device-scale-factor', process.env.GIFT_TEST_DPI || '1');
const publicDir = path.resolve(__dirname, '../public');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.join(publicDir, pathname === '/gift-export' ? 'pages/overlays/gift-export.html' : pathname);
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const controller = createGiftExportController({
    app: { getPath: () => root }, BrowserWindow,
    dialog: {}, shell: {}, getBaseUrl: () => `http://127.0.0.1:${server.address().port}`,
    getMainWindow: () => null,
    runtime: { getSetting: () => '', getGiftViewRevision: () => 'fixture', prepareGiftExport: (selection) => ({
      viewRevision: 'fixture', config: { thresholds: [10000, 50000, 100000] }, catalog: [],
      items: Array.from({ length: selection.count || 2 }, (_, i) => i + 1).map((id) => ({ eventId: String(id), gift: { userName: '中文测试昵称很长时保持头像和数量完整', giftName: '舰长', giftId: 'guard-3', coinType: 'guard', unitPrice: 1, num: 3000, guardLevel: id % 4, avatarUrl: null } })),
    }) },
  });
  try {
    const task = await controller.prepare({});
    const result = await controller.save({ id: task.id });
    assert.equal(result.ok, true, result.error);
    const file = path.join(result.directory, '礼物_001.png');
    const png = fs.readFileSync(file);
    const width = png.readUInt32BE(16);
    assert.ok(width >= 1008 && width <= 8192);
    assert.equal(png.readUInt32BE(20), 304);
    const pixels = nativeImage.createFromBuffer(png).toBitmap();
    assert.equal(pixels[3], 0, 'transparent corner');
    assert.ok(pixels.some((value, index) => index % 4 === 3 && value > 0), 'nonempty picture');
    assert.ok(pixels.subarray(width * 160 * 4).some((value, index) => index % 4 === 3 && value > 0), 'second row must be captured');
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
    assert.ok(nativeImage.createFromBuffer(tall).toBitmap().subarray(width * 6080 * 4).some((v, i) => i % 4 === 3 && v > 0));
    console.log('PASS: 40 records split into 6224px and 144px images; last row visible');
  } finally { controller.dispose(); server.close(); }
  app.exit(0);
})().catch((error) => { console.error(error); app.exit(1); });
