'use strict';

import { getQueueTrackKey } from '../utils.js';

// Source occurrences count up within each song. Added copies count down so that
// neither shuffling nor inserting a duplicate changes a source row's identity.
export function sourcePlaylistTracks(tracks) {
  const counts = new Map();
  return tracks.map((track) => {
    const occurrence = counts.get(track.id) || 0;
    counts.set(track.id, occurrence + 1);
    return { ...track, playlistOccurrence: occurrence };
  });
}

export function addedPlaylistTracks(state, tracks) {
  let occurrence = 0;
  for (const list of [state.normalQueueTracks, state.history || []]) {
    for (const track of list) {
      if (track.playlistOccurrence < occurrence) occurrence = track.playlistOccurrence;
    }
  }
  return tracks.map((track) => ({ ...track, playlistOccurrence: --occurrence }));
}

export function samePlaylistEntry(left, right) {
  return left && right && getQueueTrackKey(left) === getQueueTrackKey(right) &&
    left.playlistOccurrence === right.playlistOccurrence;
}

export function findSourcePlaylistIndex(playlist, selected, recentTrack) {
  // Recent plays can name an inserted copy that was never a row in the original source.
  if (recentTrack && (recentTrack.playlistOccurrence !== undefined || recentTrack.songRequestKey || recentTrack.requestedBy)) {
    const playedIndex = playlist.findIndex((item) => samePlaylistEntry(item, recentTrack) &&
      (item.requestedBy || '') === (recentTrack.requestedBy || ''));
    if (playedIndex >= 0) return playedIndex;
  }
  let legacyOccurrence = 0;
  let legacyIndex = -1;
  for (const [index, item] of playlist.entries()) {
    if (item.id !== selected.id) continue;
    if (item.playlistOccurrence === selected.playlistOccurrence) return index;
    // Old snapshots identified explicit "play next" additions by requester only.
    if (item.playlistOccurrence === undefined && (item.requestedBy || '') === (selected.requestedBy || '') &&
        legacyOccurrence++ === selected.playlistOccurrence) legacyIndex = index;
  }
  return legacyIndex;
}
