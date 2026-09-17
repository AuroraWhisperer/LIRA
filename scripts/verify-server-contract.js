'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LOCK_PATH = path.resolve(__dirname, '../server-contract.lock.json');

function resolveServerRoot(serverRoot) {
  return path.resolve(
    serverRoot ||
      process.env.LIRA_SERVER_ROOT ||
      path.join(__dirname, '../../lira-server'),
  );
}

function contractError(code, message) {
  return Object.assign(new Error(message), { code });
}

function git(serverRoot, args) {
  try {
    return execFileSync(
      'git',
      ['--no-optional-locks', '-C', serverRoot, ...args],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    ).trim();
  } catch {
    throw contractError(
      'SERVER_CONTRACT_CHECKOUT_REQUIRED',
      `Cannot inspect the server Git checkout at ${serverRoot}. Install Git and set LIRA_SERVER_ROOT to the pinned server checkout.`,
    );
  }
}

function verifyServerContract({ serverRoot, runtime = false } = {}) {
  const root = resolveServerRoot(serverRoot);
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  if (lock.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(lock.revision)) {
    throw contractError(
      'SERVER_CONTRACT_LOCK_INVALID',
      'server-contract.lock.json must declare schemaVersion 1 and a full commit SHA.',
    );
  }
  const checkoutRoot = git(root, ['rev-parse', '--show-toplevel']);
  if (fs.realpathSync(root) !== fs.realpathSync(checkoutRoot)) {
    throw contractError(
      'SERVER_CONTRACT_CHECKOUT_ROOT_REQUIRED',
      `Server root must be the checkout top-level directory: ${checkoutRoot}. Set LIRA_SERVER_ROOT to that directory.`,
    );
  }
  const revision = git(root, ['rev-parse', '--verify', 'HEAD']);
  if (revision !== lock.revision) {
    throw contractError(
      'SERVER_CONTRACT_REVISION_MISMATCH',
      `Server revision mismatch at ${root}: expected ${lock.revision}, found ${revision}. Prepare a separate checkout of ${lock.repository} at the pinned commit and set LIRA_SERVER_ROOT.`,
    );
  }
  const fixtures = new Map();
  for (const [relativePath, expectedHash] of Object.entries(lock.fixtures)) {
    let bytes;
    try {
      bytes = fs.readFileSync(path.join(root, relativePath));
    } catch {
      throw contractError(
        'SERVER_CONTRACT_FIXTURE_MISSING',
        `Missing server fixture ${relativePath} at ${root}. Prepare the complete pinned checkout.`,
      );
    }
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== expectedHash) {
      throw contractError(
        'SERVER_CONTRACT_FIXTURE_MISMATCH',
        `Server fixture content mismatch: ${relativePath}. Use the unchanged file from pinned revision ${lock.revision}; fixture updates require an explicit lock update.`,
      );
    }
    fixtures.set(relativePath, bytes);
  }
  if (runtime) {
    const changes = git(root, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      'src',
      'package.json',
      'package-lock.json',
    ]);
    if (changes) {
      throw contractError(
        'SERVER_CONTRACT_RUNTIME_DIRTY',
        `Server runtime inputs differ from pinned revision ${lock.revision} at ${root}. Use a clean checkout for the roundtrip check.\n${changes}`,
      );
    }
  }
  return { serverRoot: root, revision, fixtures };
}

function readServerFixture(relativePath, options) {
  const { fixtures } = verifyServerContract(options);
  if (!fixtures.has(relativePath)) {
    throw contractError(
      'SERVER_CONTRACT_FIXTURE_UNDECLARED',
      `Server fixture is not declared in server-contract.lock.json: ${relativePath}`,
    );
  }
  return JSON.parse(fixtures.get(relativePath).toString('utf8'));
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const paths = args.filter((value) => value !== '--runtime');
    if (paths.length > 1 || paths.some((value) => value.startsWith('--'))) {
      throw new Error(
        'Usage: node scripts/verify-server-contract.js [--runtime] [server-root]',
      );
    }
    const result = verifyServerContract({
      serverRoot: paths[0],
      runtime: args.includes('--runtime'),
    });
    console.log(
      `Verified server ${result.revision}: ${result.fixtures.size} contract fixtures.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { resolveServerRoot, verifyServerContract, readServerFixture };
