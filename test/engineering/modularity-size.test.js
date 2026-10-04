'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { checkModularity, collectSourceFiles, countPhysicalLines } = require('../../scripts/check-modularity');

const ROOT_DIR = path.resolve(__dirname, '../..');

function fixture(t) {
  const scratch = path.join(ROOT_DIR, 'tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'modularity-size-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, lines) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '// source\n'.repeat(lines));
  };
  return { root, write };
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

test('size signals distinguish executable logic, styles, markup, tests and data', (t) => {
  const { root, write } = fixture(t);
  const cases = [
    ['src/service.js', 600, 'source'],
    ['scripts/setup.ps1', 600, 'source'],
    ['public/css/style.css', 800, 'stylesheet'],
    ['public/pages/settings.html', 800, 'markup'],
    ['test/feature.test.js', 800, 'test'],
    ['test/helpers/dom.js', 800, 'test'],
  ];
  for (const [file, threshold] of cases) write(file, threshold);
  write('public/data/catalog.json', 5000);
  write('test/fixtures/snapshot.json', 5000);
  assert.deepEqual(checkModularity(root).assessments, []);

  for (const [file, threshold] of cases) write(file, threshold + 1);
  const result = checkModularity(root);
  assert.deepEqual(
    result.assessments,
    cases
      .map(([file, reviewAfter, kind]) => ({ path: file, lines: reviewAfter + 1, kind, reviewAfter }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
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
  assert.deepEqual(collectSourceFiles(root), files.sort());
  assert.equal(checkModularity(root).assessments.length, files.length - 1);
});

test('standalone CLI reports large files without a registry or a failing size ceiling', (t) => {
  const { root, write } = fixture(t);
  write('src/workflow.js', 1200);
  write('public/css/component.css', 1000);
  write('test/scenario.test.js', 1500);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT_DIR, 'scripts/check-modularity.js'), path.join(root, 'scripts/check-modularity.js'));
  const report = spawnSync(process.execPath, [path.join(root, 'scripts/check-modularity.js')], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /src\/workflow\.js: 1200 lines/);
  assert.match(report.stdout, /public\/css\/component\.css: 1000 lines/);
  assert.match(report.stdout, /test\/scenario\.test\.js: 1500 lines/);
  assert.match(report.stdout, /3 advisory findings/);
});

test('static presets and help chapters retain their content responsibilities', () => {
  const read = (file) => fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');
  const presets = JSON.parse(read('public/data/theme-presets.json'));
  assert.equal(typeof presets.default, 'object');
  const chapters = fs
    .readdirSync(path.join(ROOT_DIR, 'public/pages/admin/toolbox'))
    .filter((file) => /^usage-guide(?:-[a-z-]+)?\.html$/.test(file) && file !== 'usage-guide-search.html');
  for (const file of chapters) {
    const help = read(`public/pages/admin/toolbox/${file}`);
    assert.doesNotMatch(help, /<(?:script|form|input|select|textarea)\b|\son[a-z]+\s*=/i, file);
  }
});

test('repository size findings inform review without certifying or rejecting cohesion', (t) => {
  const result = checkModularity(ROOT_DIR);
  assert.ok(result.files.includes('src/server.js'));
  for (const { path: file, lines, kind } of result.assessments) {
    t.diagnostic(`${file}: ${lines} lines (${kind}); review responsibility and purpose when changing this file.`);
  }
});
