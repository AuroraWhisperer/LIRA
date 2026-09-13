'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');

const checker = path.resolve(__dirname, '../scripts/check-js.js');
const source = fs.readFileSync(checker, 'utf8');

async function runFixture({ cpus = 8, failure } = {}) {
  const calls = [];
  const output = [];
  const errors = [];
  let active = 0;
  let peak = 0;
  let completed = 0;
  const fakeProcess = {
    execPath: process.execPath,
    exitCode: 0,
  };
  function begin(command, args, options) {
    assert.equal(command, process.execPath);
    assert.equal(args[0], '--check');
    assert.equal(options.shell, undefined);
    calls.push(args[1]);
    peak = Math.max(peak, ++active);
    return calls.length === 1 && failure;
  }
  function finish() {
    active -= 1;
    completed += 1;
  }
  const fakeRequire = (name) => {
    if (name === 'node:fs')
      return {
        existsSync: () => true,
        readdirSync: (directory) =>
          path.basename(directory) === 'src'
            ? Array.from({ length: 11 }, (_, index) => ({
                name: `fixture-${index}.js`,
                isDirectory: () => false,
                isFile: () => true,
              }))
            : [],
      };
    if (name === 'node:os') return { availableParallelism: () => cpus };
    if (name === 'node:child_process')
      return {
        spawn(command, args, options) {
          const failed = begin(command, args, options);
          const child = new EventEmitter();
          setImmediate(() => {
            finish();
            if (failed === 'start')
              child.emit('error', new Error('fixture spawn failure'));
            child.emit(
              'close',
              failed === 'signal' ? null : failed ? 7 : 0,
              failed === 'signal' ? 'SIGTERM' : null,
            );
          });
          return child;
        },
      };
    return require(name);
  };
  await vm.runInNewContext(source, {
    require: fakeRequire,
    __dirname: path.dirname(checker),
    process: fakeProcess,
    console: {
      log: (message) => output.push(String(message)),
      error: (message) => errors.push(String(message)),
    },
  });
  return {
    calls,
    output,
    errors,
    active,
    peak,
    completed,
    exitCode: fakeProcess.exitCode,
  };
}

test('syntax checks cover every file with bounded concurrency and respect available CPUs', async () => {
  for (const cpus of [1, 8]) {
    const result = await runFixture({ cpus });
    assert.equal(result.exitCode, 0);
    assert.equal(new Set(result.calls).size, 11);
    assert.equal(result.completed, 11);
    assert.equal(result.peak, Math.min(4, cpus));
    assert.equal(result.active, 0);
    assert.deepEqual(result.output, [
      'Syntax check passed for 11 JavaScript files.',
    ]);
  }
});

test('syntax failures stop queued work and drain running checks before returning failure', async () => {
  const result = await runFixture({ failure: 'syntax' });
  assert.equal(result.exitCode, 7);
  assert.ok(result.calls.length <= 4);
  assert.equal(result.completed, result.calls.length);
  assert.equal(result.active, 0);
  assert.deepEqual(result.output, []);
});

test('child startup and signal failures cannot produce a successful syntax check', async () => {
  for (const failure of ['start', 'signal']) {
    const result = await runFixture({ failure });
    assert.equal(result.exitCode, 1);
    assert.ok(result.calls.length <= 4);
    assert.equal(result.completed, result.calls.length);
    assert.deepEqual(result.output, []);
    if (failure === 'start')
      assert.match(result.errors.join('\n'), /fixture spawn failure/);
  }
});

test('checker CLI preserves native CommonJS and ESM syntax checks without executing files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-check-js-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('lira-check-js-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  function put(name, text) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  put('scripts/check-js.js', source);
  put('package.json', '{"type":"commonjs"}');
  put('src/空 格.js', 'throw new Error("must not execute");');
  put('src/ignored.cjs', 'const invalid = ;');
  put('public/package.json', '{"type":"module"}');
  put(
    'public/module.js',
    'import missing from "./missing.js"; await missing();',
  );
  put('test/fixture.js', 'module.exports = 1;');
  const run = () =>
    spawnSync(process.execPath, [path.join(root, 'scripts/check-js.js')], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Syntax check passed for 4 JavaScript files\./);
  put('public/module.js', 'export const invalid = ;');
  const invalid = run();
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.match(invalid.stderr, /module\.js[\s\S]*SyntaxError/);
  assert.doesNotMatch(invalid.stdout, /Syntax check passed/);
});
