'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const lifecycle = require('../src/server/lifecycle');
const { readPortOwner } = require('../src/server/local-process-owner');

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
  'native ownership script rejects a different Windows user SID',
  { skip: process.platform !== 'win32', timeout: 15000 },
  (t) => {
    const nativeExec = childProcess.execFileSync;
    let sameUser = false;
    t.mock.method(childProcess, 'execFileSync', (file, args, options) => {
      const fixture = `
      function Get-WmiObject { param($Class,$Namespace,$Filter,$ErrorAction)
        if ($Class -eq 'MSFT_NetTCPConnection') { [pscustomobject]@{OwningProcess=12345} }
        else {
          [pscustomobject]@{ProcessId=12345; ExecutablePath='C:\\Runtime\\node.exe'; CommandLine='node.exe C:\\Apps\\Lira\\src\\server.js'; CreationDate='synthetic-created'} |
            Add-Member -MemberType ScriptMethod -Name GetOwnerSid -Value { [pscustomobject]@{Sid=${sameUser ? '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value' : "'synthetic-other-user'"}} } -PassThru
        }
      }
    `;
      return nativeExec(file, [...args.slice(0, -1), fixture + args.at(-1)], options);
    });
    assert.equal(readPortOwner(3000, 4000), null);
    sameUser = true;
    assert.equal(readPortOwner(3000, 4000).ProcessId, 12345);
  },
);
