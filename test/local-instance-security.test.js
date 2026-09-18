'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const lifecycle = require('../src/server/lifecycle');
const { CHALLENGE_HEADER, createInstanceProof, requestVerifiedShutdown } = require('../src/server/local-instance');
const { isOwnProcess, readPortOwner } = require('../src/server/local-process-owner');

const TOKEN = 'synthetic-local-instance-token';
const ROOT = 'C:\\Apps\\Lira';
const OWNER = { ProcessId: 12345, CreationDate: '/Date(1000)/', ExecutablePath: 'C:\\Runtime\\node.exe', CommandLine: 'node.exe C:\\Apps\\Lira\\src\\server.js' };

async function peer(t, options = {}) {
  const requests = [];
  const phases = [];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-instance-test-'));
  if (options.token !== false) lifecycle.writeSessionToken(dataDir, TOKEN);
  let released = false;
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url, authorization: req.headers.authorization, socket: req.socket });
    req.resume();
    if (req.url === '/api/system/shutdown') {
      released = true;
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (options.drip) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const timer = setInterval(() => res.write(' '), 20);
      res.once('close', () => clearInterval(timer));
      return;
    }
    const proof = createInstanceProof(TOKEN, req.headers[CHALLENGE_HEADER], server.address().port);
    const data = { serviceId: 'lira', phase: 'ready', pid: 424242, dataDir: options.advertisedDataDir || dataDir };
    if (options.proof !== false) data.instanceProof = options.proof ? options.proof(proof, req) : proof;
    if (options.closeAfterProof) res.setHeader('Connection', 'close');
    res.statusCode = options.status || 200;
    res.end(options.body || JSON.stringify({ ok: true, data }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(fs.realpathSync(dataDir)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  t.mock.method(childProcess, 'execFileSync', () => options.owner ? JSON.stringify(options.owner()) : 'null');
  const signals = [];
  t.mock.method(process, 'kill', (pid, signal) => { signals.push({ pid, signal }); return true; });
  const port = server.address().port;
  return {
    port, server, dataDir, requests, phases, signals,
    cleanup: (extra = {}) => lifecycle.cleanupOwnPortOccupant({
      rootDir: ROOT, dataDir, host: '127.0.0.1', port,
      cleanupTimeoutMs: 5, cleanupPollMs: 1,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      canConnectToPort: async () => !released,
      onPhase: (phase, durationMs, extra) => phases.push({ phase, durationMs, extra }),
      ...extra,
    }),
  };
}

test('forged health without OS ownership cannot receive a token or choose a termination PID', async (t) => {
  const f = await peer(t, { proof: false });
  await f.cleanup({ cleanupTimeoutMs: 0, canConnectToPort: async () => true });
  assert.deepEqual(f.requests.map((r) => r.path), ['/api/health']);
  assert.ok(f.requests.every((r) => r.authorization === undefined));
  assert.deepEqual(f.signals, []);
});

test('a valid challenge allows shutdown only on the same TCP connection', async (t) => {
  const f = await peer(t);
  await f.cleanup();
  assert.deepEqual(f.requests.map((r) => r.path), ['/api/health', '/api/system/shutdown']);
  assert.equal(f.requests[0].authorization, undefined);
  assert.equal(f.requests[1].authorization, `Bearer ${TOKEN}`);
  assert.equal(f.requests[0].socket, f.requests[1].socket);
  assert.deepEqual(f.signals, []);
  assert.ok(f.phases.some((p) => p.phase === 'port-graceful-wait'));
  assert.ok(f.phases.every((p) => Number.isFinite(p.durationMs) && p.durationMs >= 0));
  assert.doesNotMatch(JSON.stringify(f.phases), /synthetic-local-instance-token/);
});

for (const [name, options] of [
  ['invalid proof', { proof: () => '0'.repeat(64) }],
  ['proof for another port', { proof: (_proof, req) => createInstanceProof(TOKEN, req.headers[CHALLENGE_HEADER], req.socket.localPort === 65535 ? 1 : req.socket.localPort + 1) }],
  ['proof for another challenge', { proof: (_proof, req) => createInstanceProof(TOKEN, '0'.repeat(64), req.socket.localPort) }],
  ['closed verified connection', { closeAfterProof: true }],
  ['redirect', { status: 302 }],
  ['oversized health', { body: 'x'.repeat(20000) }],
  ['trickling health beyond the total deadline', { drip: true }],
]) {
  test(`${name} cannot receive credentials`, async (t) => {
    const f = await peer(t, options);
    await requestVerifiedShutdown({ port: f.port, token: TOKEN, rootDir: ROOT });
    assert.ok(f.requests.every((r) => r.authorization === undefined));
    assert.equal(f.requests.length, 1);
  });
}

test('Windows verifies legacy peers by the connected endpoint, not health paths', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await peer(t, { proof: false, advertisedDataDir: 'C:\\OtherData', owner: () => OWNER });
  await f.cleanup();
  assert.equal(f.requests[1].authorization, `Bearer ${TOKEN}`);
  assert.equal(f.requests[0].socket, f.requests[1].socket);
  assert.deepEqual(f.signals, []);
});

test('verified legacy peers without a token file still receive a graceful request', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await peer(t, { proof: false, token: false, owner: () => OWNER });
  await f.cleanup();
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every((r) => r.authorization === undefined));
});

for (const [name, finalOwner, shouldStop] of [
  ['same owned process', OWNER, true],
  ['PID changed', { ...OWNER, ProcessId: 23456 }, false],
  ['PID reused', { ...OWNER, CreationDate: '/Date(2000)/' }, false],
  ['entry changed', { ...OWNER, CommandLine: 'node.exe C:\\Other\\src\\server.js' }, false],
  ['lookup unavailable', null, false],
]) {
  test(`forced cleanup rechecks the OS listener: ${name}`, { skip: process.platform !== 'win32' }, async (t) => {
    let reads = 0;
    const f = await peer(t, { owner: () => ++reads === 1 ? OWNER : finalOwner });
    await f.cleanup({ cleanupTimeoutMs: 0, canConnectToPort: async () => true });
    assert.deepEqual(f.signals, shouldStop ? [{ pid: OWNER.ProcessId, signal: 'SIGTERM' }] : []);
    assert.equal(reads, 2);
  });
}

test('a stale runtime record on another port does not redirect cleanup or get removed', async (t) => {
  const f = await peer(t);
  const record = { pid: 23456, port: f.port === 65535 ? 1 : f.port + 1, host: 'localhost' };
  lifecycle.writeRuntimeInfo(f.dataDir, record);
  await f.cleanup();
  assert.deepEqual(lifecycle.readRuntimeInfo(f.dataDir), record);
  assert.equal(f.requests.length, 2);
});

test('process entry recognition retains exact install and runtime boundaries', { skip: process.platform !== 'win32' }, () => {
  for (const [exe, command, root, expected] of [
    ['C:\\Apps\\Lira\\LIRA.exe', '', ROOT + '\\resources\\app.asar', true],
    ['c:\\apps\\lira\\lira.EXE', '', ROOT + '\\resources\\app.asar', true],
    ['C:\\Other\\LIRA.exe', '', ROOT + '\\resources\\app.asar', false],
    ['C:\\Apps\\Lira\\Other.exe', '', ROOT + '\\resources\\app.asar', false],
    ['C:\\Runtime\\node.exe', 'node.exe C:\\OtherProject\\src\\server.js', ROOT, false],
    ['C:\\Runtime\\node.exe', 'node.exe src/server.js', ROOT, false],
    ['C:\\Runtime\\node.exe', 'node.exe C:\\Apps\\Lira-other\\src\\server.js', ROOT, false],
    ['C:\\Runtime\\node.exe', 'node.exe C:\\Apps\\Lira\\src\\server.js.old', ROOT, false],
    ['C:\\Runtime\\node.exe', 'node.exe C:\\Other\\main.js --data-dir C:\\Apps\\Lira', ROOT, false],
    ['C:\\Runtime\\powershell.exe', 'powershell.exe C:\\Apps\\Lira\\src\\server.js', ROOT, false],
    ['C:\\Runtime\\node.exe', 'node.exe "C:\\Apps\\Lira\\src\\server.js"', ROOT, true],
    ['C:\\Runtime\\node.exe', 'node.exe C:/APPS/LIRA/src/server.js', ROOT, true],
    ['C:\\Runtime\\electron.exe', 'electron.exe "C:\\Apps\\Lira"', ROOT, true],
    ['C:\\Runtime\\electron.exe', 'electron.exe C:\\Apps\\Lira\\src\\electron\\main.js', ROOT, true],
  ]) assert.equal(isOwnProcess({ ExecutablePath: exe, CommandLine: command }, root), expected, command || exe);
});

test('native ownership lookup contains only validated port numbers', (t) => {
  t.mock.method(childProcess, 'execFileSync', () => assert.fail('invalid input must not execute a command'));
  assert.equal(readPortOwner('3000; ignored'), null);
  assert.equal(readPortOwner(3000, '4000; ignored'), null);
});

test('a connection replacement after proof cannot receive an Authorization header', async (t) => {
  const f = await peer(t);
  const originalRequest = http.request;
  let replacedRequest;
  t.mock.method(http, 'request', (options, callback) => {
    if (options.method !== 'POST') return originalRequest(options, callback);
    // Force a different actual TCP connection at precisely the send boundary.
    replacedRequest = originalRequest({ ...options, agent: false }, callback);
    return replacedRequest;
  });
  await requestVerifiedShutdown({ port: f.port, token: TOKEN, rootDir: ROOT });
  assert.ok(replacedRequest);
  assert.equal(replacedRequest.getHeader('Authorization'), undefined);
  assert.ok(f.requests.every((r) => r.authorization === undefined));
  assert.deepEqual(f.requests.map((r) => r.path), ['/api/health']);
});
