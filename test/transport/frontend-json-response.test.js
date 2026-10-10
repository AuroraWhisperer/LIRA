'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const modulePath = (file) => path.resolve(__dirname, '../../public/js', file);

test('local JSON errors retain HTTP status, business code and domain payload', async () => {
  const { readApiResponse, readJsonResponse } = await loadModuleExports(modulePath('shared/json-response.js'));
  const payload = { ok: false, error: 'Conflict', code: 'CONFLICT', importTarget: 'canvas' };
  await assert.rejects(readApiResponse(new Response(JSON.stringify(payload), { status: 409 }), 'Failed'), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'CONFLICT');
    assert.equal(JSON.stringify(error.payload), JSON.stringify(payload));
    return true;
  });
  await assert.rejects(readApiResponse(new Response('{"ok":true}', { status: 503 }), 'Failed'), { status: 503 });
  await assert.rejects(readApiResponse(new Response('null'), 'Failed'), { message: 'Failed' });
  await assert.rejects(readJsonResponse(new Response('<html>unavailable</html>', { status: 502 }), 'Failed'), {
    status: 502, code: 'INVALID_RESPONSE',
  });
  await assert.rejects(readJsonResponse(new Response('', { status: 401 }), 'Failed'), { status: 401 });
  assert.equal(JSON.stringify(await readJsonResponse(new Response(''), 'Failed')), '{}');
});

test('local API callers keep their request options and emit one request per operation', async () => {
  const requests = [];
  const events = [];
  const access = { id: 'scene', attachmentId: 'panel', token: 'synthetic' };
  let response = () => new Response('{"ok":true,"data":{"saved":true}}');
  const globals = {
    URL, FormData, File, Event, AbortController, setTimeout, clearTimeout,
    location: { origin: 'http://127.0.0.1:3000' },
    window: { __API_TOKEN__: 'desktop', dispatchEvent: (event) => events.push(event.type) },
    fetch: async (url, options) => { requests.push({ url: String(url), options }); return response(); },
  };
  const { api } = await loadModuleExports(modulePath('shared/utils.js'), globals);
  const { requestScene } = await loadModuleExports(modulePath('admin/scene-api.js'), globals);
  const { requestGiftWish } = await loadModuleExports(modulePath('shared/gift-wish-client.js'), globals);
  const { requestComponentStyles } = await loadModuleExports(modulePath('admin/component-style-api.js'), globals);
  const { requestOpeningSettings } = await loadModuleExports(modulePath('admin/opening-settings-api.js'), globals);
  await api('/api/settings', { paused: true }, { notifyError: false });
  await requestScene('list');
  await requestGiftWish('/api/gifts/wishes');
  await requestComponentStyles('config', { id: 'style', patch: {} }, access);
  const file = new File(['image'], 'image.png');
  await requestOpeningSettings('image', { file }, access);
  assert.equal(requests.length, 5);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer desktop');
  assert.equal(requests[1].options.cache, 'no-store');
  assert.equal(requests[2].options.signal.aborted, false);
  assert.equal(requests[3].options.credentials, 'omit');
  assert.equal(requests[4].options.headers.Authorization, 'Bearer synthetic');
  assert.equal(requests[4].options.body.get('file').name, 'image.png');
  assert.deepEqual(events, ['component-styles:changed']);
  response = () => new Response('zip', { headers: { 'Content-Type': 'application/zip' } });
  assert.equal(await (await requestComponentStyles('backup')).text(), 'zip');
  response = () => new Response(JSON.stringify({ ok: false, code: 'TARGET_MISMATCH', importTarget: 'canvas', importTargetName: '画布' }), { status: 409 });
  await assert.rejects(requestComponentStyles('install', { id: 'style' }), {
    status: 409, code: 'TARGET_MISMATCH', importTarget: 'canvas', importTargetName: '画布',
  });
  assert.deepEqual(events, ['component-styles:changed']);
});
