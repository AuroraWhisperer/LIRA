'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { servePageOrAsset } = require('../../src/server/http-utils');
const { createRuntimeTransport } = require('../../src/server/runtime-transport');

const publicDir = path.resolve(__dirname, '../../public');
const token = 'synthetic-client-theme-token';

function request(pathname, { theme = () => 'classic', authorized = true, transport } = {}) {
  return new Promise(resolve => {
    const req = { method: 'GET', headers: authorized ? { authorization: `Bearer ${token}` } : {} };
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
      writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
      end(body) { resolve({ status: this.status, headers: this.headers, body: String(body || '') }); } };
    const url = new URL(pathname, 'http://127.0.0.1:3000');
    if (transport) transport.servePageOrAsset(req, res, url);
    else servePageOrAsset(publicDir, req, res, url, token, undefined, theme);
  });
}

test('only approved HTML receives a validated snapshot before CSS without weakening authorization', async () => {
  for (const route of ['/admin', '/settings', '/songs', '/', '/c', '/component-preview?component=clock', '/pages/component-preview.html?component=clock', '/pages/gift-audit.html']) {
    const result = await request(route);
    assert.equal(result.status, 200, route);
    assert.match(result.body, /<html[^>]*data-client-theme="classic"/);
    assert.ok(result.body.indexOf('data-client-theme="classic"') < result.body.indexOf('<link'), route);
    assert.equal(result.headers['Cache-Control'], 'no-store');
  }
  for (const route of ['/license', '/scene', '/clock', '/pages/license.html', '/pages/overlays/scene.html']) {
    const result = await request(route);
    assert.equal(result.status, 200, route);
    assert.doesNotMatch(result.body, /data-client-theme=/, route);
  }
  for (const route of ['/admin', '/pages/gift-audit.html']) {
    const result = await request(route, { authorized: false });
    assert.equal(result.status, 401);
    assert.doesNotMatch(result.body, /data-client-theme=/);
  }
});

test('each HTML request reads current committed theme, including cached admin composition', async () => {
  let theme = 'classic';
  const transport = createRuntimeTransport({ publicDir, getSessionToken: () => token, getClientTheme: () => theme });
  const first = await request('/admin', { transport });
  theme = 'terracotta';
  const second = await request('/admin', { transport });
  assert.match(first.body, /data-client-theme="classic"/);
  assert.match(second.body, /data-client-theme="terracotta"/);
  assert.match((await request('/component-preview?component=clock', { transport })).body, /data-client-theme="terracotta"/);
  assert.match((await request('/pages/gift-audit.html', { transport })).body, /data-client-theme="terracotta"/);
  for (const invalid of ['future', 'neutral" style="color:red', {}, undefined]) {
    assert.match((await request('/admin', { theme: () => invalid })).body, /data-client-theme="terracotta"/);
  }
  const standalone = createRuntimeTransport({ publicDir, getSessionToken: () => token });
  assert.match((await request('/admin', { transport: standalone })).body, /data-client-theme="terracotta"/);
});
