'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createSongStore } = require('../src/storage/song-store');
const songService = require('../src/music/song-service');
const {
  previewSongImport,
  applySongImport,
} = require('../src/music/song-import-update');
const {
  buildSongsWorkbook,
  parseSongsFromXlsx,
  buildSongsCsv,
} = require('../src/music/song-file-codec');
const { readZipFiles, createZip } = require('../src/shared/xlsx-codec');
const { routes } = require('../src/server/routes/song-routes');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  t.after(() => db.close());
  const store = createSongStore(db);
  return {
    db,
    store,
    save: (song) => songService.saveSong(store, song),
    preview: (input) => previewSongImport(store, input),
    apply: (input, preview) =>
      applySongImport(store, { ...input, previewToken: preview.previewToken }),
  };
}

function textParser() {
  const context = { window: { AdminApp: { utils: {} } } };
  vm.runInNewContext(
    readJsModuleBundle('public', 'js', 'admin', 'song-import-parser.js') +
      '\nthis.parser = { parseTable, parseDelimited };',
    context,
  );
  return context.parser.parseTable;
}

test('update preview preserves omitted and blank fields and matches exact artist including disabled songs', (t) => {
  const { store, save, preview, apply } = fixture(t);
  const original = save({
    name: '同歌',
    artist: '甲',
    categoryName: '原分类',
    isEnabled: false,
    requestPrice: '舰长',
    songClip: 'BV1',
    tags: '原标签',
    language: '国语',
    note: '备注',
    sourcePlatform: 'QQ音乐',
  });
  const other = save({ name: '同歌', artist: '乙', requestPrice: '总督' });
  const input = {
    rows: [
      {
        name: '同歌',
        artist: '甲',
        requestPrice: '30元SC',
        songClip: '',
        categoryName: '',
      },
      { name: '新歌', artist: '丙', requestPrice: '免费' },
    ],
  };
  const plan = preview(input);
  assert.deepEqual(plan.counts, {
    inserted: 1,
    updated: 1,
    unchanged: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.equal(plan.changes, undefined);
  assert.deepEqual(plan.rows[0].differences, [
    { field: 'requestPrice', before: '舰长', after: '30元SC' },
  ]);
  assert.equal(store.listRows().length, 2, 'preview does not mutate');
  assert.equal(apply(input, plan).updated, 1);
  const songs = store.listRows();
  const edited = songs.find((song) => song.id === original.id);
  assert.equal(edited.request_price, '30元SC');
  for (const field of [
    'song_clip',
    'tags',
    'language',
    'note',
    'source_platform',
    'is_enabled',
    'category_id',
  ]) {
    assert.equal(edited[field], original[field], field);
  }
  assert.equal(
    songs.find((song) => song.id === other.id).request_price,
    '总督',
  );
  assert.equal(songs.length, 3);
  assert.throws(() => apply(input, plan), {
    code: 'SONG_IMPORT_PREVIEW_STALE',
  });
});

test('allow empty clears only present text fields, defaults category and preserves blank enabled values', (t) => {
  const { save, store, preview, apply } = fixture(t);
  save({
    name: '原歌',
    artist: '甲',
    requestPrice: '舰长',
    songClip: 'BV1',
    categoryName: '流行',
    tags: '标签',
    isEnabled: false,
  });
  const input = {
    rows: [
      {
        name: '原歌',
        artist: '甲',
        requestPrice: '',
        songClip: '',
        categoryName: '',
        isEnabled: '',
      },
    ],
    allowEmptyClear: true,
  };
  const plan = preview(input);
  assert.deepEqual(
    plan.rows[0].differences.map((diff) => diff.field),
    ['categoryName', 'requestPrice', 'songClip'],
  );
  apply(input, plan);
  const [song] = store.listRows();
  assert.equal(song.request_price, '');
  assert.equal(song.song_clip, '');
  assert.equal(song.category_name, '默认');
  assert.equal(song.tags, '标签');
  assert.equal(song.is_enabled, 0);
  const enabledInput = {
    rows: [{ name: '原歌', artist: '甲', isEnabled: '是' }],
  };
  apply(enabledInput, preview(enabledInput));
  assert.equal(store.listRows()[0].is_enabled, 1);
});

test('file duplicates collapse identical content and all differing identities become conflicts', (t) => {
  const { preview, apply, store } = fixture(t);
  const input = {
    rows: [
      { name: '冲突', artist: '甲', requestPrice: '舰长' },
      { name: '冲突', artist: '甲', requestPrice: '提督' },
      { name: '相同', artist: '乙', 点歌价格: '免费' },
      { name: '相同', artist: '乙', 点歌说明: '免费' },
    ],
  };
  const plan = preview(input);
  assert.deepEqual(plan.counts, {
    inserted: 1,
    updated: 0,
    unchanged: 1,
    conflict: 2,
    invalid: 0,
  });
  assert.equal(plan.canApply, false);
  assert.match(plan.rows[0].reason, /1、2/);
  assert.throws(() => apply(input, plan), {
    code: 'SONG_IMPORT_PREVIEW_INVALID',
  });
  assert.equal(store.countSongs(), 0);
  const same = { rows: input.rows.slice(2) };
  const result = apply(same, preview(same));
  assert.equal(result.inserted, 1);
  assert.equal(result.unchanged, 1);
});

test('invalid rows and conflicting price aliases are visible and block the batch', (t) => {
  const { preview, apply } = fixture(t);
  const input = {
    rows: [
      { name: '', requestPrice: '舰长' },
      { name: '长价格', requestPrice: '🎵'.repeat(501) },
      { name: '格式', requestPrice: {} },
      { name: '状态', isEnabled: '也许' },
      { name: '别名', requestPrice: '舰长', 点歌条件: '提督' },
      { name: '正常', requestPrice: 0, isEnabled: false },
    ],
  };
  const plan = preview(input);
  assert.deepEqual(plan.counts, {
    inserted: 1,
    updated: 0,
    unchanged: 0,
    conflict: 1,
    invalid: 4,
  });
  assert.equal(
    plan.rows[5].differences.find((diff) => diff.field === 'isEnabled').after,
    false,
  );
  assert.equal(
    plan.rows[5].differences.find((diff) => diff.field === 'requestPrice')
      .after,
    '0',
  );
  assert.throws(() => apply(input, plan), {
    code: 'SONG_IMPORT_PREVIEW_INVALID',
  });
  for (const badInput of [
    { rows: [] },
    { rows: Array(5001).fill({ name: '歌' }) },
    { rows: [{}], allowEmptyClear: 'true' },
  ]) {
    assert.throws(() => preview(badInput), {
      code: 'SONG_IMPORT_INPUT_INVALID',
    });
  }
});

test('stale song, category, source input or clear option rejects before writes', (t) => {
  const { store, save, preview, apply } = fixture(t);
  save({ name: '原歌', requestPrice: '舰长' });
  const input = { rows: [{ name: '原歌', requestPrice: '提督' }] };
  let plan = preview(input);
  assert.throws(
    () => apply({ rows: [{ name: '原歌', requestPrice: '总督' }] }, plan),
    { code: 'SONG_IMPORT_PREVIEW_STALE' },
  );
  assert.throws(() => apply({ ...input, allowEmptyClear: true }, plan), {
    code: 'SONG_IMPORT_PREVIEW_STALE',
  });
  save({ name: '无关新歌' });
  assert.throws(() => apply(input, plan), {
    code: 'SONG_IMPORT_PREVIEW_STALE',
  });
  plan = preview(input);
  store.ensureCategory('尚未使用的新分类');
  assert.throws(() => apply(input, plan), {
    code: 'SONG_IMPORT_PREVIEW_STALE',
  });
  assert.equal(
    store.listRows().find((song) => song.name === '原歌').request_price,
    '舰长',
  );
});

test('new songs cannot exceed the final 5000-song library boundary while existing updates remain available', (t) => {
  const { store, preview, apply } = fixture(t);
  store.importRows(
    Array.from({ length: 5000 }, (_, index) => ({
      name: `歌曲${index}`,
      artist: '',
      isEnabled: true,
    })),
  );
  const input = { rows: [{ name: '第5001首' }] };
  const plan = preview(input);
  assert.equal(plan.canApply, false);
  assert.equal(plan.counts.invalid, 1);
  assert.match(plan.rows[0].reason, /5000/);
  assert.throws(() => apply(input, plan), {
    code: 'SONG_IMPORT_PREVIEW_INVALID',
  });
  const update = { rows: [{ name: '歌曲0', requestPrice: '舰长' }] };
  apply(update, preview(update));
  assert.equal(store.countSongs(), 5000);
  store.importRows([{ name: '历史超限歌曲', isEnabled: true }]);
  const overLimitUpdate = { rows: [{ name: '歌曲0', requestPrice: '提督' }] };
  const overLimitPlan = preview(overLimitUpdate);
  assert.equal(overLimitPlan.canApply, false);
  assert.equal(overLimitPlan.counts.invalid, 1);
  assert.throws(() => apply(overLimitUpdate, overLimitPlan), {
    code: 'SONG_IMPORT_PREVIEW_INVALID',
  });
});

test('write failure rolls back updates, inserted categories, rows and import batch', (t) => {
  const { db, save, store, preview, apply } = fixture(t);
  save({ name: '原歌', requestPrice: '舰长' });
  const input = {
    rows: [
      { name: '原歌', requestPrice: '提督', categoryName: '新分类' },
      { name: '失败歌曲', categoryName: '失败分类' },
    ],
  };
  const plan = preview(input);
  const before = store.listRows();
  const categories = store.listCategories();
  db.exec(
    "CREATE TRIGGER reject_import BEFORE INSERT ON songs WHEN NEW.name = '失败歌曲' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  );
  assert.throws(() => apply(input, plan), /fixture failure/);
  assert.deepEqual(store.listRows(), before);
  assert.deepEqual(store.listCategories(), categories);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM import_batches').get().count,
    0,
  );
});

test('update parsing preserves missing columns and empty-name data rows across text and XLSX', (t) => {
  const { preview } = fixture(t);
  const parseTable = textParser();
  for (const separator of ['\t', ',']) {
    const rows = parseTable(
      `歌曲名字${separator}点歌价格\n测试${separator}舰长\n${separator}提督`,
      { preserveMissing: true },
    );
    assert.equal(rows.length, 2);
    assert.equal(Object.hasOwn(rows[0], 'isEnabled'), false);
    assert.equal(preview({ rows }).counts.invalid, 1);
  }
  assert.throws(
    () => parseTable('无表头\t测试歌手', { preserveMissing: true }),
    /完整十列/,
  );
  assert.equal(
    parseTable('歌\t测试歌手\t\t\t\t\t舰长\t\t\t', { preserveMissing: true })
      .length,
    1,
  );
  const files = readZipFiles(
    buildSongsWorkbook([
      { name: '有效', request_price: '舰长' },
      { name: '', request_price: '提督' },
    ]),
  );
  const xml = files
    .get('xl/worksheets/sheet1.xml')
    .replace(/<c r="[B-FH-J]\d+"[\s\S]*?<\/c>/g, '');
  files.set('xl/worksheets/sheet1.xml', xml);
  const rows = parseSongsFromXlsx(createZip([...files]), {
    preserveMissing: true,
  });
  assert.equal(rows.length, 2);
  assert.equal(Object.hasOwn(rows[0], '是否可点'), false);
  assert.equal(preview({ rows }).counts.invalid, 1);
});

test('platform export preserves stored values with CSV formula protection and XLSX text cells', () => {
  const song = {
    name: '测试',
    source_platform: '=平台,"说明"',
    is_enabled: true,
  };
  const [xlsx] = parseSongsFromXlsx(buildSongsWorkbook([song]));
  const [csv] = textParser()(buildSongsCsv([song]));
  assert.equal(xlsx['核对平台'], song.source_platform);
  assert.equal(csv.sourcePlatform, `'${song.source_platform}`);
});

test('preview/apply routes use server plans, reject stale requests and publish only once on success', async (t) => {
  const { preview, store } = fixture(t);
  const signals = [];
  const context = {
    songs: {
      previewImport: preview,
      applyImport: (input) => applySongImport(store, input),
    },
    broadcastSnapshot: (reason) => signals.push(reason),
    cloudSync: { request: (scope) => signals.push(scope) },
  };
  async function call(path, body) {
    const response = {
      writeHead(status) {
        this.status = status;
      },
      end(value) {
        this.body = JSON.parse(value);
      },
    };
    await routes[`POST /api/songs/${path}`](
      context,
      { body: async () => body },
      response,
    );
    return response;
  }
  const input = { rows: [{ name: '更新导入', requestPrice: '舰长' }] };
  for (const invalid of [
    null,
    [],
    'text',
    { base64: 1 },
    { base64: '', rows: [] },
  ]) {
    const response = await call('import-preview', invalid);
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'SONG_IMPORT_INPUT_INVALID');
  }
  const plan = await call('import-preview', input);
  assert.equal(plan.status, 200);
  assert.equal(signals.length, 0);
  const stale = await call('import-apply', {
    ...input,
    previewToken: 'untrusted',
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'SONG_IMPORT_PREVIEW_STALE');
  assert.equal(signals.length, 0);
  const applied = await call('import-apply', {
    ...input,
    previewToken: plan.body.data.previewToken,
  });
  assert.equal(applied.status, 200);
  assert.deepEqual(signals, ['songs:import', 'songs']);
  assert.equal(store.countSongs(), 1);
});
