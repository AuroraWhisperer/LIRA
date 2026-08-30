'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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
