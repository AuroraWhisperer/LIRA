'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');
const { installComponentStyle } = require('../../src/server/component-style-install');
const { createScratchDirectory } = require('../helpers/scratch-directory');

async function fixture(t) {
  const dataDir = createScratchDirectory('style-recovery-', t);
  const store = createComponentStyleStore(dataDir);
  const pack = { id: randomUUID(), name: '恢复测试', styles: [{ id: randomUUID(), type: 'clock', config: { label: '初始' } }] };
  store.stage(pack); await installComponentStyle(store, pack.id, () => {});
  return { dataDir, store, pack, index: path.join(store.root, 'index.json'), backup: path.join(store.root, 'index.backup.json') };
}

test('reopened style stores reuse verified indexes and detect external edits without rescanning unchanged files', async t => {
  const f = await fixture(t);
  createComponentStyleStore(f.dataDir).read();
  const reads = t.mock.method(fs, 'readFileSync');
  const scans = t.mock.method(fs, 'readdirSync');
  for (let i = 0; i < 20; i++) {
    const value = createComponentStyleStore(f.dataDir).read();
    value.packages[0].styles[0].config.label = '未提交的修改';
  }
  assert.equal(reads.mock.callCount(), 0);
  assert.equal(scans.mock.callCount(), 0);
  assert.equal(f.store.read().packages[0].styles[0].config.label, '初始');
  const external = { version: 1, packages: [{ ...f.pack, styles: [{ ...f.pack.styles[0], config: { label: '外部编辑' } }] }] };
  fs.writeFileSync(f.index, JSON.stringify(external));
  assert.equal(f.store.read().packages[0].styles[0].config.label, '外部编辑');
  assert.ok(reads.mock.callCount() >= 1);
  fs.unlinkSync(f.backup);
  assert.equal(f.store.integrity().backupCurrent, true);
  assert.ok(fs.existsSync(f.backup));
});

test('temporary style cleanup is throttled and later reclaims expired files after their active import ends', async t => {
  const { beginStyleFileUse, endStyleFileUse, pruneStyleTemporaryFiles } = require('../../src/storage/component-style-files');
  const f = await fixture(t);
  const pending = f.store.directory(randomUUID(), true);
  fs.mkdirSync(pending);
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  fs.utimesSync(pending, new Date(now - 25 * hour), new Date(now - 25 * hour));
  beginStyleFileUse(pending);
  try {
    pruneStyleTemporaryFiles(f.store.root, now + hour);
    assert.ok(fs.existsSync(pending), 'active imports remain protected even when old');
  } finally { endStyleFileUse(pending); }
  pruneStyleTemporaryFiles(f.store.root, now + hour + 1);
  assert.ok(fs.existsSync(pending), 'repeated reads do not rescan the same directory');
  pruneStyleTemporaryFiles(f.store.root, now + 2 * hour + 1);
  assert.equal(fs.existsSync(pending), false);
});

for (const failure of ['corrupt', 'missing', 'invalid-shape']) test(`library restores the latest committed parameters from its recovery copy (${failure})`, async t => {
  const f = await fixture(t);
  f.store.updateConfig(f.pack.styles[0].id, () => ({ label: '已经保存' }));
  const committed = fs.readFileSync(f.index, 'utf8');
  assert.equal(fs.readFileSync(f.backup, 'utf8'), committed);
  if (failure === 'missing') fs.unlinkSync(f.index);
  else fs.writeFileSync(f.index, failure === 'corrupt' ? '{broken' : '{"version":1,"packages":null}');
  const reopened = createComponentStyleStore(f.dataDir);
  assert.equal(reopened.list()[0].styles[0].config.label, '已经保存');
  assert.equal(fs.readFileSync(f.index, 'utf8'), committed);
  assert.equal(reopened.integrity().backupCurrent, true);
  assert.equal(reopened.integrity().recovery.source, 'backup');
  const preserved = fs.readdirSync(f.store.root).filter(name => name.startsWith('index.damaged-'));
  assert.equal(preserved.length, failure === 'missing' ? 0 : 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.store.directory(f.pack.id), 'package.json'))).styles[0].config.label, '初始');
});

test('unrecoverable or newer indexes never become an empty library or get overwritten', async t => {
  const f = await fixture(t);
  fs.writeFileSync(f.index, '{broken'); fs.writeFileSync(f.backup, '{also broken');
  assert.throws(() => f.store.list(), { code: 'STYLE_LIBRARY_INDEX_UNAVAILABLE', statusCode: 503 });
  assert.equal(fs.readFileSync(f.index, 'utf8'), '{broken');
  fs.writeFileSync(f.backup, JSON.stringify({ version: 1, packages: [f.pack] }));
  const newer = JSON.stringify({ version: 2, packages: [f.pack] }); fs.writeFileSync(f.index, newer);
  assert.throws(() => f.store.list(), { code: 'STYLE_LIBRARY_INDEX_VERSION', statusCode: 503 });
  assert.equal(fs.readFileSync(f.index, 'utf8'), newer);
});

test('missing indexes with installed directories stop safely while a fresh pending import is allowed', async t => {
  const f = await fixture(t);
  fs.unlinkSync(f.index); fs.unlinkSync(f.backup);
  assert.throws(() => f.store.read(), { code: 'STYLE_LIBRARY_INDEX_UNAVAILABLE' });
  assert.ok(fs.existsSync(f.store.directory(f.pack.id)));
  const fresh = createComponentStyleStore(createScratchDirectory('style-first-import-', t));
  fresh.stage({ ...f.pack, id: randomUUID() });
  assert.deepEqual(fresh.list(), []);
});

test('backup failure after the main commit preserves the successful write and reports degraded recovery', async t => {
  const f = await fixture(t);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === f.backup) throw Object.assign(new Error('Backup unavailable'), { code: 'EACCES' });
    return rename(source, target);
  });
  f.store.updateConfig(f.pack.styles[0].id, () => ({ label: '提交成功' }));
  assert.equal(f.store.list()[0].styles[0].config.label, '提交成功');
  assert.equal(f.store.integrity().backupCurrent, false);
  assert.ok(fs.existsSync(f.store.directory(f.pack.id)));
});

test('a failed primary index commit keeps both the old index and its recovery copy', async t => {
  const f = await fixture(t);
  const before = fs.readFileSync(f.index, 'utf8');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === f.index) throw Object.assign(new Error('Index unavailable'), { code: 'EACCES' });
    return rename(source, target);
  });
  assert.throws(() => f.store.updateConfig(f.pack.styles[0].id, () => ({ label: '不能提交' })), /Index unavailable/);
  assert.equal(fs.readFileSync(f.index, 'utf8'), before);
  assert.equal(fs.readFileSync(f.backup, 'utf8'), before);
  assert.equal(fs.readdirSync(f.store.root).filter(name => name.endsWith('.tmp')).length, 0);
});
