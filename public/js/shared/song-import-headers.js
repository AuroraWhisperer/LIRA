import { SONG_PRICE_HEADERS } from './song-import-price-columns.js';

export const SONG_IMPORT_ALIASES = {
  name: ['name', 'songName', '歌曲名字', '歌曲名称', '歌名', '曲名'],
  artist: ['artist', 'singer', '歌手'],
  categoryName: ['categoryName', 'category', '曲风'],
  note: ['note', '核对备注', '备注', '说明'],
  tags: ['tags', 'tag', '歌曲标签', '标签', '歌曲标签（如：怀旧、抒情、治愈）'],
  isEnabled: ['isEnabled', 'enabled', '是否可点', '可点', '是否启用', '启用'],
  language: ['language', '语言', '语种'],
  sourcePlatform: ['sourcePlatform', 'source', '核对平台', '来源平台', '平台', '来源'],
  requestPrice: SONG_PRICE_HEADERS,
  songClip: ['songClip', 'song_clip', '歌切', '歌切链接', '歌曲切片', '切片链接'],
};

const labels = new Set(Object.values(SONG_IMPORT_ALIASES).flat());
const enabledCells = new Set(['是', '可点', '启用', 'true', 'yes', 'y', '1', '否', '不可点', '停用', 'false', 'no', 'n', '0']);

export function hasSongImportHeader(row, table) {
  const isName = (cell) => SONG_IMPORT_ALIASES.name.includes(cell);
  // Extra fields cannot disambiguate the ten positional song columns. Keep a
  // name heading found only beyond those columns available to external tables.
  if (row.length > 10 && row.findIndex(isName) < 10) {
    row = row.slice(0, 10);
  }
  const isLabel = (cell) => labels.has(cell);
  if (row.length !== 10) return row.some(isLabel);
  // A complete set of headings with a missing name must still fail the preview.
  if (Array.from(row.slice(1)).every(isLabel)) return true;
  if (!row.some(isName)) return false;

  if (!row[0] && table.every(cells => !cells[0]?.trim())) return true;

  const flag = row[4] || '';
  const isFlagValue = enabledCells.has(flag.toLowerCase());
  const nameInNote = isName(row[9]);
  const onlyHeadings = row.every(cell => !cell || isLabel(cell));
  if (row[0] && onlyHeadings && (!nameInNote || (flag && !isFlagValue))) return true;
  if (!nameInNote) {
    // A named column can be surrounded entirely by external headings.
    if (row[0] && !isFlagValue) return true;
  } else if (!row.some((cell, index) => index !== 4 && index !== 9 && isLabel(cell))) {
    // 可点/启用 in E and 歌名 in the note are positional data. Keep an
    // invalid flag in that row too, so it cannot disappear from validation.
    if (flag && (!isFlagValue || SONG_IMPORT_ALIASES.isEnabled.includes(flag))) return false;
  }
  throw new Error('首行可能是表头，也可能是歌曲。请使用带完整表头的模板后重新预览。');
}
