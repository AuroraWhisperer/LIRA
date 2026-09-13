'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const {
  createDiagnosticTerminal,
} = require('../scripts/wesing-diagnostic-terminal');

function logFixture() {
  let content = Buffer.from('old\n', 'utf16le');
  let fileName = 'initial.log';
  let readGate = null;
  const timers = new Set();
  const events = [];
  const reads = [];
  let closes = 0;
  const filename = path.resolve(__dirname, '../scripts/wesing-log-probe.js');
  const context = vm.createContext({
    module: { exports: {} },
    Buffer,
    require(name) {
      if (name !== 'node:fs') return require(name);
      return {
        promises: {
          async readdir() {
            return [{ name: fileName, isFile: () => true }];
          },
          async stat() {
            return { size: content.length, mtimeMs: 1 };
          },
          async open() {
            return {
              async read(buffer, bufferOffset, length, position) {
                reads.push({ length, position });
                if (readGate) await readGate;
                const bytesRead = content.copy(
                  buffer,
                  bufferOffset,
                  position,
                  position + length,
                );
                return { bytesRead };
              },
              async close() {
                closes += 1;
              },
            };
          },
        },
      };
    },
    setTimeout(callback) {
      timers.add(callback);
      return callback;
    },
    clearTimeout(callback) {
      timers.delete(callback);
    },
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const probe = context.module.exports.createWeSingLogProbe(
    'synthetic-cache',
    (event) => events.push(event),
  );
  return {
    probe,
    events,
    reads,
    timers,
    get closes() {
      return closes;
    },
    append(bytes) {
      content = Buffer.concat([content, bytes]);
    },
    replace(text, name = fileName) {
      fileName = name;
      content = Buffer.from(text, 'utf16le');
    },
    gate(promise) {
      readGate = promise;
    },
    tick() {
      const callback = [...timers][0];
      assert.ok(callback);
      timers.delete(callback);
      callback();
    },
    async polled() {
      for (let count = 0; count < 10 && timers.size === 0; count += 1)
        await new Promise((resolve) => setImmediate(resolve));
      assert.equal(timers.size, 1);
    },
  };
}

test('WeSing log probe preserves byte offsets and split UTF-16 bytes, then flushes after the pending read', async () => {
  const f = logFixture();
  await f.probe.start();
  const row = Buffer.from('新歌词', 'utf16le');
  f.append(row.subarray(0, 3));
  f.tick();
  await f.polled();
  assert.equal(f.events.length, 1);
  f.append(row.subarray(3));
  let release;
  f.gate(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  f.tick();
  for (let count = 0; count < 10 && f.reads.length < 2; count += 1)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.reads.length, 2);
  let stopped = false;
  const stop = f.probe.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  release();
  await stop;
  assert.deepEqual(f.reads, [
    { length: 3, position: 8 },
    { length: 3, position: 11 },
  ]);
  assert.equal(f.closes, 2);
  assert.equal(f.events.at(-1).line, '新歌词');
  assert.equal(f.timers.size, 0);
  await f.probe.stop();
  assert.equal(
    f.events.filter((event) => event.event === 'wesing-log-line').length,
    1,
  );
});

test('WeSing log probe resets partial text and odd bytes on truncation and file rotation', async () => {
  const f = logFixture();
  await f.probe.start();
  f.append(Buffer.from('stale', 'utf16le').subarray(0, 5));
  f.tick();
  await f.polled();
  f.replace('重\n');
  f.tick();
  await f.polled();
  f.append(Buffer.from('stale', 'utf16le').subarray(0, 5));
  f.tick();
  await f.polled();
  f.replace('换\n', 'rotated.log');
  f.tick();
  await f.polled();
  await f.probe.stop();
  assert.deepEqual(
    f.events.filter((event) => event.line).map((event) => event.line),
    ['重', '换'],
  );
  assert.deepEqual(
    f.events.filter((event) => event.status).map((event) => event.status),
    ['ready', 'truncated', 'switched'],
  );
  assert.equal(f.timers.size, 0);
});

function terminalFixture(options = {}) {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = options.raw === true;
  let paused = options.paused !== false;
  input.isPaused = () => paused;
  input.pause = () => {
    paused = true;
  };
  input.resume = () => {
    paused = false;
  };
  input.setRawMode = (value) => {
    if (options.rawFailure) throw options.rawFailure;
    input.isRaw = value;
  };
  const existing = () => {};
  for (const event of ['data', 'newListener', 'keypress'])
    input.on(event, existing);
  const terminal = createDiagnosticTerminal(() => {}, {
    input,
    emitKeypressEvents(stream) {
      stream.on('data', () => {});
      stream.on('newListener', () => {});
    },
  });
  return {
    terminal,
    input,
    assertRestored() {
      for (const event of ['data', 'newListener', 'keypress'])
        assert.deepEqual(input.listeners(event), [existing]);
      assert.equal(input.isRaw, options.raw === true);
      assert.equal(input.isPaused(), options.paused !== false);
    },
  };
}

test('WeSing terminal cleanup preserves prior listeners and terminal state', async () => {
  for (const options of [{}, { raw: true, paused: false }]) {
    const f = terminalFixture(options);
    assert.equal(f.terminal.setup(), true);
    assert.equal(f.input.listenerCount('keypress'), 2);
    await f.terminal.cleanup();
    f.assertRestored();
  }
});

test('WeSing terminal cleanup removes readline listeners after setup fails', async () => {
  const failure = new Error('synthetic raw-mode failure');
  const f = terminalFixture({ rawFailure: failure });
  assert.throws(
    () => f.terminal.setup(),
    (error) => error === failure,
  );
  await f.terminal.cleanup();
  f.assertRestored();
});

test('WeSing terminal cleanup continues restoring input after an earlier cleanup failure', async () => {
  const f = terminalFixture();
  f.terminal.setup();
  const failure = new Error('synthetic listener cleanup failure');
  const off = f.input.off;
  f.input.off = function (event, listener) {
    off.call(this, event, listener);
    if (event === 'keypress') throw failure;
    return this;
  };
  await assert.rejects(f.terminal.cleanup(), (error) => error === failure);
  f.assertRestored();
});
