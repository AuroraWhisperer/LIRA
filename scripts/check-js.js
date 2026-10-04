'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const cache = require('./verification-cache');

const rootDir = path.resolve(__dirname, '..');
function collectFiles(root) {
  const files = [];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.relative(root, target).replaceAll('\\', '/'));
    }
  }
  for (const source of ['src', 'public', 'scripts', 'test']) visit(path.join(root, source));
  return files.sort();
}

function moduleConfiguration(file) {
  let directory = path.dirname(file);
  const boundaries = [];
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        boundaries.push([manifest, data.type ?? null]);
      } catch {
        boundaries.push([manifest, cache.hashFile(manifest)]);
      }
      break;
    }
    boundaries.push([manifest, 'absent']);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return boundaries;
}

function createPlan(root, { force = false } = {}) {
  const environment = cache.nodeEnvironment();
  const checker = ['scripts/check-js.js', 'scripts/verification-cache.js'].map((file) => cache.hashFile(path.join(root, file)));
  return collectFiles(root).map((file) => {
    const absolute = path.join(root, file);
    const key = cache.digest([file, cache.hashFile(absolute), moduleConfiguration(absolute), checker, environment]);
    return { file, key, reuse: !force && cache.hasProof(root, 'syntax', file, key) };
  });
}

async function runSyntaxChecks({ root, plan, force, concurrency }) {
  const entries = createPlan(root, { force });
  const pending = entries.filter((entry) => !entry.reuse);
  console.log(`[syntax] ${entries.length} files: run ${pending.length}, reuse ${entries.length - pending.length}.`);
  if (plan) {
    for (const entry of pending) console.log(`RUN ${entry.file}`);
    return 0;
  }
  // Invalidate before spawning, including interrupted or failed forced runs.
  for (const entry of pending) cache.revoke(root, 'syntax', entry.file);
  const passed = [];
  let next = 0;
  let code = 0;
  async function worker() {
    while (!code && next < pending.length) {
      const entry = pending[next++];
      const started = performance.now();
      try {
        const child = spawn(process.execPath, ['--check', path.join(root, entry.file)], {
          cwd: root, stdio: 'inherit', windowsHide: true,
        });
        const [status] = await once(child, 'close');
        if (status !== 0) code ||= status || 1;
        else passed.push({ ...entry, durationMs: performance.now() - started });
      } catch (error) {
        console.error(`Unable to check ${entry.file}: ${error.message}`);
        code ||= 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  const after = createPlan(root);
  if (cache.digest(entries.map(({ file, key }) => [file, key])) !== cache.digest(after.map(({ file, key }) => [file, key]))) {
    for (const entry of entries) cache.revoke(root, 'syntax', entry.file);
    console.error('Syntax inputs changed during verification; no results were recorded.');
    return 1;
  }
  for (const entry of passed) cache.saveProof(root, 'syntax', entry.file, entry.key, entry.durationMs);
  if (!code) console.log(`Syntax check passed for ${entries.length} JavaScript files.`);
  return code;
}

async function checkJavaScript({ root = rootDir, plan = false, force = false, concurrency = Math.min(4, os.availableParallelism()) } = {}) {
  cache.assertCacheOptions();
  const release = plan ? () => {} : cache.acquireLock(root, 'syntax');
  try {
    return await runSyntaxChecks({ root, plan, force, concurrency });
  } finally {
    release();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--plan', '--force'].includes(arg))) {
    console.error('Usage: npm run check -- [--plan] [--force]');
    process.exitCode = 1;
  } else {
    checkJavaScript({ plan: args.includes('--plan'), force: args.includes('--force') }).then((code) => {
      process.exitCode = code;
    }).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}

module.exports = { collectFiles, moduleConfiguration, createPlan, checkJavaScript };
