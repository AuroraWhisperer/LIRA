'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const cache = require('../../scripts/verification-cache');
const inputs = require('../../scripts/verification-test-inputs');
const { successfulFiles } = require('../../scripts/verification-test-results');

const ROOT = path.resolve(__dirname, '../..');
const sourceFiles = [
  'scripts/run-tests.js', 'scripts/verify-tests.js', 'scripts/verification-cache.js',
  'scripts/verification-test-inputs.js', 'scripts/verification-test-reporter.js',
  'scripts/verification-test-results.js', 'scripts/verify-server-contract.js',
  'test/helpers/installer-tools.js',
];
const groups = Object.fromEntries(['browser', 'desktop', 'installer', 'contracts'].map((group) => {
  const result = spawnSync(process.execPath, ['scripts/run-tests.js', group, '--list'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return [group, result.stdout.trim().split(/\r?\n/)];
}));

function fixture(t) {
  const temporaryRoot = path.join(ROOT, 'tmp/verification-tests');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'run-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(temporaryRoot));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const put = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  put('.gitignore', 'tmp/\nnode_modules/\nbrowser-cache/\n');
  put('package.json', '{"type":"commonjs"}');
  // Keep fixture module resolution inside the fixture instead of inheriting
  // this repository's real Playwright package and browser installation.
  put('node_modules/playwright/index.js', "exports.chromium = {executablePath: () => require('node:path').resolve(__dirname, '../../browser-cache/chromium-1/chrome-win64/chrome.exe')};");
  for (const file of sourceFiles) put(file, fs.readFileSync(path.join(ROOT, file)));
  for (const file of Object.values(groups).flat()) put(file, "require('node:test')('fixture', () => {});\n");
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/run-tests.js'), '--cache', ...args], {
    cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  });
  return { root, put, run, env, git };
}

test('complete selected files are reused; ESM, VM, assets, installed dependencies and unknown inputs stay conservative', (t) => {
  const f = fixture(t);
  f.put('test/sample/first.test.js', "require('node:test')('first', () => {});");
  f.put('test/sample/second.test.js', "require('node:test')('second', () => {});");
  const args = ['--domain=sample'];
  assert.match(f.run(...args, '--plan').stdout, /run 2, reuse 0/);
  const first = f.run(...args);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /partial verification passed/);
  assert.match(f.run(...args, '--plan').stdout, /run 0, reuse 2/);
  assert.equal(f.run(...args).status, 0);
  for (const [file, text] of [
    ['public/package.json', '{"type":"module"}'],
    ['public/view.js', 'export const value = 1;'],
    ['public/view.html', '<div>new template</div>'],
    ['public/view.css', 'div { color: red; }'],
    ['test/helpers/vm.js', 'module.exports = {};'],
    ['node_modules/example/index.js', 'module.exports = 1;'],
  ]) {
    f.put(file, text);
    assert.match(f.run(...args, '--plan').stdout, /run 2, reuse 0/, file);
    assert.equal(f.run(...args).status, 0);
  }
  fs.unlinkSync(path.join(f.root, 'public/view.js'));
  assert.match(f.run(...args, '--plan').stdout, /run 2, reuse 0/);
});

test('filters cannot certify partial cases, and force removes proofs before a same-input failure', (t) => {
  const f = fixture(t);
  const file = 'test/sample/one.test.js';
  f.put(file, "const fs = require('node:fs'); require('node:test')('one', () => { if (fs.existsSync('tmp/fail')) throw Error('requested failure'); });");
  const args = [`--file=${file}`];
  assert.equal(f.run(...args).status, 0);
  for (const flag of ['--test-name-pattern=one', '--test-only', '--test-shard=1/2', '--test-reporter=tap']) {
    const result = f.run(...args, flag);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /complete files/);
  }
  f.put('tmp/fail', 'fail');
  const failure = f.run(...args, '--force');
  assert.notEqual(failure.status, 0, failure.stdout);
  assert.equal(fs.existsSync(cache.proofPath(f.root, 'tests', file)), false);
  assert.match(f.run(...args, '--plan').stdout, /run 1, reuse 0/);
  fs.unlinkSync(path.join(f.root, 'tmp/fail'));
  assert.equal(f.run(...args).status, 0);
});

test('skipped, todo, only-marked and failed files have no proof; complete successful siblings do', (t) => {
  const f = fixture(t);
  f.put('test/sample/pass.test.js', "require('node:test')('pass', () => {});");
  f.put('test/sample/fail.test.js', "require('node:test')('fail', () => { throw Error('failure'); });");
  const result = f.run('--domain=sample');
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(cache.proofPath(f.root, 'tests', 'test/sample/pass.test.js')), true, result.stdout + result.stderr);
  assert.equal(fs.existsSync(cache.proofPath(f.root, 'tests', 'test/sample/fail.test.js')), false);
  for (const variant of ['skip', 'todo', 'only']) {
    f.put(`test/sample/${variant}.test.js`, `require('node:test').${variant}('${variant}', () => {});`);
    const run = f.run(`--file=test/sample/${variant}.test.js`);
    assert.notEqual(run.status, 0, variant + run.stdout);
    assert.equal(fs.existsSync(cache.proofPath(f.root, 'tests', `test/sample/${variant}.test.js`)), false);
  }
});

test('input changes during execution reject results and concurrent cache writers are locked out', (t) => {
  const f = fixture(t);
  const file = 'test/sample/change.test.js';
  f.put('public/style.css', 'before');
  f.put(file, "require('node:test')('change', () => require('node:fs').writeFileSync('public/style.css', 'after')); ");
  const result = f.run(`--file=${file}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /inputs changed/);
  assert.equal(fs.existsSync(cache.proofPath(f.root, 'tests', file)), false);
  const release = cache.acquireLock(f.root, 'tests');
  const locked = f.run(`--file=${file}`);
  release();
  assert.notEqual(locked.status, 0);
  assert.match(locked.stderr, /already locked/);
  assert.equal(fs.existsSync(path.join(f.root, 'tmp/verification/tests.lock')), false);
});

test('the final full inventory must still contain exactly the files that were verified', (t) => {
  const f = fixture(t);
  // Hold file keys fixed so this isolates the inventory guard from the ordinary
  // conservative input-change check exercised by the preceding regression.
  f.put('scripts/verification-test-inputs.js', "exports.createPlan = (root, files) => files.map(file => ({file, key: file, reuse: false, inputs: 1, scope: 'fixture'}));");
  // A minimal independent runner lets full coverage be tested without runtime groups.
  f.put('scripts/run-tests.js', `
    const fs = require('node:fs'); const path = require('node:path');
    const root = path.resolve(__dirname, '..');
    const files = fs.readdirSync(path.join(root, 'test/sample')).map(x => 'test/sample/' + x).sort();
    if (process.argv.includes('--list')) console.log(files.join('\\n'));
    else process.exitCode = require('./verify-tests').verifyTests({root, files, allFiles: files,
      groups: {browser: [], desktop: [], installer: [], contracts: []}, batches: [files]});
  `);
  f.put('test/sample/add.test.js', "require('node:test')('add', () => require('node:fs').writeFileSync('test/sample/new.test.js', '')); ");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /full verification passed/);
  assert.equal(fs.existsSync(cache.proofPath(f.root, 'tests', 'test/sample/add.test.js')), false);
});

test('installer ownership excludes page styles but tracks script, helper, package and unknown test changes', (t) => {
  const f = fixture(t);
  for (const file of inputs.reviewedInstallers.keys()) f.put(file, fs.readFileSync(path.join(ROOT, file)));
  f.put('build/installer.nsh', 'before');
  f.put('scripts/collect-install-diagnostics.ps1', 'before');
  f.put('public/style.css', 'before');
  const selected = [...inputs.reviewedInstallers.keys()];
  const keys = () => {
    const files = cache.repositoryInputs(f.root);
    return selected.map((file) => cache.digest(inputs.testInputs(f.root, file, files)));
  };
  const original = keys();
  f.put('public/style.css', 'after');
  assert.deepEqual(keys(), original);
  for (const name of ['test/package.json', 'test/engineering/package.json', 'test/helpers/package.json', 'scripts/package.json']) {
    f.put(name, '{"type":"module"}');
    assert.ok(keys().every((key, index) => key !== original[index]), name);
    fs.unlinkSync(path.join(f.root, name));
    assert.deepEqual(keys(), original);
  }
  f.put('build/new-include.nsh', 'new include');
  assert.ok(keys().every((key, index) => key !== original[index]));
  const beforeHelper = keys();
  f.put('test/helpers/installer-tools.js', '// unreviewed new dynamic dependency');
  assert.ok(keys().every((key, index) => key !== beforeHelper[index]));
  const afterHelper = keys();
  f.put('public/style.css', 'third');
  assert.ok(keys().every((key, index) => key !== afterHelper[index]));
  const files = cache.repositoryInputs(f.root);
  assert.equal(inputs.testInputs(f.root, 'test/engineering/new-installer.test.js', files), files);
});

test('actual installer tool bytes and both headed and headless browser installs affect runtime inputs', (t) => {
  const f = fixture(t);
  const oldCompiler = process.env.LIRA_TEST_MAKENSIS;
  const oldPlugins = process.env.LIRA_TEST_NSIS_PLUGINS;
  t.after(() => {
    if (oldCompiler === undefined) delete process.env.LIRA_TEST_MAKENSIS; else process.env.LIRA_TEST_MAKENSIS = oldCompiler;
    if (oldPlugins === undefined) delete process.env.LIRA_TEST_NSIS_PLUGINS; else process.env.LIRA_TEST_NSIS_PLUGINS = oldPlugins;
  });
  process.env.LIRA_TEST_MAKENSIS = path.join(f.root, 'tmp/nsis/Bin/makensis.exe');
  process.env.LIRA_TEST_NSIS_PLUGINS = path.join(f.root, 'tmp/nsis-plugins');
  f.put('tmp/nsis/Bin/makensis.exe', 'compiler');
  f.put('tmp/nsis/Include/LogicLib.nsh', 'include');
  f.put('tmp/nsis-plugins/nsProcess.dll', 'plugin');
  const installer = () => cache.digest(inputs.runtimeInputs(f.root, groups.installer, groups, false));
  let before = installer();
  for (const name of ['tmp/nsis/Bin/makensis.exe', 'tmp/nsis/Include/LogicLib.nsh', 'tmp/nsis-plugins/nsProcess.dll']) {
    f.put(name, 'changed');
    assert.notEqual(installer(), before, name);
    before = installer();
  }
  const executable = path.join(f.root, 'browser-cache/chromium-1234/chrome-win64/chrome.exe');
  f.put('node_modules/playwright/index.js', `exports.chromium = {executablePath: () => ${JSON.stringify(executable)}};`);
  f.put('browser-cache/chromium-1234/chrome-win64/chrome.exe', 'headed');
  f.put('browser-cache/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe', 'headless');
  const browser = () => cache.digest(inputs.runtimeInputs(f.root, ['test/offline/unknown.test.js'], groups));
  before = browser();
  f.put('browser-cache/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe', 'changed');
  assert.notEqual(browser(), before);
});

test('contract reuse verifies actual pinned HEAD and fixture bytes every time', (t) => {
  const f = fixture(t);
  f.put('tmp/server/fixture.json', '{"value":1}');
  const serverRoot = path.join(f.root, 'tmp/server');
  const git = (...args) => {
    const result = spawnSync('git', ['-C', serverRoot, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('add', 'fixture.json');
  git('-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', '-c', 'core.autocrlf=false', 'commit', '-qm', 'fixture');
  f.put('server-contract.lock.json', JSON.stringify({ schemaVersion: 1, revision: git('rev-parse', 'HEAD'),
    fixtures: { 'fixture.json': cache.hashFile(path.join(serverRoot, 'fixture.json')) } }));
  const previous = process.env.LIRA_SERVER_ROOT;
  process.env.LIRA_SERVER_ROOT = serverRoot;
  t.after(() => { if (previous === undefined) delete process.env.LIRA_SERVER_ROOT; else process.env.LIRA_SERVER_ROOT = previous; });
  assert.ok(inputs.runtimeInputs(f.root, groups.contracts, groups).contracts);
  f.put('tmp/server/fixture.json', '{"value":2}');
  assert.throws(() => inputs.runtimeInputs(f.root, groups.contracts, groups), { code: 'SERVER_CONTRACT_FIXTURE_MISMATCH' });
});

test('browser debug logs do not invalidate proofs but installed browser resources still do', (t) => {
  const f = fixture(t);
  const browserRoot = 'browser-cache/chromium_headless_shell-1234/chrome-headless-shell-win64';
  f.put(`${browserRoot}/chrome-headless-shell.exe`, 'browser');
  f.put('browser-cache/chromium-1/chrome-win64/chrome.exe', 'browser');
  const file = 'test/sample/browser-log.test.js';
  f.put(file, `const fs = require('node:fs'); require('node:test')('browser log', () => {
    fs.writeFileSync('${browserRoot}/debug.log', 'diagnostic output');
    fs.writeFileSync('browser-cache/chromium-1/chrome-win64/debug.log', 'diagnostic output');
  });`);
  const result = f.run(`--file=${file}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(f.run(`--file=${file}`, '--plan').stdout, /run 0, reuse 1/);
  f.put(`${browserRoot}/debug.log`, 'new diagnostic output');
  assert.match(f.run(`--file=${file}`, '--plan').stdout, /run 0, reuse 1/);
  f.put(`${browserRoot}/chrome-headless-shell.exe`, 'changed browser');
  assert.match(f.run(`--file=${file}`, '--plan').stdout, /run 1, reuse 0/);
  f.put(`${browserRoot}/chrome-headless-shell.exe`, 'browser');
  f.put(`${browserRoot}/resources.pak`, 'new resource');
  assert.match(f.run(`--file=${file}`, '--plan').stdout, /run 1, reuse 0/);
});

test('missing, duplicate, skipped, inconsistent or unowned machine reports never certify files', () => {
  const file = 'test/sample/a.test.js';
  const counts = { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
  const valid = { version: 1, files: [{ file, success: true, counts, duration_ms: 1 }],
    failures: [], warnings: [], summary: { success: true, counts } };
  assert.deepEqual(successfulFiles(ROOT, valid, [file], 0), [{ file, durationMs: 1 }]);
  for (const mutate of [
    (r) => { r.summary = null; }, (r) => { r.files = []; }, (r) => { r.files.push(r.files[0]); },
    (r) => { r.summary.counts.tests = 2; }, (r) => { r.files[0].file = 'test/unknown.test.js'; },
    (r) => { r.warnings.push({ message: 'only selected' }); }, (r) => { r.summary.success = false; },
    (r) => { r.files[0].counts = { ...counts, passed: 0, skipped: 1 }; r.summary.counts = r.files[0].counts; },
  ]) {
    const report = structuredClone(valid);
    mutate(report);
    assert.deepEqual(successfulFiles(ROOT, report, [file], 0), []);
  }
  assert.deepEqual(successfulFiles(ROOT, valid, [file], null), []);
});

test('cache entry validation, Git root checks and custom Node options fail closed', (t) => {
  const f = fixture(t);
  f.put('src/value.js', 'value');
  const key = 'proof-key';
  cache.saveProof(f.root, 'tests', 'src/value.js', key, 1);
  assert.equal(cache.hasProof(f.root, 'tests', 'src/value.js', key), true);
  f.put(path.relative(f.root, cache.proofPath(f.root, 'tests', 'src/value.js', key)), '{broken');
  assert.equal(cache.hasProof(f.root, 'tests', 'src/value.js', key), false);
  assert.throws(() => cache.repositoryInputs(path.join(f.root, 'src')), /checkout root/);
  f.git('add', 'src/value.js');
  fs.renameSync(path.join(f.root, 'src'), path.join(f.root, 'real-source'));
  fs.symlinkSync(path.join(f.root, 'real-source'), path.join(f.root, 'src'), 'junction');
  assert.throws(() => cache.repositoryInputs(f.root), /Unsupported linked verification input/);
  f.env.NODE_OPTIONS = '--no-warnings';
  const result = f.run('--file=test/ui/frontend-toast.test.js', '--plan');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without NODE_OPTIONS/);
});
