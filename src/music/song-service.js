// 编写人：Aurora
// 歌曲 CRUD、分类管理、导入导出、随机选歌。
// 纯 music 域，不包含 Bilibili 逻辑。
'use strict';

const { now, cleanText, getInitial } = require('../shared/utils');
const {
  SONG_EXPORT_HEADERS,
  SONG_IMPORT_ALIASES,
  normalizeImportedSongRow,
} = require('./song-import-schema');
const {
  filterRandomSongCandidates,
  describeRandomSongScope,
  randomLanguageAliases,
} = require('./random-song-filter');
const {
  splitSongLanguages,
  splitSongArtists,
  splitSongTags,
  normalizeRandomScopeText,
  randomSourceValue,
} = require('./song-field-utils');

function saveSong(store, input) {
  const name = cleanText(input.name || input.songName);
  if (!name) throw new Error('歌曲名不能为空。');

  const hasRequestPrice =
    Object.prototype.hasOwnProperty.call(input, 'requestPrice') ||
    Object.prototype.hasOwnProperty.call(input, 'request_price');
  const hasSongClip =
    Object.prototype.hasOwnProperty.call(input, 'songClip') ||
    Object.prototype.hasOwnProperty.call(input, 'song_clip');
  const initial = getInitial(name);

  return store.saveSong({
    id: input.id ? Number(input.id) : null,
    name,
    namePinyin: initial,
    nameInitial: initial,
    artist: cleanText(input.artist),
    categoryName:
      cleanText(input.categoryName || input.category || '默认') || '默认',
    isEnabled: input.isEnabled === undefined ? 1 : input.isEnabled ? 1 : 0,
    note: cleanText(input.note),
    tags: cleanText(input.tags),
    language: cleanText(input.language),
    sourcePlatform: cleanText(input.sourcePlatform || input.source_platform),
    hasRequestPrice,
    requestPrice: cleanText(input.requestPrice ?? input.request_price),
    hasSongClip,
    songClip: cleanText(input.songClip ?? input.song_clip),
    updatedAt: now(),
  });
}

function listSongs(
  store,
  {
    query = '',
    category = '',
    categories = [],
    language = '',
    artist = '',
    tags = '',
    enabledOnly = false,
  } = {},
) {
  const cleanQuery = cleanText(query);
  const categoryValues = Array.isArray(categories) ? categories : [categories];
  const categoryFilters = (categoryValues.length ? categoryValues : [category])
    .map(cleanText)
    .filter(Boolean);
  const cleanLang = cleanText(language);
  const cleanArt = cleanText(artist);
  const tagValues = Array.isArray(tags) ? tags : [tags];
  const tagFilters = tagValues.map(cleanText).filter(Boolean);

  const rows = store.listRows({
    query: cleanQuery,
    categories: categoryFilters,
    language: cleanLang,
    artist: cleanArt,
    enabledOnly,
  });
  return rows
    .filter((row) => {
      if (
        cleanLang &&
        !splitSongLanguages(row.language).some(
          (value) => value === cleanLang,
        )
      ) {
        return false;
      }
      if (
        cleanArt &&
        !splitSongArtists(row.artist).some((value) => value === cleanArt)
      ) {
        return false;
      }
      if (tagFilters.length === 0) return true;
      const songTags = new Set(
        splitSongTags(row.tags).map((tag) => tag.toLocaleLowerCase()),
      );
      return tagFilters.every((tag) => songTags.has(tag.toLocaleLowerCase()));
    })
    .sort((a, b) => {
      const initialCompare = String(a.name_initial).localeCompare(
        String(b.name_initial),
        'zh-Hans-CN',
      );
      if (initialCompare !== 0) return initialCompare;
      return String(a.name).localeCompare(
        String(b.name),
        'zh-Hans-CN-u-co-pinyin',
      );
    })
    .map((row) => ({ ...row, is_enabled: Boolean(row.is_enabled) }));
}

function findSong(store, songName, artist) {
  const cleanName = cleanText(songName);
  const cleanArtist = cleanText(artist);
  if (!cleanName) return null;
  if (cleanArtist) {
    const exact = store.findByNameArtist(cleanName, cleanArtist);
    if (exact) return exact;
  }
  return store.findByName(cleanName);
}

function findUniqueSongNameMatch(store, songName) {
  const cleanName = cleanText(songName);
  if (!cleanName) return null;
  const exact = findSong(store, cleanName);
  if (exact) return exact;
  const matches = store.findEnabledByNameContains(cleanName);
  return matches.length === 1 ? matches[0] : null;
}

function deleteSong(store, id) {
  store.deleteSong(id);
}

function toggleSong(store, id) {
  return store.toggleSong(id, now());
}

function countSongs(store) {
  return store.countSongs();
}

function listCategories(store) {
  return store.listCategories();
}

function listTags(store) {
  const tags = new Set();
  for (const row of store.listTagRows()) {
    for (const tag of splitSongTags(row.tags)) tags.add(tag);
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function ensureCategory(store, name) {
  return store.ensureCategory(cleanText(name) || '默认');
}

function importSongs(store, rows) {
  const normalizedRows = rows.map(normalizeImportedSongRow);
  const failures = [];
  const validRows = [];
  for (let index = 0; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index];
    if (!row.name) {
      failures.push({ row: index + 1, reason: '歌曲名字为空' });
      continue;
    }
    validRows.push(row);
  }

  const result = store.importRows(validRows, {
    totalCount: normalizedRows.length,
    failedCount: failures.length,
  });
  return {
    total: normalizedRows.length,
    inserted: result.inserted,
    duplicate: result.duplicate,
    failed: failures.length,
    createdCategories: result.createdCategories,
    failures,
  };
}

function replaceCloudSongs(store, rows) {
  if (!Array.isArray(rows)) throw new Error('云端歌库格式无效。');
  if (rows.length > 5000) throw new Error('云端歌库超过 5000 首限制。');

  const byIdentity = new Map();
  for (const rawRow of rows) {
    const row = normalizeImportedSongRow({
      ...rawRow,
      name: rawRow?.name ?? rawRow?.title,
    });
    if (!row.name) throw new Error('云端歌库包含空歌名。');
    const enabled = rawRow?.isEnabled ?? rawRow?.enabled ?? rawRow?.is_enabled;
    if (enabled !== undefined) {
      row.isEnabled = !(
        enabled === false ||
        enabled === 0 ||
        String(enabled).toLowerCase() === 'false'
      );
    }
    byIdentity.set(`${row.name}\u0000${row.artist}`, row);
  }

  const songs = [...byIdentity.values()];
  store.replaceAll(songs);
  return {
    total: rows.length,
    count: songs.length,
    duplicate: rows.length - songs.length,
  };
}

function pickRandomSong(store, scopeText) {
  const rows = listRandomSongCandidates(store, scopeText);
  if (rows.length === 0) return null;

  const recentNames = new Set(store.listRecentRandomSongNames());
  const candidates = rows.filter((row) => !recentNames.has(row.name));
  const pool = candidates.length > 0 ? candidates : rows;
  return pool[Math.floor(Math.random() * pool.length)];
}

function listRandomSongCandidates(store, scopeText) {
  return filterRandomSongCandidates(
    store.listRandomRows(),
    normalizeRandomScopeText(scopeText),
  );
}

function describeRandomSongScopeInLibrary(store, scopeText) {
  return describeRandomSongScope(
    store.listRandomRows(),
    normalizeRandomScopeText(scopeText),
  );
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
  replaceCloudSongs,
  normalizeImportedSongRow,
  pickRandomSong,
  listRandomSongCandidates,
  describeRandomSongScope: describeRandomSongScopeInLibrary,
  randomLanguageAliases,
  normalizeRandomScopeText,
  randomSourceValue,
};
