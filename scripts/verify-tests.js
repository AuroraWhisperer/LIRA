'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cache = require('./verification-cache');
const { createPlan } = require('./verification-test-inputs');
const { successfulFiles } = require('./verification-test-results');

function runTests({ root, files, allFiles, groups, batches, plan = false, force = false }) {
  const entries = createPlan(root, files, groups, { force });
  const pending = entries.filter((entry) => !entry.reuse);
  const scope = files.length === allFiles.length ? 'full' : 'partial';
  console.log(`[verify] ${scope} (${files.length}/${allFiles.length}): run ${pending.length}, reuse ${files.length - pending.length}.`);
  for (const entry of entries) console.log(`${entry.reuse ? 'REUSE' : 'RUN'} ${entry.file} (${entry.scope}, ${entry.inputs} inputs)`);
  if (plan) return 0;
  for (const entry of pending) cache.revoke(root, 'tests', entry.file);
  const pendingFiles = new Set(pending.map((entry) => entry.file));
  const passed = new Map();
  let code = 0;
  if (pending.length) {
    const runs = path.join(root, 'tmp/verification/runs');
    fs.mkdirSync(runs, { recursive: true });
    const directory = fs.mkdtempSync(path.join(runs, 'tests-'));
    for (const [index, batch] of batches.entries()) {
      const selected = batch.filter((file) => pendingFiles.has(file));
      if (!selected.length) continue;
      const reportPath = path.join(directory, `${index}.json`);
      const result = spawnSync(process.execPath, [
        '--experimental-vm-modules', '--test', '--test-concurrency=6',
        '--test-reporter=spec', '--test-reporter-destination=stdout',
        '--test-reporter=./scripts/verification-test-reporter.js', `--test-reporter-destination=${reportPath}`,
        ...selected,
      ], { cwd: root, stdio: 'inherit', windowsHide: true });
      if (result.error) console.error(result.error.message);
      code ||= result.status ?? 1;
      const successes = successfulFiles(root, cache.readJson(reportPath), selected, result.status);
      for (const entry of successes) passed.set(entry.file, entry.durationMs);
      if (successes.length !== selected.length) code ||= 1;
    }
  }
  const after = createPlan(root, files, groups);
  const inventory = spawnSync(process.execPath, [path.join(root, 'scripts/run-tests.js'), '--list'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  const inventoryChanged = inventory.status !== 0
    || cache.digest(inventory.stdout.trim().split(/\r?\n/).sort()) !== cache.digest([...allFiles].sort());
  if (cache.digest(entries.map(({ file, key }) => [file, key])) !== cache.digest(after.map(({ file, key }) => [file, key]))
      || (scope === 'full' && inventoryChanged)) {
    for (const entry of entries) cache.revoke(root, 'tests', entry.file);
    console.error('Test inputs changed during verification; no results were recorded.');
    return 1;
  }
  for (const entry of pending) {
    if (passed.has(entry.file)) cache.saveProof(root, 'tests', entry.file, entry.key, passed.get(entry.file));
  }
  if (code) console.error('Verification incomplete: failed, skipped, interrupted or unreported tests have no reusable proof.');
  else console.log(`[verify] ${scope} verification passed (${files.length}/${allFiles.length} complete files).`);
  return code;
}

function verifyTests(options) {
  cache.assertCacheOptions();
  const release = options.plan ? () => {} : cache.acquireLock(options.root, 'tests');
  try {
    return runTests(options);
  } finally {
    release();
  }
}

module.exports = { verifyTests };
