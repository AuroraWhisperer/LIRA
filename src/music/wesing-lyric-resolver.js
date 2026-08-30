'use strict';

const { findLatestSongEntry, loadWeSingLyrics } = require('./wesing-cache');

async function resolveWeSingLyrics({
  cachePath,
  title,
  cacheReady,
  durationMs,
  resolveFallbackLyrics,
}) {
  let result = null;
  let fallbackError = null;
  let detectedArtist = '';

  try {
    const logEntry = await findLatestSongEntry(cachePath, title);
    detectedArtist = String(logEntry?.artist || '').trim();
  } catch (_) {
    detectedArtist = '';
  }

  if (cacheReady) {
    try {
      result = await loadWeSingLyrics({ cachePath, title });
      if (result) result.source = 'wesing';
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
      result = await resolveFallbackLyrics(fallbackInput);
    } catch (error) {
      fallbackError = error;
    }
  }

  return { result, fallbackError };
}

module.exports = { resolveWeSingLyrics };
