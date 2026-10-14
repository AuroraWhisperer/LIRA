'use strict';

// External players keep their own catalog. WeSing's multi-provider preference
// deliberately does not participate in this resolver.
function createExternalClientLyricResolver({ platform, getRegistry, lyricsService }) {
  if (!['qq', 'netease'].includes(platform)) throw new Error('外部播放器平台无效。');
  return async function resolveLyrics(input = {}) {
    const title = String(input.title || '').trim().slice(0, 120);
    if (!title) return null;
    const artists = (Array.isArray(input.artists) ? input.artists : [input.artist]).filter(Boolean);
    const artist = artists.join(' / ');
    const durationMs = Math.max(0, Number(input.durationMs) || 0);
    const registry = getRegistry();
    let track;
    const sourceTrackId = String(input.sourceTrackId || '');
    if (platform === 'netease' && /^\d+$/.test(sourceTrackId)) {
      track = { id: `netease:${sourceTrackId}`, source: platform, sourceTrackId, title, artists, durationMs };
    } else {
      const result = await lyricsService.searchMusicTracks(registry, {
        platform, keyword: [title, artist].filter(Boolean).join(' '), limit: 20,
      });
      const requestedArtists = artistKey(artists);
      const candidates = (result.tracks || []).filter((candidate) => candidate.source === platform &&
        normalizeText(candidate.title) === normalizeText(title) &&
        (!requestedArtists || artistKey(candidate.artists || []) === requestedArtists)).map((candidate) => ({
        track: candidate,
        durationDistance: durationMs > 0 && candidate.durationMs > 0
          ? Math.abs(candidate.durationMs - durationMs) : Number.MAX_SAFE_INTEGER,
      })).filter((candidate) => candidate.durationDistance === Number.MAX_SAFE_INTEGER || candidate.durationDistance <= 5000)
        .sort((left, right) => left.durationDistance - right.durationDistance);
      if (!candidates.length) return null;
      track = candidates[0].track;
    }
    const result = await lyricsService.getMusicTrackLyrics(registry, { track });
    if (result?.source && result.source !== platform) return null;
    if (!result?.lines?.length) return null;
    return { ...result, source: platform, songMid: track.sourceTrackId, title: track.title,
      artists: track.artists, durationMs: durationMs || track.durationMs };
  };
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function artistKey(artists) {
  return artists.flatMap((artist) => String(artist).split('/')).map(normalizeText).filter(Boolean).sort().join('\n');
}

module.exports = { createExternalClientLyricResolver };
