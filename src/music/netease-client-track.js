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

function readNeteaseClientTrack(sample, {
  localAppData = process.env.LOCALAPPDATA,
  openDatabase = (filename, options) => new (require('node:sqlite').DatabaseSync)(filename, options),
} = {}) {
  if (!localAppData) return null;
  const root = path.join(localAppData, 'NetEase', 'CloudMusic');
  let database;
  let row;
  try {
    database = openDatabase(path.join(root, 'Library', 'webdb.dat'), { readOnly: true, timeout: 100 });
    row = database.prepare('SELECT jsonStr FROM historyTracks ORDER BY playtime DESC LIMIT 1').get();
  } catch (_) {
    // A missing, locked or changed client database falls back to the older history format.
    row = null;
  } finally {
    database?.close();
  }
  if (row) {
    try { return matchNeteaseRecord(JSON.parse(row.jsonStr), sample); } catch (_) { return null; }
  }
  try {
    const filename = path.join(root, 'webdata', 'file', 'history');
    if (fs.statSync(filename).size > 8 * 1024 * 1024) return null;
    const records = JSON.parse(fs.readFileSync(filename, 'utf8'));
    return matchNeteaseRecord(records?.[0]?.track, sample);
  } catch (_) {
    return null;
  }
}

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

module.exports = { parseNeteaseWindowTitle, readNeteaseClientTrack, matchNeteaseRecord };
