'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
// File-level concurrency for the shared Node test runner. 8 is measured on the
// 32-logical-CPU release host: the desktop and browser groups take about 158s
// against 227s at 4, with no desktop failure; 12 is slower for those groups and
// starts dropping Electron cases on load. An explicit --test-concurrency
// replaces this default instead of being appended next to it.
const defaultConcurrency = String(Math.min(8, os.availableParallelism()));
// These files launch a runtime or read the pinned server checkout. All other
// tests use Node, VM modules and isolated local HTTP/SQLite fixtures.
const groups = {
  browser: [
    'admin/canvas-browser-source',
    'admin/canvas-editing',
    'admin/canvas-empty-previews',
    'admin/canvas-component-library',
    'admin/canvas-component-suites',
    'admin/canvas-gift-components',
    'admin/canvas-opening',
    'admin/canvas-text-box-picker',
    'admin/component-style-library',
    'admin/component-source-import',
    'admin/component-preview-browser',
    'admin/component-preview-drafts-browser',
    'admin/component-preview-links',
    'admin/component-preview-output',
    'admin/component-preview-recovery',
    'admin/frontend-usage-guide-search-browser',
    'admin/usage-guide-layout-browser',
    'bots/daily-bot-frontend',
    'danmaku/frontend-admin-danmaku',
    'danmaku/danmaku-feed-motion',
    'games/frontend-wheel-draft',
    'gifts/frontend-gift-banner',
    'gifts/frontend-gift-display-settings',
    'gifts/frontend-gift-export-settings',
    'gifts/frontend-gift-feed',
    'gifts/frontend-gift-history-selection',
    'gifts/frontend-gift-wishes',
    'gifts/frontend-gift-sprint',
    'gifts/frontend-guard-thanks',
    'gifts/guard-nautical-player',
    'overlays/component-source',
    'overlays/component-style-effects',
    'scenes/scene-live-updates',
    'scenes/scene-renderer',
    'ui/frontend-toast-browser',
    'ui/frontend-color-control',
    'admin/ui-edit-state',
    'danmaku/danmaku-panel-edit-state',
    'overtime/overtime-overlay-state-ordering',
    'overtime/overtime-overlay-runtime',
    'admin/canvas-queue',
    'admin/canvas-songlist',
    'songs/frontend-song-virtual-scroller',
    'songs/frontend-song-editor',
    'admin/shared-ui-interactions',
    'admin/song-board-settings',
    'admin/text-box-editor',
  ],
  desktop: [
    'desktop/background-filters-electron',
    'desktop/danmaku-canvas-electron',
    'desktop/gift-wishes-electron',
    'desktop/opening-styles-electron',
    'desktop/resource-style-settings-electron',
    'desktop/shared-canvas-appearance-electron',
    'engineering/build-integrity',
    'desktop/desktop-auth-race-electron',
    'desktop/desktop-request-auth-electron',
    'desktop/electron-data-layout',
    'desktop/electron-startup',
    'desktop/local-instance-windows',
    'desktop/resource-lifecycle-electron',
    'desktop/resource-integrity-electron',
    'desktop/text-box-electron',
    'desktop/woodland-style-import-electron',
  ],
  installer: [
    'engineering/installer-app-exit',
    'engineering/installer-diagnostics',
    'engineering/installer-directory',
    'engineering/installer-migration',
    'engineering/installer-uninstall',
  ],
  contracts: [
    'bots/daily-bot-controller',
    'fan-profiles/fan-profiles-protocol',
    'gifts/frontend-recent-gifts-contract',
    'gifts/gift-category',
    'gifts/gift-identity-catalog',
    'license/license-password-contract',
    'license/license-protocol',
    'overtime/overtime-gift-picker-contract',
    'gifts/pk-report-settings-ipc',
    'gifts/processed-gift-contract',
  ],
};
const files = [];
function collectTests(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relativePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (relativePath !== 'test/helpers' && relativePath !== 'test/fixtures') collectTests(relativePath);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(relativePath);
    }
  }
}
collectTests('test');
// Keep collection lists in filename order across domain directories.
files.sort((left, right) => {
  const leftKey = `${path.basename(left)}\0${left}`;
  const rightKey = `${path.basename(right)}\0${right}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
});
const assigned = new Set();
for (const [name, names] of Object.entries(groups)) {
  groups[name] = names.map((file) => `test/${file}.test.js`);
  for (const file of groups[name]) {
    if (!files.includes(file) || assigned.has(file)) {
      throw new Error(`Missing or duplicate test group entry: ${file}`);
    }
    assigned.add(file);
  }
}
groups.offline = files.filter((file) => !assigned.has(file));
groups.all = files;

// The runner owns file-level concurrency: an explicit --test-concurrency replaces the
// bounded default instead of being appended next to it, so the effective value never
// depends on how Node resolves a repeated flag.
function buildNodeArguments({ nodeArgs, reporterArgs, reportPath, batch }) {
  const override = nodeArgs.some((arg) => /^--test-concurrency(?:=|$)/.test(arg));
  return [
    '--experimental-vm-modules', '--test',
    ...(override ? [] : [`--test-concurrency=${defaultConcurrency}`]),
    ...nodeArgs, ...reporterArgs,
    `--test-reporter=${pathToFileURL(path.join(root, 'scripts/test-results-reporter.js')).href}`,
    `--test-reporter-destination=${reportPath}`, ...batch,
  ];
}

function main() {
  const testArgs = process.argv.slice(2);  const group = testArgs[0]?.startsWith('--') ? 'all' : testArgs.shift() || 'all';
  if (!Object.hasOwn(groups, group)) {
    throw new Error(`Unknown test group ${group}; use ${Object.keys(groups).join(', ')}`);
  }
  const domains = [...new Set(files.map((file) => file.split('/')[1]))].sort();
  const selectedDomains = new Set();
  const filePatterns = new Set();
  const nodeArgs = [];
  const resultsDirectory = path.join(root, 'tmp/test-results');
  const latestResultsPath = path.join(resultsDirectory, 'latest.json');
  let failedOnly = false;
  let list = false;
  let help = false;
  for (let index = 0; index < testArgs.length; index += 1) {
    const arg = testArgs[index];
    if (arg === '--domain' || arg.startsWith('--domain=')) {
      const domain = arg === '--domain' ? testArgs[++index] : arg.slice('--domain='.length);
      if (!domains.includes(domain)) {
        throw new Error(`Unknown test domain ${domain || '(empty)'}; use ${domains.join(', ')}`);
      }
      selectedDomains.add(domain);
    } else if (arg === '--file' || arg.startsWith('--file=')) {
      const value = arg === '--file' ? testArgs[++index] : arg.slice('--file='.length);
      const pattern = (value || '').replaceAll('\\', '/').replace(/^\.\//, '');
      if (!pattern || !files.some((file) => path.matchesGlob(file, pattern))) {
        throw new Error(`Unknown test file pattern ${value || '(empty)'}; use a test/ path or glob`);
      }
      filePatterns.add(pattern);
    } else if (arg === '--failed') {
      failedOnly = true;
    } else if (arg === '--list') {
      list = true;
    } else if (arg === '--help') {
      help = true;
    } else {
      nodeArgs.push(arg);
    }
  }
  let failedFiles;
  if (failedOnly && !help) {
    let previous;
    try {
      const latest = JSON.parse(fs.readFileSync(latestResultsPath, 'utf8'));
      if (latest.version !== 1 || !/^run-[a-z0-9]+$/i.test(latest.run)) throw new Error('Invalid run reference');
      previous = JSON.parse(fs.readFileSync(path.join(resultsDirectory, latest.run, 'results.json'), 'utf8'));
    } catch {
      throw new Error('No readable test results; run an explicit test scope before using --failed.');
    }
    if (previous.version !== 1 || previous.complete !== true || !Array.isArray(previous.failedFiles)
      || !previous.failedFiles.length || previous.failedFiles.some((file) => !files.includes(file))) {
      throw new Error('No complete failed-file selection; run an explicit test scope before using --failed.');
    }
    failedFiles = new Set(previous.failedFiles);
  }
  const selectedFiles = groups[group].filter((file) =>
    (!selectedDomains.size || selectedDomains.has(file.split('/')[1])) &&
    (!failedFiles || failedFiles.has(file)) &&
    (!filePatterns.size || [...filePatterns].some((pattern) => path.matchesGlob(file, pattern))),
  );
  if (help) {
    console.log('Usage: npm test -- [group] [--domain=<directory>] [--file=<path-or-glob>] [--failed] [--list] [Node test options]');
    console.log(`Groups: ${Object.keys(groups).join(', ')}`);
    console.log(`Domains: ${domains.join(', ')}`);
    console.log('Repeat --domain to select multiple domains; the group limits their runtime dependencies.');
    console.log('Repeat --file to combine test/ paths or quoted globs; files are deduplicated and intersected with the group and domains.');
    console.log('Node --test-name-pattern filters cases inside the selected files; it does not prevent other files from loading.');
    console.log('--failed selects failed files from the last completed run; it does not replace full release acceptance.');
  } else if (!selectedFiles.length) {
    throw new Error(`No tests selected for group ${group}, domains ${[...selectedDomains].join(', ')}, files ${[...filePatterns].join(', ')}`);
  } else if (list) {
    console.log(selectedFiles.join('\n'));
  } else {
    const scope = selectedFiles.length === files.length ? 'full' : 'partial';
    console.log(`[test] File scope: ${scope} (${selectedFiles.length}/${files.length}); group=${group}`);
    fs.mkdirSync(resultsDirectory, { recursive: true });
    const runDirectory = fs.mkdtempSync(path.join(resultsDirectory, 'run-'));
    const savedPath = path.join(runDirectory, 'results.json');
    const results = { version: 1, complete: false, scope, selectedFiles, failedFiles: [], files: [], failures: [] };
    // Point to the newest attempt at start; an older run finishing cannot replace it.
    fs.writeFileSync(savedPath, JSON.stringify(results));
    const latestTemporaryPath = `${latestResultsPath}.${process.pid}.tmp`;
    fs.writeFileSync(latestTemporaryPath, JSON.stringify({ version: 1, run: path.basename(runDirectory) }));
    fs.renameSync(latestTemporaryPath, latestResultsPath);
    const reporterArgs = [];
    const reporterCount = nodeArgs.filter((arg) => /^--test-reporter(?:=|$)/.test(arg)).length;
    const destinationCount = nodeArgs.filter((arg) => /^--test-reporter-destination(?:=|$)/.test(arg)).length;
    if (!reporterCount && !destinationCount) reporterArgs.push('--test-reporter=spec', '--test-reporter-destination=stdout');
    else if (reporterCount === 1 && !destinationCount) reporterArgs.push('--test-reporter-destination=stdout');
    // Native ownership queries keep their production deadline; run them without
    // competing browser, Electron or installer processes from the rest of the suite.
    const nativeOwnershipFile = 'test/desktop/local-instance-windows.test.js';
    const batches = [
      selectedFiles.filter((file) => file === nativeOwnershipFile),
      selectedFiles.filter((file) => file !== nativeOwnershipFile),
    ];
    let complete = true;
    for (const [index, batch] of batches.entries()) {
      if (!batch.length) continue;
      const reportPath = path.join(runDirectory, `batch-${index}.json`);
      const result = spawnSync(
        process.execPath,
        buildNodeArguments({ nodeArgs, reporterArgs, reportPath, batch }),
        { cwd: root, stdio: 'inherit', windowsHide: true },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) process.exitCode = result.status ?? 1;
      let report;
      try {
        report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      } catch {
        complete = false;
      }
      if (report?.version !== 1 || report.complete !== true) complete = false;
      else {
        results.files.push(...report.files);
        results.failures.push(...report.failures);
        if (result.status !== 0 && !report.failures.length) complete = false;
      }
    }
    results.complete = complete;
    results.failedFiles = [...new Set(results.failures.map(({ file }) => file))];
    if (results.failedFiles.some((file) => !selectedFiles.includes(file))) results.complete = false;
    const temporaryPath = `${savedPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(results, null, 2));
    fs.renameSync(temporaryPath, savedPath);
    console.log(`[test] Results: ${path.relative(root, savedPath).replaceAll('\\', '/')}`);
    if (!results.complete) console.error('[test] Results are incomplete; use an explicit test scope for diagnosis.');
    const slowest = results.files.filter(({ durationMs }) => Number.isFinite(durationMs))
      .sort((left, right) => right.durationMs - left.durationMs).slice(0, 5);
    for (const { file, durationMs } of slowest) console.log(`[test] Duration: ${(durationMs / 1000).toFixed(2)}s ${file}`);
    if (results.complete && results.failedFiles.length) {
      console.log(`[test] Failed files (${results.failedFiles.length}):\n${results.failedFiles.join('\n')}`);
      console.log('[test] Focused rerun: npm test -- --failed');
    }
  }
}

if (require.main === module) main();

module.exports = { buildNodeArguments, defaultConcurrency };
