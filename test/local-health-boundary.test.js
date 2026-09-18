'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const http = require('node:http');
const test = require('node:test');
const { createHttpServer } = require('../src/server/http-server');
const { createInstanceProof, CHALLENGE_HEADER, requestVerifiedShutdown } = require('../src/server/local-instance');

test('health minimizes anonymous data and checks Host in every lifecycle phase', async (t) => {
  const token = 'synthetic-health-key';
  const challenge = 'a'.repeat(64);
  let phase = 'starting';
  let detailReads = 0;
  let shutdowns = 0;
  const server = createHttpServer({
    host: '127.0.0.1', startPort: 0,
    rootDir: 'private-root', dataDir: 'private-data',
    getPhase: () => phase, getStartedPort: () => server.address().port,
    isLicenseAuthorized: () => true,
    inflightTracker: { run: (callback) => callback() },
    createApiContext: () => ({
      sessionToken: token,
      system: {
        getHealth: () => {
          detailReads += 1;
          return { serviceId: 'lira', rootDir: 'private-root', dataDir: 'private-data', pid: 424242, schemaVersions: { song: 3 } };
        },
        shutdown: () => { shutdowns += 1; },
      },
    }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const port = server.address().port;
  const get = (headers = {}) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
  });
  for (const state of ['starting', 'ready', 'quiescing']) {
    phase = state;
    assert.equal((await get({ Host: 'foreign.invalid' })).status, 400);
    const result = await get();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, { serviceId: 'lira', phase: state });
    assert.equal(detailReads, 0, 'anonymous health must not access private details or databases');
    const invalid = await get({ Authorization: 'Bearer wrong' });
    assert.deepEqual(invalid.body.data, result.body.data);
  }
  phase = 'ready';
  const detailed = await get({ Authorization: `Bearer ${token}` });
  assert.equal(detailed.body.data.dataDir, 'private-data');
  assert.deepEqual(detailed.body.data.schemaVersions, { song: 3 });
  const proved = await get({ [CHALLENGE_HEADER]: challenge });
  assert.deepEqual(proved.body.data, {
    serviceId: 'lira', phase: 'ready',
    instanceProof: createInstanceProof(token, challenge, port),
  });
  assert.equal((await get({ [CHALLENGE_HEADER]: 'bad-challenge' })).body.data.instanceProof, undefined);

  // Exercise the actual health -> API auth -> confirmed shutdown route together.
  t.mock.method(childProcess, 'execFileSync', () => 'null');
  const attempt = await requestVerifiedShutdown({ port, token, rootDir: 'unrelated-root' });
  assert.equal(attempt.verified, true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(shutdowns, 1);
});
