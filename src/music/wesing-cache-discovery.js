'use strict';

const path = require('node:path');
const { findLatestSongEntry, findLatestWeSingLog, hasWeSingCacheData, safeInitialCachePath } = require('./wesing-cache');

function getWeSingCacheCandidates(environment = process.env) {
  const profilePaths = [environment.APPDATA, environment.LOCALAPPDATA]
    .filter(Boolean)
    .map((directory) => path.join(directory, 'Tencent', 'WeSing', 'WeSingCache'));
  const drivePaths = Array.from({ length: 24 }, (_, index) => `${String.fromCharCode(67 + index)}:\\WeSingCache`);
  return [...profilePaths, ...drivePaths];
}

async function discoverWeSingCachePath({ cachePath, title = '', candidates = getWeSingCacheCandidates() } = {}) {
  const savedPath = safeInitialCachePath(cachePath);
  const uniquePaths = new Map();
  for (const candidate of [savedPath, ...candidates]) {
    const normalized = safeInitialCachePath(candidate);
    if (normalized) uniquePaths.set(normalized.toLowerCase(), normalized);
  }
  const results = await Promise.all([...uniquePaths.values()].map(async (candidate) => {
    if (!await hasWeSingCacheData(candidate)) return null;
    const entry = await findLatestSongEntry(candidate, title).catch(() => null);
    const log = entry ? await findLatestWeSingLog(candidate).catch(() => null) : null;
    return { path: candidate, modifiedMs: log?.modifiedMs || 0 };
  }));
  const matches = results.filter(Boolean);
  const active = matches.filter((candidate) => candidate.modifiedMs > 0)
    .sort((left, right) => right.modifiedMs - left.modifiedMs);
  if (active.length && (active.length === 1 || active[0].modifiedMs > active[1].modifiedMs)) return active[0].path;
  if (matches.some((candidate) => candidate.path === savedPath)) return savedPath;
  return matches.length === 1 ? matches[0].path : '';
}

module.exports = { discoverWeSingCachePath, getWeSingCacheCandidates };
