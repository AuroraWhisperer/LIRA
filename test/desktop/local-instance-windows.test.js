'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const lifecycle = require('../../src/server/lifecycle');
const { readPortOwner } = require('../../src/server/local-process-owner');

function mockTcpTable(t, getRows, transform = (command) => command) {
  const nativeExec = childProcess.execFileSync;
  t.mock.method(childProcess, 'execFileSync', (file, args, options) => {
    const invocation = '& "$env:SystemRoot\\System32\\netstat.exe" -ano -p TCP';
    assert.ok(args.at(-1).includes(invocation));
    const fixture = `
      function Get-WmiObject { Start-Sleep -Milliseconds 6000 }
      function Get-TestTcpTable { ${getRows()} }
      $global:LASTEXITCODE = 0;
    `;
    const command = transform(args.at(-1).replace(invocation, 'Get-TestTcpTable'));
    return nativeExec(file, [...args.slice(0, -1), fixture + command], options);
  });
}

test(
  'Windows native TCP/process lookup safely shuts down an owned legacy child',
  { skip: process.platform !== 'win32', timeout: 20000 },
  async (t) => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-native-owner-'));
    fs.mkdirSync(path.join(rootDir, 'src'));
    const entry = path.join(rootDir, 'src/server.js');
    fs.writeFileSync(
      entry,
      `
    const http = require('node:http');
    const server = http.createServer((req, res) => {
      req.resume();
      if (req.url === '/api/system/shutdown') {
        process.send({ authorized: req.headers.authorization === 'Bearer synthetic-native-owner' });
        res.end(JSON.stringify({ok:true}), () => server.close(() => process.exit(0)));
      } else {
        res.end(JSON.stringify({ok:true,data:{serviceId:'lira',pid:424242}}));
      }
    });
    server.keepAliveTimeout = 15000;
    server.listen(0, '127.0.0.1', () => process.send({port:server.address().port}));
  `,
    );
    const child = childProcess.fork(entry, [], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, 'exit');
        child.kill();
        await ended;
      }
      assert.equal(path.dirname(fs.realpathSync(rootDir)), fs.realpathSync(os.tmpdir()));
      fs.rmSync(rootDir, { recursive: true, force: true });
    });
    const [{ port }] = await once(child, 'message');
    const messages = [];
    child.on('message', (message) => messages.push(message));
    const exited = once(child, 'exit');
    lifecycle.writeSessionToken(rootDir, 'synthetic-native-owner');
    t.mock.method(process, 'kill', () => assert.fail('the child must exit gracefully, never by forced PID'));
    const phases = [];
    const nativeExec = childProcess.execFileSync;
    const ownerQueries = [];
    t.mock.method(childProcess, 'execFileSync', (...args) => {
      try {
        const output = nativeExec(...args);
        ownerQueries.push(String(output));
        return output;
      } catch (error) {
        ownerQueries.push({ code: error.code, status: error.status });
        throw error;
      }
    });
    await lifecycle.cleanupOwnPortOccupant({
      port,
      host: '127.0.0.1',
      rootDir,
      dataDir: rootDir,
      cleanupTimeoutMs: 2000,
      cleanupPollMs: 20,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onPhase: (phase, durationMs, extra) => phases.push({ phase, durationMs, extra }),
    });
    assert.ok(
      phases.some((p) => p.extra.result === 'graceful'),
      JSON.stringify({ phases, ownerQueries }),
    );
    assert.deepEqual(messages, [{ authorized: true }]);
    const [exitCode] = await exited;
    assert.equal(exitCode, 0);
  },
);

test(
  'native ownership query matches listeners and exact established endpoints',
  { skip: process.platform !== 'win32', timeout: 20000 },
  async (t) => {
    const server = net.createServer();
    let client;
    let socket;
    t.after(() => {
      client?.destroy();
      socket?.destroy();
      return new Promise((resolve) => server.close(resolve));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    const accepted = once(server, 'connection');
    client = net.connect(port, '127.0.0.1');
    [[socket]] = await Promise.all([accepted, once(client, 'connect')]);

    assert.equal(readPortOwner(port)?.ProcessId, process.pid);
    assert.equal(readPortOwner(port, client.localPort)?.ProcessId, process.pid);
    // A listening port cannot also be the connected client's ephemeral port.
    assert.equal(readPortOwner(port, port), null);
  },
);

test(
  'native ownership avoids TCP provider and process enumeration delays',
  { skip: process.platform !== 'win32', timeout: 15000 },
  (t) => {
    mockTcpTable(t, () => '"  TCP  127.0.0.1:3000  0.0.0.0:0  LISTENING  $PID"');
    const owner = readPortOwner(3000);
    assert.ok(owner?.ProcessId > 0);
    assert.ok(owner.CreationDate);
    assert.match(owner.ExecutablePath, /powershell\.exe$/i);
  },
);

test(
  'native ownership script rejects a different Windows user SID',
  { skip: process.platform !== 'win32', timeout: 15000 },
  (t) => {
    let sameUser = false;
    mockTcpTable(t,
      () => '"  TCP  127.0.0.1:3000  127.0.0.1:4000  ESTABLISHED  $PID"',
      (command) => sameUser ? command : command.replace(
        '$ownerSid = $ownerProcess.GetOwnerSid().Sid;',
        "$ownerSid = 'synthetic-other-user';",
      ),
    );
    assert.equal(readPortOwner(3000, 4000), null);
    sameUser = true;
    assert.ok(readPortOwner(3000, 4000)?.ProcessId > 0);
  },
);

test(
  'native ownership rejects mismatched, malformed, ambiguous and failed TCP snapshots',
  { skip: process.platform !== 'win32', timeout: 15000 },
  (t) => {
    let rows = `
      " TCP 127.0.0.2:3000 127.0.0.1:4000 ESTABLISHED $PID"
      " TCP 127.0.0.1:30001 127.0.0.1:4000 ESTABLISHED $PID"
      " TCP 127.0.0.1:3000 127.0.0.2:4000 ESTABLISHED $PID"
      " TCP 127.0.0.1:3000 127.0.0.1:40001 ESTABLISHED $PID"
      " TCP 127.0.0.1:3000 127.0.0.1:4000 CLOSE_WAIT $PID"
      " TCP 127.0.0.1:3000 127.0.0.1:4000 ESTABLISHED invalid"
    `;
    mockTcpTable(t, () => rows);
    assert.equal(readPortOwner(3000, 4000), null);
    const matching = '" TCP 127.0.0.1:3000 127.0.0.1:4000 ESTABLISHED $PID"';
    rows = `${matching}; ${matching}`;
    assert.equal(readPortOwner(3000, 4000), null);
    rows = `${matching}; $global:LASTEXITCODE = 1`;
    assert.equal(readPortOwner(3000, 4000), null);
    rows = matching;
    assert.ok(readPortOwner(3000, 4000)?.ProcessId > 0);
  },
);
