'use strict';

const { getInitial, now } = require('../shared/utils');
const { createCloudSongSyncStore } = require('./cloud-song-sync-store');

function assertSongImportLimit(count) {
  if (count <= 5000) return;
  throw Object.assign(new Error('结果歌库超过 5000 首，无法完整同步；请先在歌库整理至 5000 首以内。'), {
    code: 'SONG_IMPORT_LIMIT_EXCEEDED',
    statusCode: 422,
  });
}

function createSongStore(songDb) {
  if (!songDb || typeof songDb.prepare !== 'function') {
    throw new Error('songDb is required to create SongStore.');
  }
  // Connection-local triggers observe every song writer without persisting schema changes.
  songDb.exec(`
    CREATE TEMP TABLE IF NOT EXISTS lira_song_revision (revision INTEGER NOT NULL);
    INSERT INTO lira_song_revision SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM lira_song_revision);
  `);
  for (const table of ['songs', 'song_categories']) {
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      songDb.exec(`CREATE TEMP TRIGGER IF NOT EXISTS lira_${table}_${operation}
        AFTER ${operation} ON main.${table} BEGIN
          UPDATE lira_song_revision SET revision = revision + 1;
        END`);
    }
  }
  const changes = songDb.prepare('SELECT revision FROM temp.lira_song_revision');
  let transactionRead = 0;
  const dataVersion = songDb.prepare('PRAGMA data_version');
  const cloudSync = createCloudSongSyncStore(songDb);
  const insertSong = songDb.prepare(`
    INSERT INTO songs (
      name, name_pinyin, name_initial, artist, category_id,
      is_enabled, note, tags, language, source_platform, request_price, song_clip,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateImportedSong = songDb.prepare(`
    UPDATE songs SET category_id = ?, is_enabled = ?, note = ?, tags = ?,
      language = ?, source_platform = ?, request_price = ?, song_clip = ?, updated_at = ?
    WHERE id = ?
  `);

  function withTransaction(callback, { syncPending = false } = {}) {
    songDb.exec('BEGIN');
    try {
      const result = callback();
      if (syncPending) cloudSync.capturePending();
      songDb.exec('COMMIT');
      return result;
    } catch (error) {
      songDb.exec('ROLLBACK');
      throw error;
    }
  }

  function ensureCategoryWithinTransaction(name, categories) {
    const existing = categories?.get(name) || songDb.prepare('SELECT * FROM song_categories WHERE name = ?').get(name);
    if (existing) {
      categories?.set(name, existing);
      return existing;
    }

    const createdAt = now();
    const result = songDb
      .prepare(
        `
      INSERT INTO song_categories (name, sort_order, is_enabled, created_at, updated_at)
      VALUES (?, 0, 1, ?, ?)
    `,
      )
      .run(name, createdAt, createdAt);
    const category = songDb.prepare('SELECT * FROM song_categories WHERE id = ?').get(Number(result.lastInsertRowid));
    categories?.set(name, category);
    return category;
  }

  function insertSongWithinTransaction(song, createdAt, categoryId) {
    const initial = song.nameInitial || song.namePinyin || getInitial(song.name);
    const result = insertSong.run(
      song.name,
      initial,
      initial,
      song.artist || '',
      categoryId,
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
    return Number(result.lastInsertRowid);
  }

  function readSongById(id) {
    return songDb.prepare('SELECT * FROM songs WHERE id = ?').get(Number(id));
  }

  function deleteSongWithinTransaction(id) {
    const songId = Number(id);
    songDb.prepare('UPDATE queue SET song_id = NULL WHERE song_id = ?').run(songId);
    songDb.prepare('UPDATE requests SET song_id = NULL WHERE song_id = ?').run(songId);
    songDb.prepare('DELETE FROM songs WHERE id = ?').run(songId);
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

  const store = {
    getChangeToken() {
      // Never reuse an uncommitted snapshot: rollback can restore/reuse a revision.
      const transaction = songDb.isTransaction ? `:transaction:${++transactionRead}` : '';
      return `${changes.get().revision}:${dataVersion.get().data_version}${transaction}`;
    },

    saveSong(song) {
      try {
        return withTransaction(
          () => {
            const categoryName = song.categoryName || '默认';
            const category = ensureCategoryWithinTransaction(categoryName);
            const updatedAt = song.updatedAt || now();
            const enabled = song.isEnabled ? 1 : 0;

            if (song.id !== null && song.id !== undefined) {
              const existing = songDb
                .prepare('SELECT id, request_price, song_clip FROM songs WHERE id = ?')
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
              .prepare('SELECT id, request_price, song_clip FROM songs WHERE name = ? AND artist = ? LIMIT 1')
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

            assertSongImportLimit(store.countSongs() + 1);
            return readSongById(insertSongWithinTransaction({ ...song, categoryName }, updatedAt, category.id));
          },
          { syncPending: true },
        );
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
        conditions.push(
          '(songs.name LIKE ? OR songs.artist LIKE ? OR songs.tags LIKE ? OR song_categories.name LIKE ?)',
        );
        args.push(...Array(4).fill(`%${query}%`));
      }
      if (categories.length) {
        conditions.push(`(${categories.map(() => 'song_categories.name LIKE ?').join(' OR ')})`);
        args.push(...categories.map((category) => `%${category}%`));
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
      return withTransaction(
        () => deleteSongWithinTransaction(id),
        { syncPending: true },
      );
    },

    toggleSong(id, updatedAt = now()) {
      const song = songDb.prepare('SELECT is_enabled FROM songs WHERE id = ?').get(Number(id));
      if (!song) return { ok: false };
      return withTransaction(
        () => {
          songDb
            .prepare('UPDATE songs SET is_enabled = ?, updated_at = ? WHERE id = ?')
            .run(song.is_enabled ? 0 : 1, updatedAt, Number(id));
          return { ok: true };
        },
        { syncPending: true },
      );
    },

    countSongs() {
      return songDb.prepare('SELECT COUNT(*) AS count FROM songs').get().count;
    },

    listCategories() {
      return listCategoryRows().map((row) => ({
        ...row,
        is_enabled: Boolean(row.is_enabled),
      }));
    },

    ensureCategory(name) {
      return withTransaction(() => ensureCategoryWithinTransaction(name || '默认'));
    },

    importRows(rows) {
      return withTransaction(
        () => {
          let inserted = 0;
          let duplicate = 0;
          const existingRows = songDb.prepare('SELECT name, artist FROM songs').all();
          const knownIdentities = new Set(existingRows.map((row) => JSON.stringify([row.name, row.artist || ''])));
          const newRows = [];
          for (const row of rows) {
            const identity = JSON.stringify([row.name, row.artist || '']);
            if (knownIdentities.has(identity)) {
              duplicate += 1;
            } else {
              knownIdentities.add(identity);
              newRows.push(row);
            }
          }
          assertSongImportLimit(existingRows.length + newRows.length);
          let createdCategories = 0;
          const categories = new Map(listCategoryRows().map((category) => [category.name, category]));

          for (const row of newRows) {
            const categoryName = row.categoryName || '默认';
            if (!categories.has(categoryName)) {
              createdCategories += 1;
            }
            const createdAt = now();
            const category = ensureCategoryWithinTransaction(categoryName, categories);
            insertSongWithinTransaction(row, createdAt, category.id);
            inserted += 1;
          }

          return { inserted, duplicate, createdCategories };
        },
        { syncPending: true },
      );
    },

    applyImportUpdate(buildPlan) {
      return withTransaction(
        () => {
          const plan = buildPlan(store.listRows(), store.listCategories());
          const total = plan.rows.length - (plan.counts.deleted || 0);
          for (const id of plan.deletions) deleteSongWithinTransaction(id);
          const categories = new Map(listCategoryRows().map((row) => [row.name, row]));
          let createdCategories = 0;
          for (const { id, song } of plan.changes) {
            const categoryName = song.categoryName || '默认';
            if (!categories.has(categoryName)) {
              createdCategories += 1;
            }
            const category = ensureCategoryWithinTransaction(categoryName, categories);
            if (id === undefined) {
              insertSongWithinTransaction(song, now(), category.id);
            } else {
              updateImportedSong.run(
                category.id,
                song.isEnabled ? 1 : 0,
                song.note,
                song.tags,
                song.language,
                song.sourcePlatform,
                song.requestPrice,
                song.songClip,
                now(),
                id,
              );
            }
          }
          return { total, ...plan.counts, createdCategories };
        },
        { syncPending: true },
      );
    },

    replaceAll(rows) {
      return withTransaction(() => {
        assertSongImportLimit(rows.length);
        songDb.prepare('UPDATE queue SET song_id = NULL WHERE song_id IS NOT NULL').run();
        songDb.prepare('UPDATE requests SET song_id = NULL WHERE song_id IS NOT NULL').run();
        songDb.prepare('DELETE FROM songs').run();
        songDb.prepare('DELETE FROM song_categories').run();
        const categories = new Map();
        ensureCategoryWithinTransaction('默认', categories);
        for (const row of rows) {
          const createdAt = now();
          const category = ensureCategoryWithinTransaction(row.categoryName || '默认', categories);
          insertSongWithinTransaction(row, createdAt, category.id);
        }
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
        SELECT song_name FROM random_request_history
        ORDER BY datetime(created_at) DESC, request_id DESC
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
  return store;
}

module.exports = { createSongStore };
