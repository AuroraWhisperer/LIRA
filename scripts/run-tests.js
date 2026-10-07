'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
// These files launch a runtime or read the pinned server checkout. All other
// tests use Node, VM modules and isolated local HTTP/SQLite fixtures.
const groups = {
  browser: [
    'admin/canvas-browser-source',
    'admin/canvas-editing',
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
    'bots/daily-bot-frontend',
    'danmaku/frontend-admin-danmaku',
    'danmaku/danmaku-feed-motion',
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
    'admin/shared-ui-interactions',
    'admin/song-board-settings',
    'admin/text-box-editor',
  ],
  desktop: [
    'desktop/background-filters-electron',
    'desktop/danmaku-canvas-electron',
    'engineering/build-integrity',
    'desktop/desktop-auth-race-electron',
    'desktop/desktop-request-auth-electron',
    'desktop/electron-data-layout',
    'desktop/local-instance-windows',
    'desktop/resource-lifecycle-electron',
    'desktop/resource-integrity-electron',
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

const testArgs = process.argv.slice(2);
const group = testArgs[0]?.startsWith('--') ? 'all' : testArgs.shift() || 'all';
if (!Object.hasOwn(groups, group)) {
  throw new Error(`Unknown test group ${group}; use ${Object.keys(groups).join(', ')}`);
}
const domains = [...new Set(files.map((file) => file.split('/')[1]))].sort();
const selectedDomains = new Set();
const filePatterns = new Set();
const nodeArgs = [];
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
  } else if (arg === '--list') {
    list = true;
  } else if (arg === '--help') {
    help = true;
  } else {
    nodeArgs.push(arg);
  }
}
const selectedFiles = groups[group].filter((file) =>
  (!selectedDomains.size || selectedDomains.has(file.split('/')[1])) &&
  (!filePatterns.size || [...filePatterns].some((pattern) => path.matchesGlob(file, pattern))),
);
if (help) {
  console.log('Usage: npm test -- [group] [--domain=<directory>] [--file=<path-or-glob>] [--list] [Node test options]');
  console.log(`Groups: ${Object.keys(groups).join(', ')}`);
  console.log(`Domains: ${domains.join(', ')}`);
  console.log('Repeat --domain to select multiple domains; the group limits their runtime dependencies.');
  console.log('Repeat --file to combine test/ paths or quoted globs; files are deduplicated and intersected with the group and domains.');
  console.log('Node --test-name-pattern filters cases inside the selected files; it does not prevent other files from loading.');
} else if (!selectedFiles.length) {
  throw new Error(`No tests selected for group ${group}, domains ${[...selectedDomains].join(', ')}, files ${[...filePatterns].join(', ')}`);
} else if (list) {
  console.log(selectedFiles.join('\n'));
} else {
  const scope = selectedFiles.length === files.length ? 'full' : 'partial';
  console.log(`[test] File scope: ${scope} (${selectedFiles.length}/${files.length}); group=${group}`);
  // Native ownership queries keep their production deadline; run them without
  // competing browser, Electron or installer processes from the rest of the suite.
  const nativeOwnershipFile = 'test/desktop/local-instance-windows.test.js';
  const batches = [
    selectedFiles.filter((file) => file === nativeOwnershipFile),
    selectedFiles.filter((file) => file !== nativeOwnershipFile),
  ];
  for (const batch of batches) {
    if (!batch.length) continue;
    const result = spawnSync(
      process.execPath,
      ['--experimental-vm-modules', '--test', '--test-concurrency=6', ...nodeArgs, ...batch],
      { cwd: root, stdio: 'inherit', windowsHide: true },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
}
