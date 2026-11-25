'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseNeteaseWindowTitle(value) {
  const windowTitle = String(value || '').trim();
  if (!windowTitle || windowTitle.includes('MediaPlayer')) return null;
  const separator = windowTitle.lastIndexOf(' - ');
  if (separator <= 0 || separator + 3 >= windowTitle.length) return null;
  return {
    title: windowTitle.slice(0, separator).trim(),
    artists: windowTitle.slice(separator + 3).split(/\s*\/\s*/).filter(Boolean),
  };
}

function createNeteaseTrackReader({
  localAppData = process.env.LOCALAPPDATA,
  openDatabase = (filename, options) => new (require('node:sqlite').DatabaseSync)(filename, options),
} = {}) {
  let dbStamp, latestRecord, historyStamp, latestHistory;
  return async function readTrack(sample) {
    if (!localAppData) return null;
    const root = path.join(localAppData, 'NetEase', 'CloudMusic');
    const dbPath = path.join(root, 'Library', 'webdb.dat');
    const [db, wal] = await Promise.all([dbPath, `${dbPath}-wal`].map(fileStat));
    if (db) {
      const stamp = `${fingerprint(db)}:${fingerprint(wal)}`;
      let database;
      try {
        if (dbStamp !== stamp) {
          database = openDatabase(dbPath, { readOnly: true, timeout: 100 });
          const row = database.prepare('SELECT jsonStr FROM historyTracks ORDER BY playtime DESC LIMIT 1').get();
          // Only an empty table falls through to the legacy history. A malformed current row cannot identify a track.
          try { latestRecord = row && JSON.parse(row.jsonStr); } catch (_) { latestRecord = null; }
          dbStamp = stamp;
        }
        if (latestRecord !== undefined) return matchNeteaseRecord(latestRecord, sample);
      } catch (_) {
        // A busy DB is retryable even if its timestamps do not change.
        dbStamp = undefined;
      } finally {
        database?.close();
      }
    }
    const filename = path.join(root, 'webdata', 'file', 'history');
    const stat = await fileStat(filename);
    if (!stat || stat.size > 8 * 1024 * 1024) return null;
    const stamp = fingerprint(stat);
    try {
      if (historyStamp !== stamp) {
        latestHistory = JSON.parse(await fs.promises.readFile(filename, 'utf8'))?.[0]?.track;
        historyStamp = stamp;
      }
      return matchNeteaseRecord(latestHistory, sample);
    } catch (_) { return null; }
  };
}

const fileStat = (filename) => fs.promises.stat(filename, { bigint: true }).catch(() => null);
const fingerprint = (stat) => stat ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` : '';

function matchNeteaseRecord(record, sample) {
  if (!record || !sample) return null;
  const title = String(record.name || '').trim();
  const artistRecords = record.artists || record.ar;
  const artists = (Array.isArray(artistRecords) ? artistRecords : []).map((artist) => String(artist?.name || '').trim()).filter(Boolean);
  const sourceTrackId = String(record.id || '');
  if (!title || !artists.length || !/^[1-9]\d{0,31}$/.test(sourceTrackId) ||
    (typeof record.id === 'number' && !Number.isSafeInteger(record.id))) return null;
  const matchesWindow = sample.windowTitle && normalize(`${title} - ${artists.join(' / ')}`) === normalize(sample.windowTitle);
  const sampleArtists = sample.artists || (sample.artist ? [sample.artist] : []);
  const matchesMetadata = !sample.windowTitle && normalize(sample.title) === normalize(title) &&
    normalize(sampleArtists.join(' / ')) === normalize(artists.join(' / '));
  if (!matchesWindow && !matchesMetadata) return null;
  const durationMs = Number(record.duration || record.dt) || 0;
  if (sample.durationMs > 0 && durationMs > 0 && Math.abs(sample.durationMs - durationMs) > 2000) return null;
  return { title, artists, sourceTrackId, durationMs };
}

function normalize(value) {
  return String(value || '').normalize('NFKC').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim().toLowerCase();
}

module.exports = { parseNeteaseWindowTitle, createNeteaseTrackReader, matchNeteaseRecord };
