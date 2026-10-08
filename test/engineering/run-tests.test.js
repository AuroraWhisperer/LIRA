'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const RUNNER = path.join(ROOT, 'scripts/run-tests.js');
const { buildNodeArguments, defaultConcurrency } = require(RUNNER);
const temporaryRoot = path.join(ROOT, 'tmp/test-runner');
const runtimeGroups = ['browser', 'desktop', 'installer', 'contracts', 'offline'];

function run(root, ...args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [path.join(root, 'scripts/run-tests.js'), ...args], {
    cwd: os.tmpdir(),
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
}

function list(root, ...args) {
  const result = run(root, ...args, '--list');
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim().split(/\r?\n/);
}

const configuredGroups = Object.fromEntries(runtimeGroups.map((group) => [group, list(ROOT, group)]));

function fixture(t) {
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'run-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(temporaryRoot));
    assert.ok(path.basename(root).startsWith('run-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const put = (relative, source = '') => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  };
  put('scripts/run-tests.js', fs.readFileSync(RUNNER, 'utf8'));
  put('scripts/test-results-reporter.js', fs.readFileSync(path.join(ROOT, 'scripts/test-results-reporter.js'), 'utf8'));
  for (const group of runtimeGroups.filter((name) => name !== 'offline')) {
    for (const file of configuredGroups[group]) put(file);
  }
  return { root, put };
}

test('repository collection covers every domain and each test belongs to exactly one runtime group', () => {
  const all = list(ROOT, 'all');
  const expected = fs
    .readdirSync(path.join(ROOT, 'test'), { recursive: true })
    .map((name) => name.replaceAll('\\', '/'))
    .filter((name) => name.endsWith('.test.js') && !/^(helpers|fixtures)\//.test(name))
    .map((name) => `test/${name}`);
  assert.deepEqual([...all].sort(), expected.sort());
  const assigned = Object.values(configuredGroups).flat();
  assert.equal(new Set(assigned).size, assigned.length);
  assert.deepEqual(assigned.sort(), [...all].sort());
});

test('recursive discovery excludes helpers and probes while preserving distinct files with the same basename', (t) => {
  const { root, put } = fixture(t);
  for (const file of [
    'sample/a.test.js',
    'sample/nested/b.test.js',
    'other/a.test.js',
    'helpers/nested/ignored.test.js',
    'fixtures/ignored.test.js',
  ]) {
    put(`test/${file}`);
  }
  put('test/sample/probe.cjs');
  assert.deepEqual(list(root, 'offline'), [
    'test/other/a.test.js',
    'test/sample/a.test.js',
    'test/sample/nested/b.test.js',
  ]);
  assert.deepEqual(list(root, '--domain=sample', '--domain', 'sample'), [
    'test/sample/a.test.js',
    'test/sample/nested/b.test.js',
  ]);
  assert.deepEqual(list(root, 'offline', '--domain=other', '--domain=sample'), list(root, 'offline'));
  assert.deepEqual(list(root, 'browser', '--domain=ui'), configuredGroups.browser.filter((file) => file.startsWith('test/ui/')));
});

test('file selectors combine without duplicates and intersect with domains and runtime groups', (t) => {
  const { root, put } = fixture(t);
  put('test/sample/first.test.js');
  put('test/sample/second.test.js');
  put('test/other/first.test.js');
  assert.deepEqual(list(root, '--file=test/sample/*.test.js', '--file', 'test/sample/first.test.js'), [
    'test/sample/first.test.js',
    'test/sample/second.test.js',
  ]);
  assert.deepEqual(list(root, '--domain=sample', '--file=test/**/first.test.js'), ['test/sample/first.test.js']);
  assert.deepEqual(list(root, '--file=.\\test\\sample\\first.test.js'), ['test/sample/first.test.js']);
  assert.deepEqual(list(root, 'browser', '--file=test/ui/*.test.js'), configuredGroups.browser.filter((file) => file.startsWith('test/ui/')));
});

test('invalid selectors and empty intersections fail instead of running an unintended suite', (t) => {
  const { root, put } = fixture(t);
  put('test/sample/only.test.js');
  for (const args of [
    ['unknown'], ['--domain=unknown'], ['--domain='], ['--domain'], ['browser', '--domain=sample'],
    ['--file='], ['--file'], ['--file=test/missing/*.test.js'],
    ['--file=test/sample/only.test.js', '--file=test/sample/typo.test.js'],
    ['browser', '--file=test/sample/*.test.js'], ['--domain=sample', '--file=test/ui/*.test.js'],
  ]) {
    const result = run(root, ...args, '--list');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown test (group|domain|file pattern)|No tests selected/);
    assert.equal(result.stdout, '');
  }
  const help = run(root, '--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--domain=<directory>/);
  assert.match(help.stdout, /--file=<path-or-glob>/);
  assert.match(help.stdout, /sample/);
});

test('missing and duplicate dependency assignments fail collection', (t) => {
  const { root, put } = fixture(t);
  const source = fs.readFileSync(RUNNER, 'utf8');
  put('scripts/run-tests.js', source.replace('browser: [', "browser: ['engineering/build-integrity',"));
  let result = run(root, '--list');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing or duplicate test group entry/);
  put('scripts/run-tests.js', source);
  fs.unlinkSync(path.join(root, 'test/engineering/build-integrity.test.js'));
  result = run(root, '--list');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing or duplicate test group entry/);
});

test('execution forwards Node options, keeps VM modules and process isolation, and propagates failures', (t) => {
  const { root, put } = fixture(t);
  put('test/sample/unselected.test.js', "throw new Error('unselected file was loaded');");
  for (const name of ['first', 'second']) {
    put(
      `test/sample/${name}.test.js`,
      `
      const test = require('node:test');
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      test('selected', () => {
        assert.equal(process.cwd(), path.resolve(__dirname, '../..'));
        assert.equal(typeof require('node:vm').SourceTextModule, 'function');
        fs.appendFileSync('pids.txt', process.pid + '\\n');
      });
      test('unselected', () => assert.fail('Node name filter was not forwarded'));
    `,
    );
  }
  const result = run(
    root,
    'offline',
    '--file=test/sample/first.test.js',
    '--file=test/sample/second.test.js',
    '--test-concurrency=1',
    '--test-name-pattern',
    '^selected$',
    '--test-reporter=tap',
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /File scope: partial \(2\//);
  const pids = fs.readFileSync(path.join(root, 'pids.txt'), 'utf8').trim().split(/\r?\n/).map(Number);
  assert.equal(pids.length, 2);
  assert.equal(new Set(pids).size, 2);
  assert.ok(pids.every((pid) => pid !== process.pid));
  put(
    'test/failing/failure.test.js',
    "require('node:test')('expected failure', () => { throw new Error('synthetic failure'); });",
  );
  const failure = run(root, '--domain=failing', '--test-reporter=tap');
  assert.equal(failure.status, 1, failure.stdout + failure.stderr);
  assert.match(failure.stdout, /synthetic failure/);
  const latest = JSON.parse(fs.readFileSync(path.join(root, 'tmp/test-results/latest.json'), 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(root, 'tmp/test-results', latest.run, 'results.json'), 'utf8'));
  assert.equal(report.complete, true);
  assert.deepEqual(report.failedFiles, ['test/failing/failure.test.js']);
  assert.match(report.failures[0].message, /synthetic failure/);
  assert.ok(report.files[0].durationMs >= 0);
});

test('file concurrency defaults to the bounded release value and an explicit flag replaces it', () => {
  const build = (nodeArgs) =>
    buildNodeArguments({ nodeArgs, reporterArgs: [], reportPath: 'report.json', batch: ['test/sample/a.test.js'] })
      .filter((arg) => arg.startsWith('--test-concurrency'));
  assert.equal(defaultConcurrency, String(Math.min(8, os.availableParallelism())));
  assert.deepEqual(build([]), [`--test-concurrency=${defaultConcurrency}`]);
  assert.deepEqual(build(['--test-concurrency=3']), ['--test-concurrency=3']);
  assert.deepEqual(build(['--test-name-pattern', '^selected$']), [`--test-concurrency=${defaultConcurrency}`]);
});

test('requiring the runner only exposes its functions and never runs the suite', (t) => {
  const { root, put } = fixture(t);
  put('test/sample/selected.test.js', `
    const test = require('node:test');
    test('runs', () => require('node:fs').writeFileSync('executed.txt', 'yes'));
  `);
  const marker = path.join(root, 'require-marker.txt');
  const probe = spawnSync(process.execPath, [
    '-e',
    `const runner = require(${JSON.stringify(RUNNER)});`
      + "require('node:fs').writeFileSync('require-marker.txt', JSON.stringify(Object.keys(runner).sort()));",
  ], { cwd: root, env: { ...process.env }, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout, '', 'requiring the runner must not print run output');
  assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), ['buildNodeArguments', 'defaultConcurrency']);
  assert.equal(fs.existsSync(path.join(root, 'executed.txt')), false, 'requiring the runner must not execute tests');
});

test('failed-file selection is explicit, deduplicated, and rejects unavailable or incomplete evidence', (t) => {
  const { root, put } = fixture(t);
  assert.notEqual(run(root, '--failed', '--list').status, 0);
  put('test/sample/passing.test.js', "require('node:test')('pass', () => {});");
  put('test/sample/failing.test.js', "throw new Error('import failure');");
  put('test/sample/crashing.test.js', 'process.exit(17);');
  const initial = run(root, '--domain=sample');
  assert.equal(initial.status, 1, initial.stdout + initial.stderr);
  assert.match(initial.stdout, /Focused rerun: npm test -- --failed/);
  assert.deepEqual(list(root, '--failed'), ['test/sample/crashing.test.js', 'test/sample/failing.test.js']);
  put('test/sample/failing.test.js', "require('node:test')('fixed', () => {});");
  put('test/sample/crashing.test.js', "require('node:test')('fixed', () => {});");
  const fixed = run(root, '--failed', '--test-reporter=tap');
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.match(fixed.stdout, /File scope: partial \(2\//);
  assert.notEqual(run(root, '--failed', '--list').status, 0);
  put('tmp/test-results/latest.json', JSON.stringify({ version: 1, complete: false, failedFiles: ['test/sample/failing.test.js'] }));
  assert.notEqual(run(root, '--failed', '--list').status, 0);
  put('tmp/test-results/latest.json', '{');
  assert.notEqual(run(root, '--failed', '--list').status, 0);
});

test('an older run finishing cannot replace a newer interrupted attempt', (t) => {
  const { root, put } = fixture(t);
  put('test/sample/older.test.js', `
    const fs = require('node:fs');
    require('node:test')('older failure', () => {
      fs.mkdirSync('tmp/test-results/run-newer');
      fs.writeFileSync('tmp/test-results/run-newer/results.json', JSON.stringify({ version: 1, complete: false, failedFiles: [] }));
      fs.writeFileSync('tmp/test-results/latest.json', JSON.stringify({ version: 1, run: 'run-newer' }));
      throw new Error('older failure');
    });
  `);
  assert.equal(run(root, '--domain=sample').status, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'tmp/test-results/latest.json'), 'utf8')).run, 'run-newer');
  const retry = run(root, '--failed', '--list');
  assert.notEqual(retry.status, 0);
  assert.equal(retry.stdout, '');
  assert.match(retry.stderr, /No complete failed-file selection/);
});

test('native ownership tests finish before the remaining selection and cannot have failures masked', (t) => {
  const { root, put } = fixture(t);
  const nativeFile = 'test/desktop/local-instance-windows.test.js';
  const nativeSource = `
    const test = require('node:test');
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    test('selected', () => {
      assert.equal(typeof require('node:vm').SourceTextModule, 'function');
      fs.writeFileSync('native-parent.txt', String(process.ppid));
    });
    test('unselected', () => assert.fail('Node name filter was not forwarded'));
  `;
  put(nativeFile, nativeSource);
  put('test/sample/remaining.test.js', `
    const test = require('node:test');
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    test('selected', () => {
      assert.notEqual(process.ppid, Number(fs.readFileSync('native-parent.txt', 'utf8')));
      fs.appendFileSync('remaining-runs.txt', 'completed\\n');
    });
    test('unselected', () => assert.fail('Node name filter was not forwarded'));
  `);
  const args = ['--domain=desktop', '--domain=sample', '--test-name-pattern=^selected$', '--test-reporter=tap'];
  const success = run(root, ...args);
  assert.equal(success.status, 0, success.stdout + success.stderr);
  put(nativeFile, nativeSource + "test('selected', () => assert.fail('native batch failure'));\n");
  const failure = run(root, ...args);
  assert.equal(failure.status, 1, failure.stdout + failure.stderr);
  assert.match(failure.stdout, /native batch failure/);
  assert.equal(fs.readFileSync(path.join(root, 'remaining-runs.txt'), 'utf8'), 'completed\ncompleted\n');
  assert.deepEqual(list(root, '--failed'), [nativeFile]);
});
