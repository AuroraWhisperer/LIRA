'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createWeSingCacheReader, safeInitialCachePath } = require('./wesing-cache');

async function getFixedDriveRoots() {
  if (process.platform !== 'win32') return [];
  const command = "[IO.DriveInfo]::GetDrives() | Where-Object DriveType -eq Fixed | ForEach-Object Name";
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 5000 });
    return stdout.trim().split(/\r?\n/).filter(root => /^[A-Z]:\\$/i.test(root));
  } catch {
    return [];
  }
}

function getWeSingCacheCandidates(environment = process.env, roots = []) {
  const profilePaths = [environment.APPDATA, environment.LOCALAPPDATA]
    .filter(Boolean)
    .map((directory) => path.join(directory, 'Tencent', 'WeSing', 'WeSingCache'));
  return [...profilePaths, ...roots.map(root => path.join(root, 'WeSingCache'))];
}

async function discoverWeSingCachePath({ cachePath, title = '', includeDriveRoots = true, candidates,
  readCache = createWeSingCacheReader().read } = {}) {
  candidates ??= getWeSingCacheCandidates(process.env, includeDriveRoots ? await getFixedDriveRoots() : []);
  const savedPath = safeInitialCachePath(cachePath);
  const uniquePaths = new Map();
  for (const candidate of [savedPath, ...candidates]) {
    const normalized = safeInitialCachePath(candidate);
    if (normalized) uniquePaths.set(normalized.toLowerCase(), normalized);
  }
  const results = await Promise.all([...uniquePaths.values()].map(async (candidate) => {
    const snapshot = await readCache(candidate, title);
    if (!snapshot.cacheReady) return null;
    return { path: candidate, modifiedMs: snapshot.logEntry ? snapshot.log?.modifiedMs || 0 : 0 };
  }));
  const matches = results.filter(Boolean);
  const active = matches.filter((candidate) => candidate.modifiedMs > 0)
    .sort((left, right) => right.modifiedMs - left.modifiedMs);
  if (active.length && (active.length === 1 || active[0].modifiedMs > active[1].modifiedMs)) return active[0].path;
  if (matches.some((candidate) => candidate.path === savedPath)) return savedPath;
  return matches.length === 1 ? matches[0].path : '';
}

module.exports = { discoverWeSingCachePath, getWeSingCacheCandidates };
