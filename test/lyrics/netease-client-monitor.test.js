'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createNeteaseClientMonitor, buildNeteaseClientMonitorScript } = require('../../src/music/netease-client-monitor');

function fixture(t, options = {}) {
  const samples = [];
  const children = [];
  const monitor = createNeteaseClientMonitor((sample) => samples.push(sample), {
    readTrack: () => null,
    spawn(command, args, settings) {
      assert.equal(command, 'powershell.exe');
      assert.equal(settings.windowsHide, true);
      assert.ok(args.includes('-NonInteractive'));
      assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), buildNeteaseClientMonitorScript());
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
        kill() { this.killed = true; },
      });
      children.push(child);
      return child;
    },
    ...options,
  });
  t.after(() => monitor.stop());
  return { monitor, children, samples };
}

test('NetEase monitor parses split rows, enriches matched IDs and ignores retired helpers', (t) => {
  let reads = 0;
  const { monitor, children, samples } = fixture(t, { readTrack(sample) {
    reads++;
    assert.equal(sample.title, 'Song');
    return { title: 'Song', artists: ['Artist'], sourceTrackId: '123' };
  } });
  monitor.start(); monitor.start();
  assert.equal(children.length, 1);
  children[0].stdout.write('{"detected":');
  children[0].stdout.write('true,"windowTitle":"Song - Artist"}\n');
  children[0].stdout.write('{"detected":true,"windowTitle":"Song - Artist"}\ninvalid\n');
  assert.equal(samples[0].sourceTrackId, '123');
  assert.deepEqual(samples[0].artists, ['Artist']);
  assert.equal(reads, 1);
  assert.deepEqual(samples.at(-1), { error: true });
  monitor.stop(); monitor.start();
  children[0].stdout.write('{"detected":false}\n'); children[0].emit('exit');
  assert.equal(samples.length, 3);
  assert.equal(children[0].killed, true);
  monitor.stop();
  assert.equal(children[1].killed, true);
});

test('NetEase UIA hangs are bounded and failed helper restarts have a finite budget', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { monitor, children, samples } = fixture(t);
  monitor.start();
  t.mock.timers.tick(15000);
  assert.equal(children[0].killed, true);
  assert.deepEqual(samples.at(-1), { error: true });
  t.mock.timers.tick(500);
  assert.equal(children.length, 2);
  children[1].emit('exit'); t.mock.timers.tick(1000);
  children[2].emit('exit'); t.mock.timers.tick(2000);
  children[3].emit('exit'); t.mock.timers.tick(100000);
  assert.equal(children.length, 4);
  monitor.stop(); monitor.start();
  assert.equal(children.length, 5, 'manual refresh resets the exhausted restart budget');
  monitor.stop(); t.mock.timers.tick(100000);
  assert.equal(children.length, 5);
});

test('NetEase monitor handles a synchronous launch failure and cancels queued retries on stop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let launches = 0;
  const { monitor, samples } = fixture(t, { spawn() { launches++; throw new Error('unavailable'); } });
  monitor.start();
  assert.deepEqual(samples, [{ error: true }]);
  t.mock.timers.tick(500);
  assert.equal(launches, 2);
  monitor.stop(); t.mock.timers.tick(100000);
  assert.equal(launches, 2);
});

test('NetEase generated Windows helper compiles without opening or controlling a player', { skip: process.platform !== 'win32' }, () => {
  const script = buildNeteaseClientMonitorScript().replace('while ($true)', 'while ($false)');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
