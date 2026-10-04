'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fileBuffer = Buffer.allocUnsafe(1024 * 1024);

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hashFile(file) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'r');
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
  const hash = crypto.createHash('sha256');
  try {
    let length;
    while ((length = fs.readSync(descriptor, fileBuffer, 0, fileBuffer.length, null))) hash.update(fileBuffer.subarray(0, length));
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function hashTree(directory, ancestors = new Set(), ignoredFiles = new Set()) {
  if (!directory || !fs.existsSync(directory)) return 'missing';
  const resolved = fs.realpathSync(directory);
  if (ancestors.has(resolved)) throw new Error(`Circular verification input: ${directory}`);
  if (!fs.statSync(resolved).isDirectory()) return hashFile(resolved);
  function visit(target, parents) {
    const next = new Set([...parents, target]);
    return digest(fs.readdirSync(target, { withFileTypes: true })
      .filter((entry) => !entry.isFile() || !ignoredFiles.has(path.relative(resolved, path.join(target, entry.name))))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const child = path.join(target, entry.name);
        const hash = entry.isFile() ? hashFile(child)
          : entry.isDirectory() ? visit(child, next) : hashTree(child, next);
        return [entry.name, hash];
      }));
  }
  return visit(resolved, ancestors);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function proofPath(root, kind, file) {
  return path.join(root, 'tmp/verification', kind, `${digest(file)}.json`);
}

function hasProof(root, kind, file, key) {
  const record = readJson(proofPath(root, kind, file));
  return record?.version === 1 && record.file === file && record.key === key
    && record.status === 'passed' && Number.isFinite(record.durationMs) && record.durationMs >= 0;
}

function revoke(root, kind, file) {
  fs.rmSync(proofPath(root, kind, file), { force: true });
}

function saveProof(root, kind, file, key, durationMs) {
  const target = proofPath(root, kind, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, file, key, status: 'passed', durationMs }));
  fs.renameSync(temporary, target);
}

function nodeEnvironment() {
  return {
    executable: fs.realpathSync(process.execPath), binary: hashFile(process.execPath),
    versions: process.versions, platform: process.platform, arch: process.arch,
    nodeOptions: process.env.NODE_OPTIONS || '',
  };
}

function assertCacheOptions() {
  if (process.env.NODE_OPTIONS?.trim() || process.execArgv.length) {
    throw new Error('Cached verification requires plain Node without NODE_OPTIONS or parent Node flags; use npm test for custom diagnostics.');
  }
}

function acquireLock(root, kind) {
  const directory = path.join(root, 'tmp/verification');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${kind}.lock`);
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Verification already locked: ${file}. Remove a stale lock only after its process has stopped.`);
    throw error;
  }
  fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
  fs.closeSync(descriptor);
  return () => fs.rmSync(file, { force: true });
}

function repositoryInputs(root) {
  root = path.resolve(root);
  const options = { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 };
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], options).trim();
  if (fs.realpathSync(top) !== fs.realpathSync(root)) throw new Error('Verification requires the Git checkout root.');
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    ...options,
  });
  const checkedDirectories = new Set();
  return [...new Set(output.split('\0').filter(Boolean))].sort().map((file) => {
    const absolute = path.join(root, file);
    for (let directory = path.dirname(absolute); directory !== root && !checkedDirectories.has(directory); directory = path.dirname(directory)) {
      const entry = fs.lstatSync(directory, { throwIfNoEntry: false });
      if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw new Error(`Unsupported linked verification input: ${file}`);
      checkedDirectories.add(directory);
    }
    const entry = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (entry && (!entry.isFile() || entry.isSymbolicLink())) throw new Error(`Verification input must be a regular file: ${file}`);
    return [file, entry ? hashFile(absolute) : 'missing'];
  });
}

function testEnvironment(root) {
  // Store only a digest, never environment values (which may contain credentials).
  const invocationVariables = new Set(['npm_lifecycle_event', 'npm_lifecycle_script', 'npm_command', 'npm_config_argv', 'node_test_context', 'init_cwd']);
  const environment = Object.entries(process.env).filter(([name]) => !invocationVariables.has(name.toLowerCase()))
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    node: nodeEnvironment(), os: [os.release(), os.version()], environment: digest(environment),
    // The installed bytes matter too: a lockfile alone cannot detect changed or missing tools.
    dependencies: hashTree(path.join(root, 'node_modules')),
    electronOverride: process.env.ELECTRON_OVERRIDE_DIST_PATH
      ? hashTree(process.env.ELECTRON_OVERRIDE_DIST_PATH) : null,
  };
}

module.exports = {
  digest, hashFile, hashTree, readJson, proofPath, hasProof, revoke, saveProof,
  nodeEnvironment, repositoryInputs, testEnvironment, assertCacheOptions, acquireLock,
};
