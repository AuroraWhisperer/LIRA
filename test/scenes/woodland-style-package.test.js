'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createWoodlandGiftEntries, createWoodlandGiftZip } = require('../../scripts/package-woodland-gift-frame');
const { WOODLAND_GIFT_VIDEO } = require('../../public/js/shared/component-resource-style.js');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { createScratchDirectory } = require('../helpers/scratch-directory');

test('woodland 1.0.0 imports the original native artwork and preserves legacy media after removal', async t => {
  const dataDir = createScratchDirectory('woodland-style-', t);
  const server = await startComponentPreviewServer({ dataDir }); t.after(server.close);
  async function request(action, body) {
    const response = await fetch(`${server.origin}/api/component-styles/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${server.token}`,
        'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' },
      body: Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const result = await response.json(); assert.equal(response.status, 200, result.error); return result.data;
  }
  const entries = createWoodlandGiftEntries();
  const manifest = JSON.parse(entries.get('lira-pack.json'));
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.id, 'lira.woodland-gift-frame');
  assert.equal(manifest.styles.length, 1);
  assert.deepEqual([manifest.styles[0].width, manifest.styles[0].height], [1920, 1080]);
  assert.deepEqual(manifest.styles[0].config, {});
  assert.deepEqual(Object.keys(manifest.styles[0].resources), [WOODLAND_GIFT_VIDEO]);
  assert.deepEqual([...entries.keys()].sort(), ['assets/preview.webp', 'assets/woodland-bloom-v4.webm', 'lira-pack.json', '使用说明.txt'].sort());
  const original = fs.readFileSync(path.resolve('public', `.${WOODLAND_GIFT_VIDEO}`));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(entries.get('assets/woodland-bloom-v4.webm')), digest(original));
  const legacy = `${server.origin}${WOODLAND_GIFT_VIDEO}`;
  assert.equal((await fetch(legacy)).status, 404, 'Source checkout artwork must not mask a missing import.');
  const archive = createWoodlandGiftZip();
  const preview = await request('inspect?target=gift-frame', archive);
  assert.equal(preview.isSuite, false);
  assert.equal((await fetch(legacy)).status, 404, 'Inspect alone must not make staged resources available.');
  const installed = await request('install', { id: preview.id, target: 'gift-frame' });
  const style = installed.styles[0];
  assert.equal(style.type, 'gift-frame');
  assert.deepEqual(normalizeSceneConfig(style.type, style.config), style.config);
  assert.deepEqual(Object.keys(style.config), ['resourceStyle']);
  const source = style.config.resourceStyle.resources[WOODLAND_GIFT_VIDEO];
  assert.ok(source.endsWith(`/${digest(original)}.webm`));
  const redirect = await fetch(legacy, { redirect: 'manual' });
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get('location'), source);
  assert.equal(redirect.headers.get('cache-control'), 'no-store');
  const ranged = await fetch(legacy, { headers: { Range: 'bytes=4-31' } });
  assert.equal(ranged.status, 206);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), original.subarray(4, 32));
  const head = await fetch(legacy, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), original.length);
  assert.equal((await fetch(legacy, { method: 'POST' })).status, 405);
  const again = await request('inspect?target=gift-frame', archive);
  assert.equal((await request('install', { id: again.id, target: 'gift-frame' })).alreadyInstalled, true);
  await request('remove', { id: style.id });
  assert.equal((await fetch(legacy, { method: 'HEAD' })).status, 200, 'Existing legacy scenes retain the imported artwork.');
  assert.equal((await fetch(`${server.origin}${source}`, { method: 'HEAD' })).status, 200);
});
