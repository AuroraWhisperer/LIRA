'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
// These files launch a runtime or read the pinned server checkout. All other
// tests use Node, VM modules and isolated local HTTP/SQLite fixtures.
const groups = {
  browser: [
    'daily-bot-frontend',
    'frontend-admin-danmaku',
    'frontend-gift-display-settings',
    'frontend-gift-feed',
    'frontend-gift-history-selection',
    'frontend-gift-wishes',
    'frontend-toast',
    'ui-edit-state',
  ],
  desktop: [
    'build-integrity',
    'desktop-request-auth-electron',
    'electron-data-layout',
    'local-instance-windows',
  ],
  installer: [
    'installer-app-exit',
    'installer-diagnostics',
    'installer-directory',
    'installer-migration',
    'installer-uninstall',
  ],
  contracts: [
    'frontend-gifts-panel',
    'gift-category',
    'gift-identity-catalog',
    'license-password-contract',
    'overtime-gift-picker',
    'processed-gift-contract',
    'processed-gift-import',
    'processed-gift-source',
  ],
};
const files = fs.readdirSync(path.join(root, 'test'))
  .filter((file) => file.endsWith('.test.js'))
  .map((file) => `test/${file}`)
  .sort();
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
const group = testArgs[0]?.startsWith('--') ? 'all' : (testArgs.shift() || 'all');
if (!Object.hasOwn(groups, group)) {
  throw new Error(`Unknown test group ${group}; use ${Object.keys(groups).join(', ')}`);
}
if (testArgs.includes('--list')) {
  console.log(groups[group].join('\n'));
} else {
  const result = spawnSync(process.execPath, [
    '--experimental-vm-modules', '--test', '--test-concurrency=6',
    ...testArgs, ...groups[group],
  ], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
