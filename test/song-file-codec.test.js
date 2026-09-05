'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const {
  buildSongsCsv,
  buildSongsWorkbook,
  parseSongsFromXlsx,
} = require('../src/music/song-file-codec');
const {
  SONG_IMPORT_ALIASES,
  normalizeImportedSongRow,
} = require('../src/music/song-import-schema');
const { createZip, readZipFiles } = require('../src/shared/xlsx-codec');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createSongStore } = require('../src/storage/song-store');
const songService = require('../src/music/song-service');

function namespaceWorksheetTags(buffer) {
  const files = readZipFiles(buffer);
  const worksheetPath = 'xl/worksheets/sheet1.xml';
  const worksheet = files
    .get(worksheetPath)
    .replace(/<worksheet xmlns="([^"]+)"/, '<worksheet xmlns="$1" xmlns:x="$1"')
    .replace(/t="inlineStr"><is><t>([\s\S]*?)<\/t><\/is>/g, 't="str"><v>$1</v>')
    .replace(/<(\/?)(row|c|is|t|v)(\b)/g, '<$1x:$2$3');
  files.set(worksheetPath, worksheet);
  return createZip(Array.from(files.entries()));
}

test('song workbook codec uses the default column order and leaves the exported source platform blank', () => {
  const songs = [
    {
      name: '测试,歌曲',
      artist: '测试歌手',
      category_name: '流行',
      tags: '抒情,治愈',
      is_enabled: false,
      language: '国语',
      source_platform: 'QQ音乐',
      note: '导入测试',
      request_price: '30元SC',
      song_clip: 'BV1SongClip',
    },
  ];

  const csv = buildSongsCsv(songs);
  assert.match(csv, /语言,点歌价格,歌切,核对平台,核对备注/);
  assert.match(csv, /"测试,歌曲"/);
  assert.match(csv, /30元SC/);
  const [row] = parseSongsFromXlsx(buildSongsWorkbook(songs));
  assert.deepEqual(normalizeImportedSongRow(row), {
    name: '测试,歌曲',
    artist: '测试歌手',
    categoryName: '流行',
    tags: '抒情,治愈',
    isEnabled: false,
    language: '国语',
    sourcePlatform: '',
    note: '导入测试',
    requestPrice: '30元SC',
    songClip: 'BV1SongClip',
  });
});

test('song service persists workbook metadata columns and preserves them on edit', () => {
  const db = new DatabaseSync(':memory:');
  const songStore = createSongStore(db);
  try {
    db.exec(SONG_SCHEMA);
    const rows = parseSongsFromXlsx(
      buildSongsWorkbook([
        {
          name: '付费点歌测试',
          artist: '测试歌手',
          category_name: '流行',
          is_enabled: true,
          request_price: '舰长',
          song_clip: 'BV1ImportedClip',
        },
      ]),
    );

    assert.equal(songService.importSongs(songStore, rows).inserted, 1);
    const imported = db
      .prepare(
        `
      SELECT id, name, artist, request_price, song_clip FROM songs WHERE name = ?
    `,
      )
      .get('付费点歌测试');
    assert.equal(imported.request_price, '舰长');
    assert.equal(imported.song_clip, 'BV1ImportedClip');

    songService.saveSong(songStore, {
      id: imported.id,
      name: imported.name,
      artist: imported.artist,
      categoryName: '流行',
    });
    const edited = db
      .prepare(
        `
      SELECT request_price, song_clip FROM songs WHERE id = ?
    `,
      )
      .get(imported.id);
    assert.equal(edited.request_price, '舰长');
    assert.equal(edited.song_clip, 'BV1ImportedClip');
  } finally {
    db.close();
  }
});

test('song service keeps its import schema compatibility exports', () => {
  assert.equal(songService.SONG_IMPORT_ALIASES, SONG_IMPORT_ALIASES);
  assert.equal(songService.normalizeImportedSongRow, normalizeImportedSongRow);
});

test('song workbook codec parses namespace-prefixed worksheet tags', () => {
  const workbook = buildSongsWorkbook([
    {
      name: 'Namespaced song',
      artist: 'Test artist',
      category_name: 'Test category',
      is_enabled: true,
    },
  ]);

  const [row] = parseSongsFromXlsx(namespaceWorksheetTags(workbook));

  assert.equal(normalizeImportedSongRow(row).name, 'Namespaced song');
});
