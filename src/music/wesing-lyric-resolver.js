'use strict';

const { findLatestSongEntry, loadWeSingLyrics } = require('./wesing-cache');

async function resolveWeSingLyrics({ cachePath, title, cacheReady, durationMs, resolveFallbackLyrics, logEntry,
  readLogEntry = findLatestSongEntry, loadLyrics = loadWeSingLyrics, forceOnline = false }) {
  let result = null;
  let fallbackError = null;
  let detectedArtist = '';
  try {
    if (logEntry === undefined) logEntry = await readLogEntry(cachePath, title);
    detectedArtist = String(logEntry?.artist || '').trim();
  } catch (_) {
    detectedArtist = '';
  }

  if (cacheReady) {
    try {
      result = await loadLyrics({ cachePath, title, logEntry });
      if (result) {
        result.source = 'wesing';
        if (!result.artists.length && detectedArtist) result.artists = [detectedArtist];
      }
    } catch (_) {
      result = null;
    }
  }

  if (!result && resolveFallbackLyrics) {
    try {
      const fallbackInput = { title, durationMs };
      if (detectedArtist) {
        fallbackInput.artist = detectedArtist;
        fallbackInput.artists = [detectedArtist];
      }
      result = await resolveFallbackLyrics(fallbackInput, { songMid: logEntry?.mid || '', force: forceOnline });
    } catch (error) {
      fallbackError = error;
    }
  }

  return { result, fallbackError, songMid: logEntry?.mid || '' };
}

module.exports = { resolveWeSingLyrics };
