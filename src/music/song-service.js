// 编写人：Aurora
// 歌曲 CRUD、分类管理、导入导出、随机选歌。
// 纯 music 域，不包含 Bilibili 逻辑。
'use strict';

const { now, cleanText, getInitial } = require('../shared/utils');
const {
  SONG_EXPORT_HEADERS,
  SONG_IMPORT_ALIASES,
  normalizeImportedSongRow
} = require('./song-import-schema');
const {
  filterRandomSongCandidates,
  describeRandomSongScope,
  randomLanguageAliases
} = require('./random-song-filter');

// ── 歌曲 CRUD ──

function saveSong(db, input) {
  const name = cleanText(input.name || input.songName);
  if (!name) {
    throw new Error('歌曲名不能为空。');
  }
  const artist = cleanText(input.artist);
  const categoryName = cleanText(input.categoryName || input.category || '默认') || '默认';
  const categoryId = ensureCategory(db, categoryName).id;
  const initial = getInitial(name);
  const updatedAt = now();
  const enabled = input.isEnabled === undefined ? 1 : (input.isEnabled ? 1 : 0);
  const note = cleanText(input.note);
  const tags = cleanText(input.tags);
  const language = cleanText(input.language);
  const sourcePlatform = cleanText(input.sourcePlatform || input.source_platform);

  if (input.id) {
    const existingRow = db.prepare('SELECT id FROM songs WHERE id = ?').get(Number(input.id));
    if (!existingRow) {
      throw new Error('歌曲不存在。');
    }
    try {
      db.prepare(`
        UPDATE songs
        SET name = ?, name_pinyin = ?, name_initial = ?, artist = ?, category_id = ?,
            is_enabled = ?, note = ?, tags = ?, language = ?, source_platform = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        name, initial, initial, artist, categoryId,
        enabled, note, tags, language, sourcePlatform,
        updatedAt, Number(input.id)
      );
    } catch (error) {
      if (error.message && error.message.includes('UNIQUE constraint')) {
        throw new Error('歌曲名称和艺术家与已有歌曲重复。');
      }
      throw error;
    }
    return db.prepare('SELECT * FROM songs WHERE id = ?').get(Number(input.id));
  }

  const existing = db.prepare(`
    SELECT id FROM songs WHERE name = ? AND artist = ? LIMIT 1
  `).get(name, artist);
  if (existing) {
    db.prepare(`
      UPDATE songs
      SET category_id = ?, is_enabled = ?, note = ?, tags = ?, language = ?,
          source_platform = ?, updated_at = ?
      WHERE id = ?
    `).run(categoryId, enabled, note, tags, language, sourcePlatform, updatedAt, existing.id);
    return db.prepare('SELECT * FROM songs WHERE id = ?').get(existing.id);
  }

  const result = db.prepare(`
    INSERT INTO songs (
      name, name_pinyin, name_initial, artist, category_id,
      is_enabled, note, tags, language, source_platform,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, initial, initial, artist, categoryId,
    enabled, note, tags, language, sourcePlatform,
    updatedAt, updatedAt
  );

  return db.prepare('SELECT * FROM songs WHERE id = ?').get(Number(result.lastInsertRowid));
}

function listSongs(db, {
  query = '', category = '', categories = [], language = '', artist = '', tags = '', enabledOnly = false
} = {}) {
  const conditions = [];
  const args = [];
  const cleanQuery = cleanText(query);
  const categoryValues = Array.isArray(categories) ? categories : [categories];
  const categoryFilters = (categoryValues.length ? categoryValues : [category])
    .map(cleanText)
    .filter(Boolean);
  const cleanLang = cleanText(language);
  const cleanArt = cleanText(artist);
  const tagValues = Array.isArray(tags) ? tags : [tags];
  const tagFilters = tagValues.map(cleanText).filter(Boolean);

  if (cleanQuery) {
    conditions.push('(songs.name LIKE ? OR songs.artist LIKE ? OR songs.tags LIKE ? OR song_categories.name LIKE ?)');
    args.push(`%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`);
  }
  for (const categoryFilter of categoryFilters) {
    conditions.push('song_categories.name LIKE ?');
    args.push(`%${categoryFilter}%`);
  }
  if (cleanLang) {
    conditions.push('songs.language = ?');
    args.push(cleanLang);
  }
  if (cleanArt) {
    conditions.push('songs.artist = ?');
    args.push(cleanArt);
  }
  if (enabledOnly) {
    conditions.push('songs.is_enabled = 1');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT songs.*, COALESCE(song_categories.name, '默认') AS category_name
    FROM songs
    LEFT JOIN song_categories ON song_categories.id = songs.category_id
    ${where}
    ORDER BY songs.name_initial ASC, songs.name COLLATE NOCASE ASC, songs.artist COLLATE NOCASE ASC
  `).all(...args);

  return rows.filter((row) => {
    if (tagFilters.length === 0) return true;
    const songTags = new Set(splitSongTags(row.tags).map((tag) => tag.toLocaleLowerCase()));
    return tagFilters.every((tag) => songTags.has(tag.toLocaleLowerCase()));
  }).sort((a, b) => {
    const initialCompare = String(a.name_initial).localeCompare(String(b.name_initial), 'zh-Hans-CN');
    if (initialCompare !== 0) return initialCompare;
    return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN-u-co-pinyin');
  }).map((row) => ({
    ...row,
    is_enabled: Boolean(row.is_enabled)
  }));
}

function findSong(db, songName, artist) {
  const cleanName = cleanText(songName);
  const cleanArtist = cleanText(artist);
  if (!cleanName) return null;

  if (cleanArtist) {
    const exact = db.prepare(`
      SELECT songs.*, song_categories.name AS category_name
      FROM songs
      LEFT JOIN song_categories ON song_categories.id = songs.category_id
      WHERE songs.name = ? AND songs.artist = ? AND songs.is_enabled = 1
      LIMIT 1
    `).get(cleanName, cleanArtist);
    if (exact) return exact;
  }

  return db.prepare(`
    SELECT songs.*, song_categories.name AS category_name
    FROM songs
    LEFT JOIN song_categories ON song_categories.id = songs.category_id
    WHERE songs.name = ? AND songs.is_enabled = 1
    ORDER BY songs.updated_at DESC
    LIMIT 1
  `).get(cleanName) || null;
}

function findUniqueSongNameMatch(db, songName) {
  const cleanName = cleanText(songName);
  if (!cleanName) return null;

  const exact = findSong(db, cleanName);
  if (exact) return exact;

  const pattern = `%${escapeLikePattern(cleanName)}%`;
  const matches = db.prepare(`
    SELECT songs.*, song_categories.name AS category_name
    FROM songs
    LEFT JOIN song_categories ON song_categories.id = songs.category_id
    WHERE songs.name LIKE ? ESCAPE '\\' AND songs.is_enabled = 1
    LIMIT 2
  `).all(pattern);

  return matches.length === 1 ? matches[0] : null;
}

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

// ── 单曲写操作（供 domain-services 调用，避免在 facade 层散写 SQL）──

/** 按 id 删除歌曲；调用方不需要了解表结构 */
function deleteSong(db, id) {
  db.prepare('DELETE FROM songs WHERE id = ?').run(Number(id));
}

/** 切换歌曲启用状态，返回 { ok: true/false } */
function toggleSong(db, id) {
  const song = db.prepare('SELECT is_enabled FROM songs WHERE id = ?').get(Number(id));
  if (!song) return { ok: false };
  db.prepare('UPDATE songs SET is_enabled = ?, updated_at = ? WHERE id = ?')
    .run(song.is_enabled ? 0 : 1, now(), Number(id));
  return { ok: true };
}

/** 返回歌库歌曲总数 */
function countSongs(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM songs').get().count;
}

// ── 分类 ──

function listCategories(db) {
  return db.prepare(`
    SELECT id, name, sort_order, is_enabled, created_at, updated_at
    FROM song_categories
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `).all().map((row) => ({
    ...row,
    is_enabled: Boolean(row.is_enabled)
  }));
}

function ensureCategory(db, name) {
  const categoryName = cleanText(name) || '默认';
  const existing = db.prepare('SELECT * FROM song_categories WHERE name = ?').get(categoryName);
  if (existing) return existing;

  const createdAt = now();
  const result = db.prepare(`
    INSERT INTO song_categories (name, sort_order, is_enabled, created_at, updated_at)
    VALUES (?, 0, 1, ?, ?)
  `).run(categoryName, createdAt, createdAt);
  return db.prepare('SELECT * FROM song_categories WHERE id = ?').get(Number(result.lastInsertRowid));
}

// ── 导入 ──

function importSongs(db, rows) {
  const normalizedRows = rows.map(normalizeImportedSongRow);

  let inserted = 0;
  let duplicate = 0;
  let failed = 0;
  let createdCategories = 0;
  const failures = [];
  const knownCategories = new Set(listCategories(db).map((cat) => cat.name));

  db.exec('BEGIN');
  try {
    for (let index = 0; index < normalizedRows.length; index += 1) {
      const row = normalizedRows[index];
      if (!row.name) {
        failed += 1;
        failures.push({ row: index + 1, reason: '歌曲名字为空' });
        continue;
      }

      const existing = db.prepare(`
        SELECT id FROM songs WHERE name = ? AND artist = ? LIMIT 1
      `).get(row.name, row.artist);
      if (existing) {
        duplicate += 1;
        continue;
      }

      if (!knownCategories.has(row.categoryName)) {
        createdCategories += 1;
        knownCategories.add(row.categoryName);
      }
      const categoryId = ensureCategory(db, row.categoryName).id;
      const createdAt = now();
      const initial = getInitial(row.name);
      db.prepare(`
        INSERT INTO songs (
          name, name_pinyin, name_initial, artist, category_id,
          is_enabled, note, tags, language, source_platform,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.name, initial, initial, row.artist, categoryId,
        row.isEnabled ? 1 : 0, row.note, row.tags, row.language,
        row.sourcePlatform,
        createdAt, createdAt
      );
      inserted += 1;
    }

    db.prepare(`
      INSERT INTO import_batches (
        total_count, inserted_count, duplicate_count, failed_count,
        created_category_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(normalizedRows.length, inserted, duplicate, failed, createdCategories, now());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    total: normalizedRows.length,
    inserted,
    duplicate,
    failed,
    createdCategories,
    failures
  };
}

// ── 随机点歌 ──

function pickRandomSong(db, scopeText) {
  const rows = listRandomSongCandidates(db, scopeText);
  if (rows.length === 0) return null;

  const recentNames = new Set(db.prepare(`
    SELECT song_name FROM requests
    WHERE source = 'random' OR source LIKE 'random:%'
    ORDER BY datetime(created_at) DESC
    LIMIT 10
  `).all().map((row) => row.song_name));
  const candidates = rows.filter((row) => !recentNames.has(row.name));
  const pool = candidates.length > 0 ? candidates : rows;
  return pool[Math.floor(Math.random() * pool.length)];
}

function listRandomSongCandidates(db, scopeText) {
  // SQL 只负责限定歌库和启用状态；跨字段的组合规则由纯模块处理，
  // 避免歌曲服务把弹幕语法翻译成难以测试的动态 SQL。
  const rows = db.prepare(`
    SELECT songs.*, song_categories.name AS category_name,
           COALESCE(song_categories.is_enabled, 1) AS category_is_enabled
    FROM songs
    LEFT JOIN song_categories ON song_categories.id = songs.category_id
    WHERE songs.is_enabled = 1
  `).all();
  return filterRandomSongCandidates(rows, normalizeRandomScopeText(scopeText));
}

function describeRandomSongScopeInLibrary(db, scopeText) {
  const rows = db.prepare(`
    SELECT songs.*, song_categories.name AS category_name,
           COALESCE(song_categories.is_enabled, 1) AS category_is_enabled
    FROM songs
    LEFT JOIN song_categories ON song_categories.id = songs.category_id
    WHERE songs.is_enabled = 1
  `).all();
  return describeRandomSongScope(rows, normalizeRandomScopeText(scopeText));
}

function splitSongTags(value) {
  return String(value || '')
    .split(/[,，]/)
    .map((tag) => cleanText(tag))
    .filter(Boolean);
}

function listTags(db) {
  const tags = new Set();
  const rows = db.prepare("SELECT tags FROM songs WHERE tags != ''").all();
  for (const row of rows) {
    for (const tag of splitSongTags(row.tags)) tags.add(tag);
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function normalizeRandomScopeText(value) {
  let text = cleanText(value);
  while (text && '+＋:：-—'.includes(text[0])) {
    text = cleanText(text.slice(1));
  }
  return text;
}

function randomSourceValue(scopeText) {
  const scope = normalizeRandomScopeText(scopeText);
  return scope ? `random:${scope}` : 'random';
}

module.exports = {
  SONG_EXPORT_HEADERS,
  SONG_IMPORT_ALIASES,
  saveSong,
  listSongs,
  findSong,
  findUniqueSongNameMatch,
  deleteSong,
  toggleSong,
  countSongs,
  listCategories,
  listTags,
  ensureCategory,
  importSongs,
  normalizeImportedSongRow,
  pickRandomSong,
  listRandomSongCandidates,
  describeRandomSongScope: describeRandomSongScopeInLibrary,
  randomLanguageAliases,
  normalizeRandomScopeText,
  randomSourceValue
};
