'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const http = require('node:http');
const childProcess = require('node:child_process');

const lifecycle = require('../src/server/lifecycle');
const { createInflightTracker } = require('../src/server/inflight-tracker');

test('packaged process recognition is case insensitive and requires the owning install path', { skip: process.platform !== 'win32' }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-process-owner-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let executablePath;
  t.mock.method(childProcess, 'execFileSync', () => JSON.stringify({ ExecutablePath: executablePath, CommandLine: `"${executablePath}"` }));
  t.mock.method(process, 'kill', () => assert.fail('synthetic process must never be terminated'));
  for (const [executable, expectedShutdown] of [
    ['C:\\Apps\\Lira\\LIRA.exe', true],
    ['c:\\apps\\lira\\lira.EXE', true],
    ['C:\\Other\\LIRA.exe', false],
    ['C:\\Apps\\Lira\\Other.exe', false],
  ]) {
    executablePath = executable;
    lifecycle.writeRuntimeInfo(dataDir, { pid: 12345, port: 3000, host: 'localhost' });
    let requestedShutdown = false;
    await lifecycle.cleanupOwnPortOccupant({
      ...cleanupOptions(dataDir, async (url) => {
        if (String(url).endsWith('/api/system/shutdown')) requestedShutdown = true;
        return new Response('{}', { status: 503 });
      }, async () => false),
      rootDir: 'C:\\Apps\\Lira\\resources\\app.asar',
    });
    assert.equal(requestedShutdown, expectedShutdown, executable);
  }
});

function cleanupOptions(dataDir, fetchImpl, canConnectToPort) {
  return {
    port: 3000,
    host: 'localhost',
    rootDir: path.resolve(__dirname, '..'),
    dataDir,
    cleanupTimeoutMs: 50,
    cleanupPollMs: 1,
    sleep: () => Promise.resolve(),
    fetch: fetchImpl,
    canConnectToPort,
  };
}

test('process cleanup requires an exact owned runtime entry, not a generic path or argument', { skip: process.platform !== 'win32' }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-process-entry-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(dataDir)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  let info;
  const stopped = [];
  t.mock.method(childProcess, 'execFileSync', () => JSON.stringify(info));
  t.mock.method(process, 'kill', (pid, signal) => stopped.push({ pid, signal }));
  for (const [executable, command, expectedStop] of [
    ['node.exe', 'node.exe C:\\OtherProject\\src\\server.js', false],
    ['node.exe', 'node.exe src/server.js', false],
    ['node.exe', 'node.exe C:\\Apps\\Lira-other\\src\\server.js', false],
    ['node.exe', 'node.exe C:\\Apps\\Lira\\src\\server.js.old', false],
    ['node.exe', 'node.exe C:\\OtherProject\\main.js --data-dir C:\\Apps\\Lira', false],
    ['powershell.exe', 'powershell.exe C:\\Apps\\Lira\\src\\server.js', false],
    ['node.exe', 'node.exe "C:\\Apps\\Lira\\src\\server.js"', true],
    ['node.exe', 'node.exe C:/APPS/LIRA/src/server.js', true],
    ['electron.exe', 'electron.exe "C:\\Apps\\Lira"', true],
    ['electron.exe', 'electron.exe C:\\Apps\\Lira\\src\\electron\\main.js', true],
  ]) {
    info = { ExecutablePath: `C:\\Runtime\\${executable}`, CommandLine: command };
    stopped.length = 0;
    const requests = [];
    lifecycle.writeRuntimeInfo(dataDir, { pid: 12345, port: 3000, host: 'localhost' });
    await lifecycle.cleanupOwnPortOccupant({
      ...cleanupOptions(dataDir, async (url) => {
        requests.push(String(url));
        return new Response('{}', { status: 404 });
      }, async () => true),
      rootDir: 'C:\\Apps\\Lira', cleanupTimeoutMs: 0,
    });
    assert.deepEqual(stopped, expectedStop ? [{ pid: 12345, signal: 'SIGTERM' }] : [], command);
    assert.equal(requests.some((url) => url.endsWith('/api/system/shutdown')), expectedStop, command);
  }
});

test('cleanup rechecks a runtime PID after the graceful shutdown wait', { skip: process.platform !== 'win32' }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-process-reuse-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(dataDir)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  let queries = 0;
  t.mock.method(childProcess, 'execFileSync', () => JSON.stringify({
    ExecutablePath: 'C:\\Runtime\\node.exe',
    CommandLine: ++queries === 1
      ? 'node.exe C:\\Apps\\Lira\\src\\server.js'
      : 'node.exe C:\\OtherProject\\src\\server.js',
  }));
  t.mock.method(process, 'kill', () => assert.fail('reused PID must not be terminated'));
  lifecycle.writeRuntimeInfo(dataDir, { pid: 12345, port: 3000, host: 'localhost' });
  await lifecycle.cleanupOwnPortOccupant({
    ...cleanupOptions(dataDir, async () => new Response('{}', { status: 404 }), async () => true),
    rootDir: 'C:\\Apps\\Lira', cleanupTimeoutMs: 0,
  });
  assert.equal(queries, 2);
});

test('forced cleanup refreshes service health and binds it to the same PID', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-process-health-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(dataDir)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  t.mock.method(childProcess, 'execFileSync', () => 'null');
  const stopped = [];
  t.mock.method(process, 'kill', (pid) => stopped.push(pid));
  for (const currentPid of [null, 23456, 12345]) {
    let healthReads = 0;
    stopped.length = 0;
    await lifecycle.cleanupOwnPortOccupant({
      ...cleanupOptions(dataDir, async (url) => {
        if (!String(url).endsWith('/api/health')) return new Response('{}');
        const pid = ++healthReads === 1 ? 12345 : currentPid;
        return new Response(JSON.stringify(pid ? {
          ok: true, data: { serviceId: lifecycle.SERVICE_ID, pid },
        } : {}), { status: pid ? 200 : 404 });
      }, async () => true),
      cleanupTimeoutMs: 0,
    });
    assert.deepEqual(stopped, currentPid === 12345 ? [12345] : []);
    assert.equal(healthReads, 2);
  }
});

function createPreviousServerFetch(dataDir, requests) {
  return async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/api/health')) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            rootDir: path.resolve(__dirname, '..'),
            dataDir,
            pid: 12345,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

test('cleanup sends the persisted session token to the previous instance', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-lifecycle-'),
  );
  const requests = [];
  let released = false;

  try {
    fs.writeFileSync(
      path.join(dataDir, '.session-token'),
      'previous-token\n',
      'utf8',
    );
    const fetchImpl = async (url, options) => {
      const response = await createPreviousServerFetch(dataDir, requests)(
        url,
        options,
      );
      if (String(url).endsWith('/api/system/shutdown')) released = true;
      return response;
    };

    await lifecycle.cleanupOwnPortOccupant(
      cleanupOptions(dataDir, fetchImpl, async () => !released),
    );

    const shutdown = requests.find((request) =>
      request.url.endsWith('/api/system/shutdown'),
    );
    assert.ok(
      shutdown,
      'the previous instance should receive a shutdown request',
    );
    assert.equal(
      shutdown.options.headers.Authorization,
      'Bearer previous-token',
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cleanup remains compatible with a previous instance that has no token file', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-lifecycle-'),
  );
  const requests = [];
  let released = false;

  try {
    const fetchImpl = async (url, options) => {
      const response = await createPreviousServerFetch(dataDir, requests)(
        url,
        options,
      );
      if (String(url).endsWith('/api/system/shutdown')) released = true;
      return response;
    };

    await lifecycle.cleanupOwnPortOccupant(
      cleanupOptions(dataDir, fetchImpl, async () => !released),
    );

    const shutdown = requests.find((request) =>
      request.url.endsWith('/api/system/shutdown'),
    );
    assert.ok(
      shutdown,
      'the previous instance should receive a shutdown request',
    );
    assert.equal(shutdown.options.headers.Authorization, undefined);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cleanup checks the requested port when runtime info points to a fallback port', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-lifecycle-'),
  );
  const requests = [];
  let released = false;

  try {
    lifecycle.writeRuntimeInfo(dataDir, {
      pid: 12345,
      port: 3001,
      host: 'localhost',
    });
    const fetchImpl = async (url, options) => {
      const response = await createPreviousServerFetch(dataDir, requests)(
        url,
        options,
      );
      if (String(url).endsWith('/api/system/shutdown')) released = true;
      return response;
    };

    await lifecycle.cleanupOwnPortOccupant(
      cleanupOptions(dataDir, fetchImpl, async () => !released),
    );

    assert.match(requests[0].url, /:3000\/api\/health$/);
    assert.match(
      requests.find((request) => request.url.endsWith('/api/system/shutdown'))
        .url,
      /:3000\/api\/system\/shutdown$/,
    );
    assert.deepEqual(lifecycle.readRuntimeInfo(dataDir), {
      pid: 12345,
      port: 3001,
      host: 'localhost',
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cleanup matches the same application across different data directories', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-lifecycle-'),
  );
  const requests = [];
  let released = false;

  try {
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith('/api/health')) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              serviceId: lifecycle.SERVICE_ID,
              dataDir: path.join(dataDir, 'previous-instance'),
              pid: 12345,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      released = true;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await lifecycle.cleanupOwnPortOccupant(
      cleanupOptions(dataDir, fetchImpl, async () => !released),
    );

    assert.ok(
      requests.some((request) => request.url.endsWith('/api/system/shutdown')),
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cleanup leaves an unrelated service on port 3000 untouched', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-lifecycle-'),
  );
  const requests = [];

  try {
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            serviceId: 'other-application',
            dataDir: path.join(dataDir, 'other-application'),
            pid: 12345,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    await lifecycle.cleanupOwnPortOccupant(
      cleanupOptions(dataDir, fetchImpl, async () => true),
    );

    assert.equal(
      requests.some((request) => request.url.endsWith('/api/system/shutdown')),
      false,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('session token cleanup never removes a token file owned by another instance', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-lifecycle-'),
  );

  try {
    const tokenPath = lifecycle.writeSessionToken(dataDir, 'current-token');
    assert.equal(fs.readFileSync(tokenPath, 'utf8').trim(), 'current-token');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
    }

    fs.writeFileSync(tokenPath, 'replacement-token\n', 'utf8');
    assert.equal(lifecycle.removeSessionToken(dataDir, 'current-token'), false);
    assert.equal(
      fs.readFileSync(tokenPath, 'utf8').trim(),
      'replacement-token',
    );
    assert.equal(
      lifecycle.removeSessionToken(dataDir, 'replacement-token'),
      true,
    );
    assert.equal(fs.existsSync(tokenPath), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('listenWithFallback asks the OS for a free port when startPort is zero', async () => {
  const server = http.createServer((_req, res) => res.end('ok'));
  try {
    const port = await lifecycle.listenWithFallback(server, {
      startPort: 0,
      host: '127.0.0.1',
    });
    assert.ok(Number.isInteger(port));
    assert.ok(port > 0);
    assert.equal(server.address().port, port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('listenExactly reports the OS-assigned port when port is zero', async () => {
  const server = http.createServer((_req, res) => res.end('ok'));
  try {
    const port = await lifecycle.listenExactly(server, {
      port: 0,
      host: '127.0.0.1',
    });
    assert.ok(Number.isInteger(port));
    assert.ok(port > 0);
    assert.equal(server.address().port, port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('listenExactly rejects when the requested port is already in use', async () => {
  const first = http.createServer((_req, res) => res.end('first'));
  const second = http.createServer();
  try {
    await new Promise((resolve) => first.listen(0, '127.0.0.1', resolve));
    const address = first.address();
    const port = address && typeof address === 'object' ? address.port : 0;

    await assert.rejects(
      lifecycle.listenExactly(second, { port, host: '127.0.0.1' }),
      { code: 'EADDRINUSE' },
    );
  } finally {
    await new Promise((resolve) => first.close(resolve));
  }
});

test('runtime info records the previous pid and port and removes only its own record', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-runtime-'),
  );
  try {
    lifecycle.writeRuntimeInfo(dataDir, {
      pid: 1234,
      port: 4567,
      host: '127.0.0.1',
    });
    assert.deepEqual(lifecycle.readRuntimeInfo(dataDir), {
      pid: 1234,
      port: 4567,
      host: '127.0.0.1',
    });
    assert.equal(
      lifecycle.removeRuntimeInfo(dataDir, { pid: 9999, port: 4567 }),
      false,
    );
    assert.equal(
      lifecycle.removeRuntimeInfo(dataDir, { pid: 1234, port: 4567 }),
      true,
    );
    assert.equal(lifecycle.readRuntimeInfo(dataDir), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cleanup reports bounded phase timings without exposing credentials', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-lifecycle-'),
  );
  const phases = [];
  let released = false;

  try {
    fs.writeFileSync(
      path.join(dataDir, '.session-token'),
      'secret-token\n',
      'utf8',
    );
    const fetchImpl = async (url, options) => {
      const response = await createPreviousServerFetch(dataDir, [])(
        url,
        options,
      );
      if (String(url).endsWith('/api/system/shutdown')) released = true;
      return response;
    };
    await lifecycle.cleanupOwnPortOccupant({
      ...cleanupOptions(dataDir, fetchImpl, async () => !released),
      onPhase: (phase, durationMs, extra) =>
        phases.push({ phase, durationMs, extra }),
    });

    assert.ok(phases.some((entry) => entry.phase === 'port-health-check'));
    assert.ok(phases.some((entry) => entry.phase === 'port-graceful-wait'));
    assert.ok(phases.some((entry) => entry.phase === 'port-cleanup'));
    assert.ok(
      phases.every(
        (entry) => Number.isFinite(entry.durationMs) && entry.durationMs >= 0,
      ),
    );
    assert.doesNotMatch(JSON.stringify(phases), /secret-token/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('inflight tracker rejects new work and drains already accepted handlers', async () => {
  const tracker = createInflightTracker();
  let release;
  const accepted = tracker.run(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );

  tracker.quiesce();
  const drain = tracker.drain();
  let drained = false;
  drain.then(() => {
    drained = true;
  });
  await assert.rejects(
    tracker.run(() => Promise.resolve()),
    (error) => error.code === 'SERVER_QUIESCING',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);

  release('done');
  assert.equal(await accepted, 'done');
  await drain;
  assert.equal(drained, true);
});
