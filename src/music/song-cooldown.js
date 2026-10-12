'use strict';

const { cleanText } = require('../shared/utils');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BEIJING_OFFSET_MS = 8 * HOUR_MS;

function songCooldownKey(songName, artist) {
  return JSON.stringify([songName, artist].map((value) => cleanText(value).normalize('NFKC').toLowerCase()));
}

function songCooldownUntil(settings, acceptedAt) {
  if (acceptedAt === null || acceptedAt === undefined || settings.songCooldownMode === 'off') return 0;
  const value = Number(settings.songCooldownValue);
  if (!Number.isInteger(value) || value < 1) return 0;
  if (settings.songCooldownMode === 'hours') return acceptedAt + value * HOUR_MS;
  if (settings.songCooldownMode === 'days') {
    return (Math.floor((acceptedAt + BEIJING_OFFSET_MS) / DAY_MS) + value) * DAY_MS - BEIJING_OFFSET_MS;
  }
  return 0;
}

function assertSongAvailable(settings, acceptedAt, songName, at) {
  const availableAt = songCooldownUntil(settings, acceptedAt);
  if (availableAt <= at) return;
  let timing;
  if (settings.songCooldownMode === 'days') {
    const days = Math.floor((availableAt + BEIJING_OFFSET_MS) / DAY_MS) - Math.floor((at + BEIJING_OFFSET_MS) / DAY_MS);
    const date = new Date(availableAt + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
    timing = `${days === 1 ? '明天' : days === 2 ? '后天' : date} 00:00 后可再点`;
  } else {
    const minutes = Math.ceil((availableAt - at) / 60000);
    const hours = Math.floor(minutes / 60);
    timing = `还需 ${hours ? `${hours}小时` : ''}${minutes % 60 ? `${minutes % 60}分` : ''}`;
  }
  throw Object.assign(new Error(`《${songName}》冷却中，${timing}。`), {
    code: 'SONG_COOLDOWN', availableAt,
  });
}

module.exports = { songCooldownKey, songCooldownUntil, assertSongAvailable };
