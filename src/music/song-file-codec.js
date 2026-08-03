'use strict';

const {
  cleanText,
  csvCell,
  escapeXml,
  columnName,
  createZip,
  readZipFiles,
  parseSharedStrings,
  parseWorksheetXml
} = require('../shared/utils');
const {
  SONG_EXPORT_HEADERS,
  SONG_IMPORT_ALIASES,
  firstValue
} = require('./song-import-schema');

function parseSongsFromXlsx(buffer) {
  if (!buffer.length) throw new Error('Excel 文件为空。');
  const files = readZipFiles(buffer);
  const worksheetEntry = Array.from(files.keys()).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  if (!worksheetEntry) throw new Error('Excel 文件里没有找到工作表。');
  const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml') || '');
  const table = parseWorksheetXml(files.get(worksheetEntry), sharedStrings);
  if (table.length === 0) return [];
  const header = table[0].map((cell) => cleanText(cell));
  const allAliases = Object.values(SONG_IMPORT_ALIASES).flat();
  const hasHeader = header.some((cell) => allAliases.includes(cell));
  const bodyRows = hasHeader ? table.slice(1) : table;
  return bodyRows.map((row) => {
    const output = {};
    const sourceHeader = hasHeader ? header : SONG_EXPORT_HEADERS;
    for (let i = 0; i < sourceHeader.length; i += 1) output[sourceHeader[i]] = row[i] || '';
    return output;
  }).filter((row) => cleanText(firstValue(row, SONG_IMPORT_ALIASES.name)));
}

function songToExportRow(song) {
  return [
    song.name || '', song.artist || '', song.category_name || '默认',
    song.tags || '', song.is_enabled ? '是' : '否',
    song.language || '', song.source_platform || '', song.note || ''
  ];
}

function buildSongsCsv(rows) {
  return [SONG_EXPORT_HEADERS.join(',')]
    .concat(rows.map((song) => songToExportRow(song).map(csvCell).join(',')))
    .join('\n');
}

function templateSongs() {
  return [
    { name:'晴天',artist:'周杰伦',category_name:'流行',tags:'怀旧,抒情,治愈',is_enabled:true,language:'国语',source_platform:'QQ音乐 / 网易云音乐',note:'' },
    { name:'小幸运',artist:'田馥甄',category_name:'流行',tags:'抒情,治愈',is_enabled:true,language:'国语',source_platform:'QQ音乐 / 网易云音乐',note:'' }
  ];
}

function buildSongsWorkbook(rows) {
  const tableRows = [SONG_EXPORT_HEADERS].concat(rows.map(songToExportRow));
  const sheetRows = tableRows.map((row, ri) => {
    const rn = ri + 1;
    const cells = row.map((cell, ci) =>
      '<c r="' + columnName(ci) + rn + '" t="inlineStr"><is><t>' + escapeXml(cell) + '</t></is></c>'
    ).join('');
    return '<row r="' + rn + '">' + cells + '</row>';
  }).join('');

  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews>\n' +
    '<sheetFormatPr defaultRowHeight="18"/>\n' +
    '<cols><col min="1" max="1" width="24" customWidth="1"/>' +
    '<col min="2" max="2" width="18" customWidth="1"/>' +
    '<col min="3" max="3" width="16" customWidth="1"/>' +
    '<col min="4" max="9" width="20" customWidth="1"/></cols>\n' +
    '<sheetData>' + sheetRows + '</sheetData>\n</worksheet>';

  return createZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n<Default Extension="xml" ContentType="application/xml"/>\n<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n</Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n<sheets><sheet name="歌库" sheetId="1" r:id="rId1"/></sheets>\n</workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n</Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n<fonts count="1"><font><sz val="11"/><name val="Microsoft YaHei"/></font></fonts>\n<fills count="1"><fill><patternFill patternType="none"/></fill></fills>\n<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\n<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\n<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>\n</styleSheet>'],
    ['xl/worksheets/sheet1.xml', sheetXml]
  ]);
}

module.exports = {
  parseSongsFromXlsx,
  buildSongsCsv,
  buildSongsWorkbook,
  templateSongs,
  songToExportRow
};
