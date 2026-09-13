'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const {
  BASELINE_PATH,
  checkModularity,
  collectSourceFiles,
  countPhysicalLines,
} = require('../scripts/check-modularity');

const ROOT_DIR = path.resolve(__dirname, '..');
const TODAY = '2026-09-13';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-modularity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, lines) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '// source\n'.repeat(lines));
  };
  write('test/protection.test.js', 1);
  return { root, write };
}

function record(file, maxLines, kind = 'review') {
  return {
    path: file,
    kind,
    maxLines,
    owner: 'test source owner',
    reason: 'Keeps the complete lifecycle scenario together.',
    removal: 'Extract independent scenarios on next lifecycle change.',
    reviewBy: '2026-12-13',
    test: 'test/protection.test.js',
  };
}

function check(root, entries = []) {
  return checkModularity(root, { version: 1, entries }, TODAY).errors;
}

test('physical lines include comments and blanks, without a phantom trailing line', () => {
  for (const [source, lines] of [
    ['', 0],
    ['one', 1],
    ['one\n', 1],
    ['\n', 1],
    ['// comment\n\ncode\n', 3],
    ['one\r\ntwo\r\n', 2],
    ['one\rtwo\r', 2],
  ])
    assert.equal(countPhysicalLines(source), lines);
});

test('600 is unrestricted, 601 and 800 need review, 801 needs legacy or exception', (t) => {
  const { root, write } = fixture(t);
  const file = 'src/service.js';
  write(file, 600);
  assert.deepEqual(check(root), []);
  for (const lines of [601, 800]) {
    write(file, lines);
    assert.match(check(root).join('\n'), /require a file-specific review/);
    assert.deepEqual(check(root, [record(file, lines)]), []);
  }
  write(file, 801);
  assert.match(check(root).join('\n'), /800-line ceiling/);
  assert.match(check(root, [record(file, 801)]).join('\n'), /ordinary review/);
  assert.deepEqual(check(root, [record(file, 801, 'legacy')]), []);
});

test('all maintained source kinds, helpers, fixtures and untracked files are scanned', (t) => {
  const { root, write } = fixture(t);
  const files = [
    'src/worker.cjs',
    'src/uppercase.JS',
    'public/js/module.mjs',
    'public/css/style.css',
    'public/pages/settings.html',
    'public/data/presets.json',
    'scripts/setup.ps1',
    'scripts/start.cmd',
    'scripts/start.bat',
    'tools/analyzer/new.js',
    'test/feature.test.js',
    'test/helpers/dom.js',
    'test/fixtures/example.html',
    'build/installer.nsh',
  ];
  for (const file of files) write(file, 801);
  write('data/private.json', 900);
  write('node_modules/dependency/index.js', 900);
  write('public/img/example.svg', 900);
  assert.deepEqual(
    collectSourceFiles(root),
    [...files, 'test/protection.test.js'].sort(),
  );
  assert.equal(check(root).length, files.length);
});

test('legacy and exceptions remain exact-file ceilings, and shrinking debt can be removed', (t) => {
  const { root, write } = fixture(t);
  for (const kind of ['legacy', 'exception']) {
    const file = `public/pages/${kind}.html`;
    const entry = record(file, 900, kind);
    write(file, 900);
    assert.deepEqual(check(root, [entry]), []);
    write(file, 901);
    assert.match(
      check(root, [entry]).join('\n'),
      /exceeds reviewed ceiling 900/,
    );
    write(file, 600);
    assert.match(check(root, [entry]).join('\n'), /obsolete file-size record/);
    assert.deepEqual(check(root), []);
  }
  write('public/pages/new-form.html', 801);
  assert.match(check(root).join('\n'), /800-line ceiling/);
});

test('reviewed warning files cannot silently grow inside the warning band', (t) => {
  const { root, write } = fixture(t);
  write('src/service.js', 702);
  assert.match(
    check(root, [record('src/service.js', 701)]).join('\n'),
    /ceiling 701/,
  );
});

test('registry rejects malformed records, duplicates, wildcards, stale paths and expiry', (t) => {
  const { root, write } = fixture(t);
  const file = 'src/service.js';
  write(file, 700);
  const valid = record(file, 700);
  for (const changes of [
    { path: 'src/*.js' },
    { path: '../outside.js' },
    { path: 'src/missing.js' },
    { path: 'src\\service.js' },
    { kind: 'fixture-directory' },
    { kind: 'legacy' },
    { maxLines: 600 },
    { maxLines: 700.5 },
    { owner: '' },
    { reason: ' ' },
    { removal: null },
    { reviewBy: '2026-09-12' },
    { reviewBy: '2026-02-30' },
    { reviewBy: 'someday' },
    { test: 'test/missing.test.js' },
    { test: '../secret' },
    { test: 'src/service.js' },
  ]) {
    assert.ok(
      check(root, [{ ...valid, ...changes }]).length,
      JSON.stringify(changes),
    );
  }
  assert.match(check(root, [valid, valid]).join('\n'), /duplicate/);
  assert.match(check(root, [null]).join('\n'), /must be an object/);
  assert.match(checkModularity(root, {}, TODAY).errors.join('\n'), /version 1/);
  assert.deepEqual(check(root, [{ ...valid, reviewBy: TODAY }]), []);
});

test('standalone CLI fails on an unreviewed source and succeeds after a valid review', (t) => {
  const { root, write } = fixture(t);
  write('src/new.js', 801);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT_DIR, 'scripts/check-modularity.js'),
    path.join(root, 'scripts/check-modularity.js'),
  );
  const baseline = path.join(root, BASELINE_PATH);
  fs.mkdirSync(path.dirname(baseline), { recursive: true });
  fs.writeFileSync(baseline, JSON.stringify({ version: 1, entries: [] }));
  const run = () =>
    spawnSync(
      process.execPath,
      [path.join(root, 'scripts/check-modularity.js')],
      { encoding: 'utf8', windowsHide: true },
    );
  const rejected = run();
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.match(rejected.stderr, /800-line ceiling/);
  write('src/new.js', 700);
  fs.writeFileSync(
    baseline,
    JSON.stringify({
      version: 1,
      entries: [{ ...record('src/new.js', 700), reviewBy: '2099-01-01' }],
    }),
  );
  const accepted = run();
  assert.equal(accepted.status, 0, accepted.stderr);
});

test('the two static exceptions retain data and help-content responsibilities', () => {
  const read = (file) => fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');
  const presets = JSON.parse(read('public/data/theme-presets.json'));
  assert.equal(typeof presets.default, 'object');
  const help = read('public/pages/admin/toolbox/usage-guide.html');
  assert.doesNotMatch(
    help,
    /<(?:script|form|input|select|textarea)\b|\son[a-z]+\s*=/i,
  );
});

test('repository sources satisfy their reviewed modularity registry', () => {
  const registry = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, BASELINE_PATH), 'utf8'),
  );
  const result = checkModularity(ROOT_DIR, registry);
  assert.deepEqual(result.errors, [], result.errors.join('\n'));
});
