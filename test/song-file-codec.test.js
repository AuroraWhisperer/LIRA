'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSongsCsv,
  buildSongsWorkbook,
  parseSongsFromXlsx
} = require('../src/music/song-file-codec');
const {
  SONG_IMPORT_ALIASES,
  normalizeImportedSongRow
} = require('../src/music/song-import-schema');
const { createZip, readZipFiles } = require('../src/shared/utils');
const songService = require('../src/music/song-service');

function namespaceWorksheetTags(buffer) {
  const files = readZipFiles(buffer);
  const worksheetPath = 'xl/worksheets/sheet1.xml';
  const worksheet = files.get(worksheetPath)
    .replace(/<worksheet xmlns="([^"]+)"/, '<worksheet xmlns="$1" xmlns:x="$1"')
    .replace(/t="inlineStr"><is><t>([\s\S]*?)<\/t><\/is>/g, 't="str"><v>$1</v>')
    .replace(/<(\/?)(row|c|is|t|v)(\b)/g, '<$1x:$2$3');
  files.set(worksheetPath, worksheet);
  return createZip(Array.from(files.entries()));
}

test('song workbook codec preserves export fields for the import schema', () => {
  const songs = [{
    name: '测试,歌曲',
    artist: '测试歌手',
    category_name: '流行',
    tags: '抒情,治愈',
    is_enabled: false,
    language: '国语',
    source_platform: 'QQ音乐',
    note: '导入测试'
  }];

  assert.match(buildSongsCsv(songs), /"测试,歌曲"/);
  const [row] = parseSongsFromXlsx(buildSongsWorkbook(songs));
  assert.deepEqual(normalizeImportedSongRow(row), {
    name: '测试,歌曲',
    artist: '测试歌手',
    categoryName: '流行',
    tags: '抒情,治愈',
    isEnabled: false,
    language: '国语',
    sourcePlatform: 'QQ音乐',
    note: '导入测试'
  });
});

test('song service keeps its import schema compatibility exports', () => {
  assert.equal(songService.SONG_IMPORT_ALIASES, SONG_IMPORT_ALIASES);
  assert.equal(songService.normalizeImportedSongRow, normalizeImportedSongRow);
});

test('song workbook codec parses namespace-prefixed worksheet tags', () => {
  const workbook = buildSongsWorkbook([{
    name: 'Namespaced song',
    artist: 'Test artist',
    category_name: 'Test category',
    is_enabled: true
  }]);

  const [row] = parseSongsFromXlsx(namespaceWorksheetTags(workbook));

  assert.equal(normalizeImportedSongRow(row).name, 'Namespaced song');
});
