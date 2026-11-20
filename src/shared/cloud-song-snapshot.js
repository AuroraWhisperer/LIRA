'use strict';

// Device song fields are measured in UTF-16 code units after trimming.
const SONG_TEXT_LIMITS = [
  ['title', 200, 'SONG_TITLE_TOO_LONG'],
  ['artist', 200, 'SONG_ARTIST_TOO_LONG'],
  ['categoryName', 120, 'SONG_CATEGORY_TOO_LONG'],
  ['tags', 500, 'SONG_TAGS_TOO_LONG'],
  ['language', 80, 'SONG_LANGUAGE_TOO_LONG'],
  ['sourcePlatform', 80, 'SONG_PLATFORM_TOO_LONG'],
  ['note', 1000, 'SONG_NOTE_TOO_LONG'],
  ['requestPrice', 1000, 'SONG_PRICE_TOO_LONG'],
  ['songClip', 1000, 'SONG_CLIP_TOO_LONG'],
];

function mapSongForSync(song = {}) {
  const enabled = song.enabled ?? song.isEnabled ?? song.is_enabled ?? true;
  const rawRequestPrice = song.requestPrice !== undefined ? song.requestPrice : song.request_price;
  const requestPrice =
    rawRequestPrice === undefined || rawRequestPrice === null
      ? null
      : typeof rawRequestPrice === 'string'
        ? rawRequestPrice.trim() || null
        : rawRequestPrice;
  return {
    title: String(song.title ?? song.name ?? '').trim(),
    artist: String(song.artist ?? '').trim(),
    categoryName: String(song.categoryName ?? song.category_name ?? '').trim(),
    tags: String(song.tags ?? '').trim(),
    language: String(song.language ?? '').trim(),
    sourcePlatform: String(song.sourcePlatform ?? song.source_platform ?? '').trim(),
    note: String(song.note ?? '').trim(),
    requestPrice,
    songClip: String(song.songClip ?? song.song_clip ?? '').trim(),
    enabled: !(enabled === false || enabled === 0 || String(enabled).toLowerCase() === 'false'),
    sortOrder: Number(song.sortOrder ?? song.sort_order ?? 0) || 0,
  };
}

function sameCloudSongs(left, right) {
  if (left.length !== right.length) return false;
  const sortedEntries = songs => songs.map(song => JSON.stringify(mapSongForSync(song))).sort();
  const previous = sortedEntries(left);
  return sortedEntries(right).every((entry, index) => entry === previous[index]);
}

function matchesLegacyTruncatedUpload(localSongs, cloudSongs) {
  if (localSongs.length !== cloudSongs.length) return false;
  let truncated = false;
  const oldUpload = localSongs.map((local) => {
    const song = mapSongForSync(local);
    for (const [field, limit] of SONG_TEXT_LIMITS) {
      if (typeof song[field] === 'string' && song[field].length > limit) {
        song[field] = song[field].slice(0, limit).replace(/[\uD800-\uDBFF]$/, '');
        truncated = true;
      }
    }
    return song;
  });
  return truncated && sameCloudSongs(oldUpload, cloudSongs);
}

module.exports = { SONG_TEXT_LIMITS, mapSongForSync, sameCloudSongs, matchesLegacyTruncatedUpload };
