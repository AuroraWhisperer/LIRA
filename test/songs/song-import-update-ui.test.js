'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function fixture({ reloadError } = {}) {
  const elements = new Map();
  function node() {
    return {
      value: '',
      checked: false,
      hidden: false,
      disabled: false,
      files: [],
      textContent: '',
      children: [],
      events: {},
      addEventListener(name, callback) {
        this.events[name] = callback;
      },
      replaceChildren() {
        this.children = [];
      },
      appendChild(child) {
        this.children.push(child);
      },
    };
  }
  function element(id) {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  }
  const calls = [];
  let reloadCount = 0;
  const context = vm.createContext({ document: {}, console });
  const module = new vm.SourceTextModule(
    fs.readFileSync(require.resolve('../../public/js/admin/song-import-update.js'), 'utf8'),
    { context },
  );
  await module.link((specifier) =>
    specifier === './song-import-parser.js'
      ? new vm.SourceTextModule(
          fs.readFileSync(require.resolve('../../public/js/admin/song-import-parser.js'), 'utf8'),
          {
            context,
          },
        )
      : new vm.SyntheticModule(
          ['api'],
          function () {
            this.setExport('api', () => {});
          },
          { context },
        ),
  );
  await module.evaluate();
  module.namespace.initSongImportUpdate({
    documentRef: { getElementById: element, createElement: node },
    imports: {
      readTextFile: async (file) => file.text,
      readFileAsBase64: async (file) => file.base64,
    },
    reloadSongs: async () => {
      reloadCount += 1;
      if (reloadError) throw reloadError;
    },
    request: (url, payload) => new Promise((resolve, reject) => calls.push({ url, payload, resolve, reject })),
  });

  function input(rows) {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    element('importText').value = [
      columns.join('\t'),
      ...rows.map((row) => columns.map((column) => row[column] ?? '').join('\t')),
    ].join('\n');
    element('importText').events.input();
  }
  async function preview(rows, data) {
    input(rows);
    const promise = element('songImportPreviewBtn').events.click();
    await Promise.resolve();
    calls.at(-1).resolve({ data });
    await promise;
  }
  return {
    element,
    calls,
    input,
    preview,
    reloadCount: () => reloadCount,
  };
}

function previewData(count = 1, canApply = true) {
  return {
    previewToken: 'original-token',
    canApply,
    counts: {
      inserted: count,
      updated: 0,
      unchanged: 0,
      conflict: 0,
      invalid: 0,
      deleted: 0,
    },
    rows: Array.from({ length: count }, (_, index) => ({
      row: index + 1,
      name: '<script>歌</script>',
      artist: '',
      status: 'inserted',
      differences: [{ field: 'requestPrice', before: null, after: '舰长' }],
    })),
  };
}

test('replacement page exposes no mode or add-only action and labels destructive confirmation', () => {
  const html = fs.readFileSync(require.resolve('../../public/pages/admin/song/import-export.html'), 'utf8');
  assert.doesNotMatch(html, /id="(?:songImportMode|songImportAllowEmptyClear|importBtn)"/);
  assert.match(html, /未列出的旧歌曲会删除/);
  assert.match(html, /id="songImportApplyBtn"[^>]*disabled>确认替换歌库/);
});

test('replacement preview shows deletions and invalid batches cannot be applied', async () => {
  const ui = await fixture();
  const data = previewData();
  data.counts.deleted = 1;
  data.rows.push({ row: null, name: '旧歌', artist: '', status: 'deleted', differences: [], reason: '未列出' });
  await ui.preview([{ name: '新歌' }], data);
  assert.match(ui.element('songImportPreviewSummary').textContent, /删除 1/);
  assert.equal(ui.element('songImportPreviewRows').children[1].children[0].textContent, '—');
  assert.equal(ui.element('songImportPreviewRows').children[1].children[2].textContent, '删除');
  assert.match(ui.element('importResult').textContent, /删除 1 首未列出的旧歌曲/);
  assert.equal(ui.calls.length, 1);
  await ui.preview([{ name: '' }], previewData(1, false));
  assert.equal(ui.element('songImportApplyBtn').disabled, true);
  await ui.element('songImportApplyBtn').events.click();
  assert.equal(ui.calls.length, 2);
});

test('Excel input uses the same replacement preview contract', async () => {
  const ui = await fixture();
  ui.element('importFile').files = [{ name: '歌单.xlsx', base64: 'fixture' }];
  const pending = ui.element('songImportPreviewBtn').events.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.calls[0].payload.replaceAll, true);
  assert.equal(ui.calls[0].payload.base64, 'fixture');
  ui.calls[0].resolve({ data: previewData() });
  await pending;
});

test('replacement UI has one preview action and paginates every row without inserting untrusted HTML', async () => {
  const ui = await fixture();
  assert.equal(ui.element('songImportPreviewBtn').disabled, false);
  await ui.preview([{ name: '歌' }], previewData(60));
  assert.equal(ui.element('songImportPreviewRows').children.length, 25);
  assert.equal(
    ui.element('songImportPreviewRows').children[0].children[1].textContent,
    '<script>歌</script> / （无歌手）',
  );
  ui.element('songImportNextPage').events.click();
  assert.equal(ui.element('songImportPreviewRows').children[0].children[0].textContent, '26');
  ui.element('songImportNextPage').events.click();
  assert.equal(ui.element('songImportPreviewRows').children.length, 10);
  assert.equal(ui.element('songImportNextPage').disabled, true);
  ui.element('songImportPreviousPage').events.click();
  assert.equal(ui.element('songImportPreviewRows').children.length, 25);
});

test('text and file changes invalidate previews and discard in-flight old responses', async () => {
  const ui = await fixture();
  ui.input([{ name: '旧' }]);
  const pending = ui.element('songImportPreviewBtn').events.click();
  await Promise.resolve();
  ui.input([{ name: '新' }]);
  ui.calls[0].resolve({ data: previewData() });
  await pending;
  assert.equal(ui.element('songImportPreview').hidden, true);
  assert.equal(ui.element('songImportApplyBtn').disabled, true);
  await ui.preview([{ name: '新' }], previewData());
  ui.element('importFile').events.change();
  assert.equal(ui.element('songImportApplyBtn').disabled, true);
});

test('confirmation submits the reviewed input and token once, while stale errors require a new preview', async () => {
  const ui = await fixture();
  await ui.preview([{ name: '歌', requestPrice: '' }], previewData());
  const applying = ui.element('songImportApplyBtn').events.click();
  await ui.element('songImportApplyBtn').events.click();
  assert.equal(ui.calls.length, 2);
  assert.equal(ui.calls[1].url, '/api/songs/import-apply');
  assert.equal(ui.calls[1].payload.previewToken, 'original-token');
  assert.equal(ui.calls[1].payload.replaceAll, true);
  assert.equal(ui.calls[1].payload.allowEmptyClear, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls[1].payload.rows)), [{ name: '歌', requestPrice: '' }]);
  ui.calls[1].resolve({ data: { inserted: 1, updated: 0, unchanged: 0, deleted: 0 } });
  await applying;
  assert.equal(ui.reloadCount(), 1);
  assert.match(ui.element('importResult').textContent, /本地歌库已替换：新增 1/);
  await ui.preview([{ name: '歌' }], previewData());
  const stale = ui.element('songImportApplyBtn').events.click();
  ui.calls.at(-1).reject(new Error('SONG_IMPORT_PREVIEW_STALE'));
  await stale;
  assert.match(ui.element('importResult').textContent, /已变化，请重新预览/);
  assert.equal(ui.element('songImportPreview').hidden, true);
  assert.equal(ui.element('songImportApplyBtn').disabled, true);
});

test('a failed list refresh preserves the committed result and cloud-sync distinction', async () => {
  const ui = await fixture({ reloadError: new Error('refresh unavailable') });
  await ui.preview([{ name: '歌' }], previewData());
  const applying = ui.element('songImportApplyBtn').events.click();
  ui.calls.at(-1).resolve({ data: { inserted: 1, updated: 0, unchanged: 0, deleted: 0 } });
  await applying;
  assert.equal(ui.reloadCount(), 1);
  assert.match(ui.element('importResult').textContent, /本地歌库已替换：新增 1/);
  assert.match(ui.element('importResult').textContent, /网页更新以云端同步结果为准/);
  assert.match(ui.element('importResult').textContent, /本地已保存，但列表刷新失败，请刷新页面/);
  assert.doesNotMatch(ui.element('importResult').textContent, /回滚/);
  assert.equal(ui.element('songImportApplyBtn').disabled, true);
});
