'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');
const { createComponentStyleLibrary } = require('../../src/server/component-style-library');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { COMPONENT_RESOURCE_PRESETS } = require('../../public/js/shared/component-resource-style.js');

async function fixture(t) {
  const dataDir = createScratchDirectory('resource-style-settings-', t);
  const store = createComponentStyleStore(dataDir);
  const packId = randomUUID();
  const preset = COMPONENT_RESOURCE_PRESETS['moonlit-wishes'];
  const source = `/component-media/${packId}/${'a'.repeat(64)}`;
  const resourceStyle = { id: randomUUID(), preset: 'moonlit-wishes', preview: `${source}.webp`, width: 640, height: 143,
    resources: Object.fromEntries(preset.resources.map(key => [key, `${source}${key.slice(key.lastIndexOf('.'))}`])) };
  const style = { id: resourceStyle.id, type: 'gift-wishes', name: '配套许愿',
    config: normalizeSceneConfig('gift-wishes', { ...preset.config, resourceStyle }) };
  store.stage({ id: packId, styles: [style] });
  store.install(packId);
  const server = await startComponentPreviewServer({ dataDir });
  t.after(server.close);
  async function save(patch, token = server.token) {
    const response = await fetch(`${server.origin}/api/component-styles/config`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: style.id, patch }) });
    return { status: response.status, ...await response.json() };
  }
  return { dataDir, store, packId, style, save, server };
}

test('resource settings persist defaults across restart without changing resources or existing scene snapshots', async t => {
  const f = await fixture(t);
  const result = await f.save({ limit: 4, gap: 20 });
  assert.equal(result.status, 200, result.error);
  assert.equal(result.data.config.limit, 4);
  assert.deepEqual(result.data.config.resourceStyle, f.style.config.resourceStyle);
  assert.equal(f.style.config.limit, 1);
  const reopened = createComponentStyleLibrary(f.dataDir).list()[0].styles[0];
  assert.equal(reopened.config.limit, 4);
  assert.equal(reopened.config.gap, 20);
  assert.equal(reopened.config.displayStyle, 'moonlit');
});

test('resource settings reject invalid fields, resource replacement and unauthorized writes without changing saved state', async t => {
  const f = await fixture(t);
  for (const patch of [null, [], { limit: 0 }, { limit: 1.5 }, { unknown: 1 }, { resourceStyle: null },
    { mediaStyle: {} }, { cssStyle: {} }, { displayStyle: 'card' }]) {
    assert.equal((await f.save(patch)).status, 400, JSON.stringify(patch));
  }
  assert.equal((await f.save({ limit: 2 }, 'invalid')).status, 401);
  assert.deepEqual(f.store.list()[0].styles[0].config, f.style.config);
});

test('removed styles cannot be updated and removal preserves saved defaults', async t => {
  const f = await fixture(t);
  await f.save({ limit: 3 });
  f.store.remove(f.style.id);
  assert.equal((await f.save({ limit: 4 })).status, 404);
  assert.equal(f.store.read().packages[0].styles[0].config.limit, 3);
});

test('resource settings writes require a current canvas attachment and same origin', async t => {
  const { server, style, store } = await fixture(t);
  const state = { draft: { document: {} }, saved: { document: {} }, loaded: true, generation: 0 };
  const { data: session } = await server.post({ action: 'open', component: 'canvas', state });
  const attachmentId = randomUUID();
  await server.post({ action: 'attach', id: session.id, attachmentId, previousAttachmentId: null }, session.token);
  const url = `${server.origin}/api/component-preview/styles/config?id=${session.id}&attachmentId=${attachmentId}`;
  const save = (headers = {}) => fetch(url, { method: 'POST', headers: {
    Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json', ...headers,
  }, body: JSON.stringify({ id: style.id, patch: { limit: 4 } }) });
  assert.equal((await save({ Origin: 'https://untrusted.test' })).status, 403);
  assert.equal(store.list()[0].styles[0].config.limit, 1);
  assert.equal((await save()).status, 200);
  assert.equal(store.list()[0].styles[0].config.limit, 4);
  await server.post({ action: 'open', component: 'canvas', state });
  assert.equal((await save()).status, 410);
});
