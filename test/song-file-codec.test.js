'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const {
  buildSongsCsv,
  buildSongsWorkbook,
  parseSongsFromXlsx,
  templateSongs,
} = require('../src/music/song-file-codec');
const {
  SONG_IMPORT_ALIASES,
  normalizeImportedSongRow,
} = require('../src/music/song-import-schema');
const { createZip, readZipFiles } = require('../src/shared/xlsx-codec');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createSongStore } = require('../src/storage/song-store');
const songService = require('../src/music/song-service');
const { routes } = require('../src/server/routes/song-routes');

function loadCsvParser() {
  const context = { window: { AdminApp: { utils: {} } } };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/js/admin/import.js'), 'utf8'),
    context,
  );
  return context.window.AdminApp.imports;
}

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

test('song CSV protects formula prefixes and leading whitespace/control characters', () => {
  const { parseDelimited } = loadCsvParser();
  const inputs = [
    '=1+1', '+1+1', '-1+1', '@SUM(1,1)',
    '＝1+1', '＋1+1', '－1+1', '＠SUM(1,1)',
    ' =1+1', '\t=1+1', '\r=1+1', '\n=1+1', ' \t\r\n=1+1',
    '\u0000=1+1', '\u001f=1+1', '\u007f=1+1', '\u0085=1+1',
    '\u00a0=1+1', '\ufeff=1+1', '\u200b=1+1', '\u202e=1+1',
    '\t普通文字', ' \r普通文字', '\n普通文字',
    '-夜曲', '-10', '=1+1",=1+1', '=1+1\n普通文字',
  ];
  for (const name of inputs) {
    const csv = buildSongsCsv([{ name }]);
    assert.equal(parseDelimited(csv, ',')[1][0], `'${name}`, JSON.stringify(name));
    assert.ok(csv.split('\n')[1].startsWith('"\''), JSON.stringify(name));
  }
});

test('song CSV applies one text policy to every exported external field without mutating songs', () => {
  const { parseDelimited } = loadCsvParser();
  const song = Object.freeze({
    name: '=1+1', artist: '+1+1', category_name: '-分类', tags: '@标签',
    is_enabled: true, language: '=语言', request_price: '-10',
    song_clip: '=歌切', note: '=1+1,"备注"\n第二行',
  });
  const row = parseDelimited(buildSongsCsv([song]), ',')[1];
  assert.deepEqual(Array.from(row), [
    "'=1+1", "'+1+1", "'-分类", "'@标签", '是', "'=语言", "'-10", "'=歌切", '', "'=1+1,\"备注\"\n第二行",
  ]);
  const [xlsxRow] = parseSongsFromXlsx(buildSongsWorkbook([song]));
  assert.equal(xlsxRow['歌曲名字'], song.name);
  assert.equal(xlsxRow['核对备注'], song.note);
  assert.equal(song.name, '=1+1');
});

test('ordinary CSV text, original apostrophes, punctuation and empty fields keep their content', () => {
  const { parseDelimited } = loadCsvParser();
  for (const name of ['晴天', '夜-曲', 'A+B', '123', "'原有前缀", "'=1+1", "''=1+1", '中文,逗号"引号"\n第二行']) {
    const csv = buildSongsCsv([{ name, note: null }]);
    const row = parseDelimited(csv, ',')[1];
    assert.equal(row[0], name);
    assert.equal(row[9], '');
  }
  assert.equal(parseDelimited(buildSongsCsv([{}]), ',')[1][0], '');
});

test('CSV reimport retains the text marker instead of stripping original apostrophes', () => {
  const { parseTable } = loadCsvParser();
  for (const name of ['=1+1', '-夜曲', "'=1+1", "'原有前缀", '晴天']) {
    const [row] = parseTable(buildSongsCsv([{ name, note: '=1+1', is_enabled: true }]));
    const expected = /^[=-]/.test(name) ? `'${name}` : name;
    assert.equal(normalizeImportedSongRow(row).name, expected);
    assert.equal(row.note, "'=1+1");
    const [secondImport] = parseTable(buildSongsCsv([{ ...row, is_enabled: true }]));
    assert.equal(secondImport.name, expected);
  }
});

test('CSV and XLSX exports leave stored names and notes unchanged', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(SONG_SCHEMA);
    const store = createSongStore(db);
    songService.saveSong(store, { name: '=1+1', artist: '测试', note: '@备注' });
    const before = db.prepare('SELECT name, note FROM songs').all();
    const songs = songService.listSongs(store, {});
    buildSongsCsv(songs);
    const worksheet = readZipFiles(buildSongsWorkbook(songs)).get('xl/worksheets/sheet1.xml');
    assert.match(worksheet, /t="inlineStr"><is><t>=1\+1<\/t>/);
    assert.doesNotMatch(worksheet, /<f[\s>]/);
    assert.deepEqual(db.prepare('SELECT name, note FROM songs').all(), before);
  } finally {
    db.close();
  }
});

test('CSV template and library routes use the song codec output', () => {
  const songs = [{ name: '=1+1', note: '@备注' }];
  for (const [route, rows] of [
    ['GET /api/songs/template.csv', templateSongs()],
    ['GET /api/songs/export.csv', songs],
  ]) {
    const response = { writeHead() {}, end(body) { this.body = body; } };
    routes[route]({ songs: { list: () => songs } }, {}, response);
    assert.equal(response.body, `\ufeff${buildSongsCsv(rows)}\n`);
  }
  assert.equal(parseSongsFromXlsx(buildSongsWorkbook(templateSongs())).length, 2);
});

test('song workbook import preserves the supported 5000-song scale within default budgets', () => {
  const songs = Array.from({ length: 5000 }, (_, index) => ({
    ...templateSongs()[0], name: `合成歌曲${index}`, note: '边界验证',
  }));
  const workbook = buildSongsWorkbook(songs);
  assert.ok(workbook.length < 4 * 1024 * 1024);
  const parsed = parseSongsFromXlsx(workbook);
  assert.equal(parsed.length, 5000);
  assert.equal(parsed[4999]['歌曲名字'], '合成歌曲4999');
});
