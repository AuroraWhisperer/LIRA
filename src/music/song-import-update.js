'use strict';

const { createHash } = require('node:crypto');
const { SONG_IMPORT_ALIASES, normalizeImportedSongRow } = require('./song-import-schema');
const { cleanText } = require('../shared/utils');

const STORED_FIELDS = {
  name: 'name', artist: 'artist', categoryName: 'category_name', tags: 'tags',
  isEnabled: 'is_enabled', language: 'language', requestPrice: 'request_price',
  songClip: 'song_clip', sourcePlatform: 'source_platform', note: 'note',
};

function importError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function buildImportPlan(currentSongs, input, currentCategories) {
  if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > 5000 ||
      (input.allowEmptyClear !== undefined && typeof input.allowEmptyClear !== 'boolean')) {
    throw importError('SONG_IMPORT_INPUT_INVALID', '请提供 1 至 5000 行歌曲，空值选项必须是布尔值。', 400);
  }
  const allowEmptyClear = input.allowEmptyClear === true;
  const byIdentity = new Map(currentSongs.map((song) => [JSON.stringify([song.name, song.artist || '']), song]));
  const groups = new Map();
  const rows = input.rows.map((raw, index) => {
    const entry = { row: index + 1, name: '', artist: '', status: 'invalid', differences: [] };
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('歌曲行必须是对象');
      const present = Object.keys(STORED_FIELDS).filter((field) =>
        SONG_IMPORT_ALIASES[field].some((key) => Object.hasOwn(raw, key)));
      for (const field of present) {
        for (const alias of SONG_IMPORT_ALIASES[field]) {
          const value = raw[alias];
          if (value == null) continue;
          if (!['string', 'number'].includes(typeof value) && !(field === 'isEnabled' && typeof value === 'boolean')) {
            throw new Error(`字段 ${field} 必须是文本`);
          }
        }
      }
      const song = normalizeImportedSongRow(raw);
      entry.name = song.name;
      entry.artist = song.artist;
      if (!song.name) throw new Error('歌曲名字为空');
      if (song.requestPrice.length > 1000) throw new Error('点歌价格超过 1000 长度限制');
      const blank = new Set(present.filter((field) => !SONG_IMPORT_ALIASES[field]
        .some((key) => Object.hasOwn(raw, key) && String(raw[key] ?? '').trim() !== '')));
      if (present.includes('isEnabled') && !blank.has('isEnabled')) {
        const value = SONG_IMPORT_ALIASES.isEnabled.map((key) => raw[key])
          .find((value) => value != null && String(value).trim() !== '');
        const enabled = String(value).trim().toLowerCase();
        if (!['是', '可点', '启用', 'true', 'yes', 'y', '1', '否', '不可点', '停用', 'false', 'no', 'n', '0'].includes(enabled)) {
          throw new Error('是否可点必须填写明确的是/否');
        }
        song.isEnabled = ['是', '可点', '启用', 'true', 'yes', 'y', '1'].includes(enabled);
      }
      const key = JSON.stringify([song.name, song.artist]);
      const signature = JSON.stringify(present.map((field) => [field, blank.has(field) ? '' : song[field]]));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ entry, song, present, blank, signature, existing: byIdentity.get(key) });
      entry.status = 'unchanged';
    } catch (error) {
      entry.name = cleanText(raw?.name ?? raw?.['歌曲名字']);
      entry.reason = error.message;
      if (String(error.message).includes('价格别名冲突')) entry.status = 'conflict';
    }
    return entry;
  });

  const changes = [];
  for (const group of groups.values()) {
    if (new Set(group.map((item) => item.signature)).size > 1) {
      for (const { entry } of group) {
        entry.status = 'conflict';
        entry.reason = `同一歌曲在数据第 ${group.map((item) => item.entry.row).join('、')} 行内容不同`;
      }
      continue;
    }
    const { entry, song, present, blank, existing } = group[0];
    for (const duplicate of group.slice(1)) {
      duplicate.entry.reason = `与数据第 ${entry.row} 行相同，仅处理一次`;
    }
    const after = existing ? Object.fromEntries(Object.entries(STORED_FIELDS)
      .map(([field, column]) => [field, field === 'isEnabled' ? Boolean(existing[column]) : existing[column] ?? ''])) : { ...song };
    if (existing) {
      for (const field of present) {
        if (field === 'name' || field === 'artist') continue;
        if (blank.has(field) && (!allowEmptyClear || field === 'isEnabled')) continue;
        after[field] = song[field];
      }
    }
    entry.differences = Object.entries(STORED_FIELDS).flatMap(([field, column]) => {
      const before = existing ? (field === 'isEnabled' ? Boolean(existing[column]) : existing[column] ?? '') : null;
      return before === after[field] ? [] : [{ field, before, after: after[field] }];
    });
    entry.status = existing ? (entry.differences.length ? 'updated' : 'unchanged') : 'inserted';
    if (entry.status !== 'unchanged') changes.push({ id: existing?.id, song: after });
  }
  const insertedCount = rows.filter((row) => row.status === 'inserted').length;
  if (currentSongs.length + insertedCount > 5000) {
    for (const row of rows) {
      if (row.status !== 'inserted' && row.status !== 'updated') continue;
      row.status = 'invalid';
      row.reason = '结果歌库超过 5000 首，无法完整同步；请先在歌库整理至 5000 首以内。';
    }
  }
  const counts = { inserted: 0, updated: 0, unchanged: 0, conflict: 0, invalid: 0 };
  for (const row of rows) counts[row.status] += 1;
  const previewToken = createHash('sha256').update(JSON.stringify({ currentSongs, currentCategories, rows: input.rows, allowEmptyClear })).digest('hex');
  return { previewToken, counts, rows, canApply: !counts.conflict && !counts.invalid && changes.length > 0, changes };
}

function previewSongImport(store, input) {
  const { changes, ...preview } = buildImportPlan(store.listRows(), input, store.listCategories());
  return preview;
}

function applySongImport(store, input) {
  return store.applyImportUpdate((currentSongs, currentCategories) => {
    const plan = buildImportPlan(currentSongs, input, currentCategories);
    if (input.previewToken !== plan.previewToken) {
      throw importError('SONG_IMPORT_PREVIEW_STALE', '歌库或导入内容已变化，请重新预览。', 409);
    }
    if (!plan.canApply) {
      throw importError('SONG_IMPORT_PREVIEW_INVALID', '请修正冲突或无效行后重新预览；没有变更时无需应用。', 422);
    }
    return plan;
  });
}

module.exports = { previewSongImport, applySongImport };
