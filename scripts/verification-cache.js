'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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
    throw new Error('Cached verification requires plain Node without NODE_OPTIONS or parent Node flags; run node --check directly for custom diagnostics.');
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

module.exports = {
  digest, hashFile, readJson, proofPath, hasProof, revoke, saveProof,
  nodeEnvironment, assertCacheOptions, acquireLock,
};
