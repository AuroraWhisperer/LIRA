'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createQQClientMonitor } = require('../../src/music/qq-client-monitor');

test('QQ monitor parses split samples and ignores retired process events', () => {
  const children = [];
  const samples = [];
  const monitor = createQQClientMonitor((sample) => samples.push(sample), {
    spawn(command, args, options) {
      assert.equal(command, 'powershell.exe');
      assert.equal(options.windowsHide, true);
      assert.ok(args.includes('-NonInteractive'));
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
        kill() { this.killed = true; },
      });
      children.push(child);
      return child;
    },
  });
  monitor.start(); monitor.start();
  assert.equal(children.length, 1);
  children[0].stdout.write('{"detected":');
  children[0].stdout.write('true}\r\ninvalid\n');
  assert.deepEqual(samples, [{ detected: true }, { error: true }]);
  monitor.stop(); monitor.start();
  assert.equal(children[0].killed, true);
  children[0].stdout.write('{"detected":false}\n');
  children[0].emit('exit');
  assert.equal(samples.length, 2);
  children[1].emit('exit');
  assert.deepEqual(samples.at(-1), { error: true });
  monitor.stop(); monitor.start(); monitor.stop();
  assert.equal(children[2].killed, true);
});

test('QQ monitor retries failed helpers with bounded backoff and cancels pending work', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const children = [];
  const samples = [];
  const monitor = createQQClientMonitor((sample) => samples.push(sample), {
    spawn() {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
        kill() { this.killed = true; },
      });
      children.push(child);
      return child;
    },
  });
  t.after(() => monitor.stop());
  monitor.start();
  children[0].emit('error', new Error('spawn unavailable'));
  children[0].emit('exit', 1);
  assert.equal(samples.length, 1, 'error followed by exit schedules one restart');
  t.mock.timers.tick(499);
  assert.equal(children.length, 1);
  t.mock.timers.tick(1);
  assert.equal(children.length, 2);
  children[1].emit('exit', 1);
  t.mock.timers.tick(999);
  assert.equal(children.length, 2);
  t.mock.timers.tick(1);
  children[2].emit('exit', 1);
  t.mock.timers.tick(2000);
  children[3].emit('exit', 1);
  t.mock.timers.tick(30000);
  assert.equal(children.length, 4, 'persistent failures stop after three automatic retries');
  monitor.stop(); monitor.start();
  children[4].emit('exit', 1);
  monitor.stop();
  t.mock.timers.tick(30000);
  assert.equal(children.length, 5);
});

test('QQ monitor recovers a thrown spawn and resets retry budget after valid output', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  let child;
  const samples = [];
  const monitor = createQQClientMonitor((sample) => samples.push(sample), {
    spawn() {
      if (++attempts === 1) throw new Error('temporary spawn failure');
      child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), kill() {},
      });
      return child;
    },
  });
  t.after(() => monitor.stop());
  monitor.start();
  assert.deepEqual(samples, [{ error: true }]);
  t.mock.timers.tick(500);
  child.stdout.write('{"detected":false}\n');
  child.emit('exit', 1);
  t.mock.timers.tick(500);
  assert.equal(attempts, 3, 'successful sampling resets retry delay');
});

test('QQ monitor stops delivering buffered samples when the owner stops it', () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill() {},
  });
  const samples = [];
  const monitor = createQQClientMonitor((sample) => {
    samples.push(sample);
    monitor.stop();
  }, { spawn: () => child });
  monitor.start();
  child.stdout.write('{"detected":true}\n{"detected":false}\n');
  assert.deepEqual(samples, [{ detected: true }]);
});
