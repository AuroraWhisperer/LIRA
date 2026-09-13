'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { normalizeImportedSongRow, SONG_IMPORT_ALIASES } = require('../src/music/song-import-schema');

function loadImportModule() {
  const context = {
    window: {
      AdminApp: {
        utils: {},
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../public/js/admin/import.js'),
      'utf8',
    ),
    context,
  );
  return context.window.AdminApp.imports;
}

test('text song import maps the permanent metadata columns', () => {
  const { parseTable } = loadImportModule();
  const [headered] = parseTable(
    '歌曲名字\t原唱/首发歌手\t歌曲分类\t歌曲标签\t是否可点\t语言\t点歌价格\t歌切\t核对平台\t核对备注\n' +
      '测试歌曲\t测试歌手\t流行\t抒情\t是\t国语\t舰长\tBV1HeaderedClip\tQQ音乐\t待核对',
  );
  const [legacyHeadered] = parseTable(
    '歌曲名字\t原唱/首发歌手\t歌曲分类\t歌曲标签\t是否可点\t语言\t核对平台\t核对备注\t点歌价格\t歌切\n' +
      '旧格式歌曲\t测试歌手\t流行\t抒情\t是\t国语\t网易云音乐\t旧备注\t免费\tBV1LegacyClip',
  );
  const [headerless] = parseTable(
    '测试歌曲\t测试歌手\t流行\t抒情\t是\t国语\t30元SC\tBV1PositionalClip\tQQ音乐\t待核对',
  );

  assert.equal(headered.requestPrice, '舰长');
  assert.equal(headered.songClip, 'BV1HeaderedClip');
  assert.equal(headered.sourcePlatform, 'QQ音乐');
  assert.equal(headered.note, '待核对');
  assert.equal(legacyHeadered.requestPrice, '免费');
  assert.equal(legacyHeadered.songClip, 'BV1LegacyClip');
  assert.equal(legacyHeadered.sourcePlatform, '网易云音乐');
  assert.equal(legacyHeadered.note, '旧备注');
  assert.equal(headerless.requestPrice, '30元SC');
  assert.equal(headerless.songClip, 'BV1PositionalClip');
  assert.equal(headerless.sourcePlatform, 'QQ音乐');
  assert.equal(headerless.note, '待核对');
});

test('text imports use backend price aliases and retain conflicting aliases for row validation', () => {
  const { parseTable } = loadImportModule();
  for (const alias of SONG_IMPORT_ALIASES.requestPrice) {
    for (const separator of [',', '\t']) {
      const [row] = parseTable(`歌曲名字${separator}${alias}\n别名测试${separator}"30元SC, ""原文""\n第二行"`);
      assert.equal(normalizeImportedSongRow(row).requestPrice, '30元SC, "原文"\n第二行');
    }
  }
  for (const headers of ['点歌条件\t点歌价格', '点歌价格\trequestPrice', 'requestPrice\t点歌说明']) {
    const [conflict] = parseTable(`歌曲名字\t${headers}\n冲突\t舰长\t30元SC`);
    assert.throws(() => normalizeImportedSongRow(conflict), /价格别名冲突/);
    const [same] = parseTable(`歌曲名字\t${headers}\n一致\t舰长\t舰长`);
    assert.equal(normalizeImportedSongRow(same).requestPrice, '舰长');
    const [blank] = parseTable(`歌曲名字\t${headers}\n留空\t\t提督`);
    assert.equal(normalizeImportedSongRow(blank).requestPrice, '提督');
  }
});
