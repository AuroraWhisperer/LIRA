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
        utils: {}
      }
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/js/admin/import.js'), 'utf8'),
    context
  );
  return context.window.AdminApp.imports;
}

test('text song import maps the permanent metadata columns', () => {
  const { parseTable } = loadImportModule();
  const [headered] = parseTable(
    '歌曲名字\t原唱/首发歌手\t歌曲分类\t歌曲标签\t是否可点\t语言\t核对平台\t核对备注\t点歌价格\t歌切\n' +
    '测试歌曲\t测试歌手\t流行\t抒情\t是\t国语\tQQ音乐\t\t舰长\tBV1HeaderedClip'
  );
  const [headerless] = parseTable(
    '测试歌曲\t测试歌手\t流行\t抒情\t是\t国语\tQQ音乐\t\t30元SC\tBV1PositionalClip'
  );

  assert.equal(headered.requestPrice, '舰长');
  assert.equal(headered.songClip, 'BV1HeaderedClip');
  assert.equal(headerless.requestPrice, '30元SC');
  assert.equal(headerless.songClip, 'BV1PositionalClip');
});
