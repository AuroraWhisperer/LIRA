// 编写人：Aurora
// 播放器持久化：播放历史、队列快照、收藏、自建歌单。
// 对应 music-data.db，替代原先只存在浏览器 localStorage 的播放状态。
'use strict';

const { now, cleanText, safeParseJson } = require('../shared/utils');

const DEFAULT_CLIENT_ID = 'default';
const PLAY_HISTORY_LIMIT = 500;

function normalizeClientId(value) {
  return cleanText(value).slice(0, 60) || DEFAULT_CLIENT_ID;
}

/** 曲目去重键：优先用 source+平台曲目 ID，本地文件退化到标题+歌手 */
function trackKeyOf(track) {
  const input = track && typeof track === 'object' ? track : {};
  const source = cleanText(input.source) || 'unknown';
  const trackId = cleanText(input.sourceTrackId || input.trackId || input.id);
  if (trackId) return `${source}:${trackId}`;
  return `${source}:${cleanText(input.title)}|${cleanText(input.artists)}`;
}

function normalizeTrackFields(track) {
  const input = track && typeof track === 'object' ? track : {};
  return {
    source: cleanText(input.source),
    trackId: cleanText(input.sourceTrackId || input.trackId || input.id),
    title: cleanText(input.title).slice(0, 200),
    artists: cleanText(input.artists).slice(0, 200),
    album: cleanText(input.album).slice(0, 200),
    coverUrl: cleanText(input.coverUrl).slice(0, 500),
    durationMs: Math.max(0, Math.round(Number(input.durationMs) || 0))
  };
}

function createPlaybackStore(db) {
  const store = {
    // ── 播放历史 ──

    /** 记录一次播放；同一曲目只保留一行，累加次数并刷新时间 */
    recordPlay(track, options = {}) {
      const fields = normalizeTrackFields(track);
      if (!fields.title && !fields.trackId) return null;
      const clientId = normalizeClientId(options.clientId);
      const key = trackKeyOf(track);
      const playedAt = cleanText(options.playedAt) || now();
      const timestamp = now();

      db.prepare(`
        INSERT INTO play_history (
          client_id, track_key, source, track_id, title, artists, album, cover_url,
          duration_ms, origin, requester_name, play_count, played_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(client_id, track_key) DO UPDATE SET
          play_count = play_history.play_count + 1,
          played_at = excluded.played_at,
          origin = excluded.origin,
          requester_name = excluded.requester_name,
          cover_url = CASE WHEN excluded.cover_url != '' THEN excluded.cover_url ELSE play_history.cover_url END,
          duration_ms = CASE WHEN excluded.duration_ms > 0 THEN excluded.duration_ms ELSE play_history.duration_ms END,
          updated_at = excluded.updated_at
      `).run(
        clientId, key, fields.source, fields.trackId, fields.title, fields.artists,
        fields.album, fields.coverUrl, fields.durationMs,
        cleanText(options.origin), cleanText(options.requesterName),
        playedAt, timestamp, timestamp
      );

      store.trimHistory(clientId);
      return { trackKey: key, playedAt };
    },

    listHistory(options = {}) {
      const clientId = normalizeClientId(options.clientId);
      const limit = Math.max(1, Math.min(PLAY_HISTORY_LIMIT, Number(options.limit) || 200));
      return db.prepare(`
        SELECT * FROM play_history
        WHERE client_id = ?
        ORDER BY played_at DESC, id DESC
        LIMIT ?
      `).all(clientId, limit).map(mapHistoryRow);
    },

    /** 超出上限时按最久未播放丢弃，避免历史表无节制增长 */
    trimHistory(clientId, limit = PLAY_HISTORY_LIMIT) {
      const id = normalizeClientId(clientId);
      const max = Math.max(1, Number(limit) || PLAY_HISTORY_LIMIT);
      const result = db.prepare(`
        DELETE FROM play_history
        WHERE client_id = ?
          AND id NOT IN (
            SELECT id FROM play_history
            WHERE client_id = ?
            ORDER BY played_at DESC, id DESC
            LIMIT ?
          )
      `).run(id, id, max);
      return Number(result.changes) || 0;
    },

    removeHistoryTrack(trackKey, options = {}) {
      const result = db.prepare('DELETE FROM play_history WHERE client_id = ? AND track_key = ?')
        .run(normalizeClientId(options.clientId), cleanText(trackKey));
      return Number(result.changes) || 0;
    },

    clearHistory(options = {}) {
      const result = db.prepare('DELETE FROM play_history WHERE client_id = ?')
        .run(normalizeClientId(options.clientId));
      return { cleared: true, deletedCount: Number(result.changes) || 0 };
    },

    // ── 队列快照 ──

    /** 队列状态整体存为 JSON：结构随前端演进，拆列会频繁改表 */
    saveQueueState(payload, options = {}) {
      const clientId = normalizeClientId(options.clientId);
      const text = JSON.stringify(payload && typeof payload === 'object' ? payload : {});
      db.prepare(`
        INSERT INTO play_queue_state (client_id, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET
          payload = excluded.payload, updated_at = excluded.updated_at
      `).run(clientId, text, now());
      return { saved: true, bytes: text.length };
    },

    getQueueState(options = {}) {
      const row = db.prepare('SELECT payload, updated_at FROM play_queue_state WHERE client_id = ?')
        .get(normalizeClientId(options.clientId));
      if (!row) return null;
      return { payload: safeParseJson(row.payload), updatedAt: row.updated_at };
    },

    clearQueueState(options = {}) {
      db.prepare('DELETE FROM play_queue_state WHERE client_id = ?').run(normalizeClientId(options.clientId));
      return { cleared: true };
    },

    // ── 收藏 ──

    listFavorites() {
      return db.prepare('SELECT * FROM favorites ORDER BY sort_order ASC, id ASC')
        .all().map(mapTrackRow);
    },

    addFavorite(track) {
      const fields = normalizeTrackFields(track);
      if (!fields.title && !fields.trackId) throw new Error('缺少曲目信息。');
      const key = trackKeyOf(track);
      const nextOrder = (db.prepare('SELECT MAX(sort_order) AS max FROM favorites').get() || {}).max || 0;
      db.prepare(`
        INSERT INTO favorites (
          track_key, source, track_id, title, artists, album, cover_url,
          duration_ms, sort_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(track_key) DO UPDATE SET
          cover_url = CASE WHEN excluded.cover_url != '' THEN excluded.cover_url ELSE favorites.cover_url END,
          duration_ms = CASE WHEN excluded.duration_ms > 0 THEN excluded.duration_ms ELSE favorites.duration_ms END
      `).run(
        key, fields.source, fields.trackId, fields.title, fields.artists,
        fields.album, fields.coverUrl, fields.durationMs, Number(nextOrder) + 1, now()
      );
      return { trackKey: key };
    },

    removeFavorite(trackKey) {
      const result = db.prepare('DELETE FROM favorites WHERE track_key = ?').run(cleanText(trackKey));
      return { removed: Number(result.changes) > 0 };
    },

    isFavorite(trackKey) {
      const row = db.prepare('SELECT id FROM favorites WHERE track_key = ?').get(cleanText(trackKey));
      return Boolean(row);
    },

    // ── 自建歌单 ──

    listPlaylists() {
      return db.prepare(`
        SELECT p.*, (
          SELECT COUNT(*) FROM playlist_tracks t WHERE t.playlist_id = p.id
        ) AS track_count
        FROM playlists p
        ORDER BY p.sort_order ASC, p.id ASC
      `).all().map((row) => ({
        id: Number(row.id),
        name: row.name,
        description: row.description || '',
        trackCount: Number(row.track_count) || 0,
        sortOrder: Number(row.sort_order) || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    },

    createPlaylist(input = {}) {
      const name = cleanText(input.name).slice(0, 80);
      if (!name) throw new Error('缺少歌单名称。');
      const existing = db.prepare('SELECT id FROM playlists WHERE name = ?').get(name);
      if (existing) throw new Error('已有同名歌单。');
      const nextOrder = (db.prepare('SELECT MAX(sort_order) AS max FROM playlists').get() || {}).max || 0;
      const timestamp = now();
      const result = db.prepare(`
        INSERT INTO playlists (name, description, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(name, cleanText(input.description).slice(0, 200), Number(nextOrder) + 1, timestamp, timestamp);
      return { id: Number(result.lastInsertRowid), name };
    },

    deletePlaylist(id) {
      const playlistId = Number(id) || 0;
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
        const result = db.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId);
        db.exec('COMMIT');
        return { removed: Number(result.changes) > 0 };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    listPlaylistTracks(id) {
      return db.prepare(`
        SELECT * FROM playlist_tracks
        WHERE playlist_id = ?
        ORDER BY sort_order ASC, id ASC
      `).all(Number(id) || 0).map(mapTrackRow);
    },

    addPlaylistTracks(id, tracks) {
      const playlistId = Number(id) || 0;
      const playlist = db.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId);
      if (!playlist) throw new Error('歌单不存在。');
      const list = Array.isArray(tracks) ? tracks : [tracks];
      const nextOrderRow = db.prepare('SELECT MAX(sort_order) AS max FROM playlist_tracks WHERE playlist_id = ?')
        .get(playlistId);
      let order = Number(nextOrderRow && nextOrderRow.max) || 0;
      let added = 0;

      db.exec('BEGIN');
      try {
        for (const track of list) {
          const fields = normalizeTrackFields(track);
          if (!fields.title && !fields.trackId) continue;
          order += 1;
          const result = db.prepare(`
            INSERT OR IGNORE INTO playlist_tracks (
              playlist_id, track_key, source, track_id, title, artists, album,
              cover_url, duration_ms, sort_order, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            playlistId, trackKeyOf(track), fields.source, fields.trackId, fields.title,
            fields.artists, fields.album, fields.coverUrl, fields.durationMs, order, now()
          );
          if (Number(result.changes) > 0) added += 1;
        }
        db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), playlistId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { added, total: list.length };
    },

    removePlaylistTrack(id, trackKey) {
      const playlistId = Number(id) || 0;
      const result = db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_key = ?')
        .run(playlistId, cleanText(trackKey));
      if (Number(result.changes) > 0) {
        db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), playlistId);
      }
      return { removed: Number(result.changes) > 0 };
    }
  };

  return store;
}

function mapHistoryRow(row) {
  return {
    ...mapTrackRow(row),
    origin: row.origin || '',
    requesterName: row.requester_name || '',
    playCount: Number(row.play_count) || 1,
    playedAt: row.played_at
  };
}

function mapTrackRow(row) {
  return {
    trackKey: row.track_key,
    source: row.source || '',
    sourceTrackId: row.track_id || '',
    title: row.title || '',
    artists: row.artists || '',
    album: row.album || '',
    coverUrl: row.cover_url || '',
    durationMs: Number(row.duration_ms) || 0
  };
}

module.exports = {
  createPlaybackStore,
  trackKeyOf,
  DEFAULT_CLIENT_ID,
  PLAY_HISTORY_LIMIT
};
