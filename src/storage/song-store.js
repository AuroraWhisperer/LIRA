'use strict';

const { getInitial, now } = require('../shared/utils');

function createSongStore(songDb) {
  if (!songDb || typeof songDb.prepare !== 'function') {
    throw new Error('songDb is required to create SongStore.');
  }

  function withTransaction(callback) {
    songDb.exec('BEGIN');
    try {
      const result = callback();
      songDb.exec('COMMIT');
      return result;
    } catch (error) {
      songDb.exec('ROLLBACK');
      throw error;
    }
  }

  function ensureCategoryWithinTransaction(name) {
    const existing = songDb
      .prepare('SELECT * FROM song_categories WHERE name = ?')
      .get(name);
    if (existing) return existing;

    const createdAt = now();
    const result = songDb
      .prepare(
        `
      INSERT INTO song_categories (name, sort_order, is_enabled, created_at, updated_at)
      VALUES (?, 0, 1, ?, ?)
    `,
      )
      .run(name, createdAt, createdAt);
    return songDb
      .prepare('SELECT * FROM song_categories WHERE id = ?')
      .get(Number(result.lastInsertRowid));
  }

  function insertSongWithinTransaction(song, createdAt = now(), categoryId) {
    const initial = song.nameInitial || song.namePinyin || getInitial(song.name);
    const resolvedCategoryId = categoryId ?? ensureCategoryWithinTransaction(song.categoryName || '默认').id;
    songDb
      .prepare(
        `
      INSERT INTO songs (
        name, name_pinyin, name_initial, artist, category_id,
        is_enabled, note, tags, language, source_platform, request_price, song_clip,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        song.name,
        initial,
        initial,
        song.artist || '',
        resolvedCategoryId,
        song.isEnabled ? 1 : 0,
        song.note || '',
        song.tags || '',
        song.language || '',
        song.sourcePlatform || '',
        song.requestPrice || '',
        song.songClip || '',
        createdAt,
        song.updatedAt || createdAt,
      );
    return songDb
      .prepare('SELECT * FROM songs WHERE id = last_insert_rowid()')
      .get();
  }

  function readSongById(id) {
    return songDb.prepare('SELECT * FROM songs WHERE id = ?').get(Number(id));
  }

  function listCategoryRows() {
    return songDb
      .prepare(
        `
      SELECT id, name, sort_order, is_enabled, created_at, updated_at
      FROM song_categories
      ORDER BY sort_order ASC, name COLLATE NOCASE ASC
    `,
      )
      .all();
  }

  return {
    saveSong(song) {
      try {
        return withTransaction(() => {
          const categoryName = song.categoryName || '默认';
          const category = ensureCategoryWithinTransaction(categoryName);
          const updatedAt = song.updatedAt || now();
          const enabled = song.isEnabled ? 1 : 0;

          if (song.id !== null && song.id !== undefined) {
            const existing = songDb
              .prepare(
                'SELECT id, request_price, song_clip FROM songs WHERE id = ?',
              )
              .get(Number(song.id));
            if (!existing) throw new Error('歌曲不存在。');
            songDb
              .prepare(
                `
              UPDATE songs
              SET name = ?, name_pinyin = ?, name_initial = ?, artist = ?, category_id = ?,
                  is_enabled = ?, note = ?, tags = ?, language = ?, source_platform = ?,
                  request_price = ?, song_clip = ?, updated_at = ?
              WHERE id = ?
            `,
              )
              .run(
                song.name,
                song.namePinyin || getInitial(song.name),
                song.nameInitial || getInitial(song.name),
                song.artist || '',
                category.id,
                enabled,
                song.note || '',
                song.tags || '',
                song.language || '',
                song.sourcePlatform || '',
                song.hasRequestPrice ? song.requestPrice || '' : existing.request_price,
                song.hasSongClip ? song.songClip || '' : existing.song_clip,
                updatedAt,
                Number(song.id),
              );
            return readSongById(song.id);
          }

          const existing = songDb
            .prepare(
              'SELECT id, request_price, song_clip FROM songs WHERE name = ? AND artist = ? LIMIT 1',
            )
            .get(song.name, song.artist || '');
          if (existing) {
            songDb
              .prepare(
                `
              UPDATE songs
              SET category_id = ?, is_enabled = ?, note = ?, tags = ?, language = ?,
                  source_platform = ?, request_price = ?, song_clip = ?, updated_at = ?
              WHERE id = ?
            `,
              )
              .run(
                category.id,
                enabled,
                song.note || '',
                song.tags || '',
                song.language || '',
                song.sourcePlatform || '',
                song.hasRequestPrice ? song.requestPrice || '' : existing.request_price,
                song.hasSongClip ? song.songClip || '' : existing.song_clip,
                updatedAt,
                existing.id,
              );
            return readSongById(existing.id);
          }

          return insertSongWithinTransaction({ ...song, categoryName }, updatedAt, category.id);
        });
      } catch (error) {
        if (String(error.message || '').includes('UNIQUE constraint')) {
          throw new Error('歌曲名称和艺术家与已有歌曲重复。');
        }
        throw error;
      }
    },

    listRows({ query = '', categories = [], language = '', artist = '', enabledOnly = false } = {}) {
      const conditions = [];
      const args = [];
      if (query) {
        conditions.push('(songs.name LIKE ? OR songs.artist LIKE ? OR songs.tags LIKE ? OR song_categories.name LIKE ?)');
        args.push(...Array(4).fill(`%${query}%`));
      }
      for (const category of categories) {
        conditions.push('song_categories.name LIKE ?');
        args.push(`%${category}%`);
      }
      if (language) {
        conditions.push('(songs.language = ? OR songs.language LIKE ?)');
        args.push(language, `%${language}%`);
      }
      if (artist) {
        conditions.push('(songs.artist = ? OR songs.artist LIKE ?)');
        args.push(artist, `%${artist}%`);
      }
      if (enabledOnly) conditions.push('songs.is_enabled = 1');
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return songDb
        .prepare(
          `
        SELECT songs.*, COALESCE(song_categories.name, '默认') AS category_name
        FROM songs
        LEFT JOIN song_categories ON song_categories.id = songs.category_id
        ${where}
        ORDER BY songs.name_initial ASC, songs.name COLLATE NOCASE ASC, songs.artist COLLATE NOCASE ASC
      `,
        )
        .all(...args);
    },

    findByNameArtist(name, artist) {
      return (
        songDb
          .prepare(
            `
          SELECT songs.*, song_categories.name AS category_name
          FROM songs
          LEFT JOIN song_categories ON song_categories.id = songs.category_id
          WHERE songs.name = ? AND songs.artist = ? AND songs.is_enabled = 1
          LIMIT 1
        `,
          )
          .get(name, artist) || null
      );
    },

    findByName(name) {
      return (
        songDb
          .prepare(
            `
          SELECT songs.*, song_categories.name AS category_name
          FROM songs
          LEFT JOIN song_categories ON song_categories.id = songs.category_id
          WHERE songs.name = ? AND songs.is_enabled = 1
          ORDER BY songs.updated_at DESC
          LIMIT 1
        `,
          )
          .get(name) || null
      );
    },

    findEnabledByNameContains(pattern) {
      const escaped = String(pattern).replace(/[\\%_]/g, (value) => `\\${value}`);
      return songDb
        .prepare(
          `
        SELECT songs.*, song_categories.name AS category_name
        FROM songs
        LEFT JOIN song_categories ON song_categories.id = songs.category_id
        WHERE songs.name LIKE ? ESCAPE '\\' AND songs.is_enabled = 1
        LIMIT 2
      `,
        )
        .all(`%${escaped}%`);
    },

    deleteSong(id) {
      return withTransaction(() => {
        const songId = Number(id);
        songDb.prepare('UPDATE queue SET song_id = NULL WHERE song_id = ?').run(songId);
        songDb
          .prepare('UPDATE requests SET song_id = NULL WHERE song_id = ?')
          .run(songId);
        songDb.prepare('DELETE FROM songs WHERE id = ?').run(songId);
      });
    },

    toggleSong(id, updatedAt = now()) {
      const song = songDb
        .prepare('SELECT is_enabled FROM songs WHERE id = ?')
        .get(Number(id));
      if (!song) return { ok: false };
      songDb
        .prepare('UPDATE songs SET is_enabled = ?, updated_at = ? WHERE id = ?')
        .run(song.is_enabled ? 0 : 1, updatedAt, Number(id));
      return { ok: true };
    },

    countSongs() {
      return songDb.prepare('SELECT COUNT(*) AS count FROM songs').get().count;
    },

    listCategories() {
      return listCategoryRows()
        .map((row) => ({ ...row, is_enabled: Boolean(row.is_enabled) }));
    },

    ensureCategory(name) {
      return withTransaction(() => ensureCategoryWithinTransaction(name || '默认'));
    },

    importRows(rows, options = {}) {
      return withTransaction(() => {
        let inserted = 0;
        let duplicate = 0;
        let createdCategories = 0;
        const knownCategories = new Set(
          listCategoryRows().map((category) => category.name),
        );

        for (const row of rows) {
          const existing = songDb
            .prepare('SELECT id FROM songs WHERE name = ? AND artist = ? LIMIT 1')
            .get(row.name, row.artist || '');
          if (existing) {
            duplicate += 1;
            continue;
          }

          const categoryName = row.categoryName || '默认';
          if (!knownCategories.has(categoryName)) {
            knownCategories.add(categoryName);
            createdCategories += 1;
          }
          insertSongWithinTransaction({ ...row, categoryName });
          inserted += 1;
        }

        songDb
          .prepare(
            `
          INSERT INTO import_batches (
            total_count, inserted_count, duplicate_count, failed_count,
            created_category_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            options.totalCount ?? rows.length,
            inserted,
            duplicate,
            options.failedCount ?? 0,
            createdCategories,
            now(),
          );

        return { inserted, duplicate, createdCategories };
      });
    },

    replaceAll(rows) {
      return withTransaction(() => {
        songDb.prepare('UPDATE queue SET song_id = NULL WHERE song_id IS NOT NULL').run();
        songDb
          .prepare('UPDATE requests SET song_id = NULL WHERE song_id IS NOT NULL')
          .run();
        songDb.prepare('DELETE FROM songs').run();
        songDb.prepare('DELETE FROM song_categories').run();
        ensureCategoryWithinTransaction('默认');
        for (const row of rows) insertSongWithinTransaction(row);
        return { count: rows.length };
      });
    },

    listRandomRows() {
      return songDb
        .prepare(
          `
        SELECT songs.*, song_categories.name AS category_name,
               COALESCE(song_categories.is_enabled, 1) AS category_is_enabled
        FROM songs
        LEFT JOIN song_categories ON song_categories.id = songs.category_id
        WHERE songs.is_enabled = 1
      `,
        )
        .all();
    },

    listRecentRandomSongNames() {
      return songDb
        .prepare(
          `
        SELECT song_name FROM requests
        WHERE source = 'random' OR source LIKE 'random:%'
        ORDER BY datetime(created_at) DESC
        LIMIT 10
      `,
        )
        .all()
        .map((row) => row.song_name);
    },

    listTagRows() {
      return songDb.prepare("SELECT tags FROM songs WHERE tags != ''").all();
    },
  };
}

module.exports = { createSongStore };
