'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');

const sandbox = { atob, crypto: { randomUUID: () => 'template-1' } };
vm.runInNewContext(`${readJsModuleBundle('public', 'js', 'admin', 'weekly-schedule', 'storage.js')}
this.createStorage = createWeeklyScheduleStorage;`, sandbox);
const createStorage = sandbox.createStorage;

function memoryIndexedDB(initial) {
  let stored = initial;
  let deferred = false;
  let failNextWrite = false;
  let closed = 0;
  const writes = [];
  const commits = [];
  const waiting = [];
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          close() { closed++; },
          transaction() {
            const transaction = {
              objectStore() {
                return {
                  get() {
                    const reading = { result: clone(stored) };
                    queueMicrotask(() => transaction.oncomplete?.());
                    return reading;
                  },
                  put(value) {
                    const snapshot = clone(value);
                    writes.push(snapshot);
                    for (const notify of waiting.splice(0)) notify();
                    const complete = () => {
                      if (failNextWrite) {
                        failNextWrite = false;
                        transaction.error = new Error('QuotaExceededError');
                        transaction.onabort?.();
                        return;
                      }
                      stored = snapshot;
                      transaction.oncomplete?.();
                    };
                    if (deferred) commits.push(complete);
                    else queueMicrotask(complete);
                  },
                };
              },
            };
            return transaction;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
  return {
    indexedDB, writes,
    current: () => clone(stored),
    deferWrites() { deferred = true; },
    failWrite() { failNextWrite = true; },
    commit() { commits.shift()(); },
    closed: () => closed,
    async waitForWrite(count) {
      while (writes.length < count) await new Promise(resolve => waiting.push(resolve));
    },
  };
}

test('saved snapshots serialize in edit order and preserve images across a new storage instance', async () => {
  const database = memoryIndexedDB();
  const storage = createStorage({ indexedDB: database.indexedDB });
  const state = await storage.load();
  state.templates[0].assets.logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=';
  database.deferWrites();
  state.templates[0].days[0].theme = '第一次编辑';
  const first = storage.save(state);
  state.templates[0].days[0].theme = '第二次编辑';
  const second = storage.save(state);
  state.templates[0].days[0].theme = '尚未保存的修改';
  await database.waitForWrite(1);
  assert.equal(database.writes.length, 1);
  assert.equal(database.writes[0].templates[0].days[0].theme, '第一次编辑');
  database.commit();
  await first;
  await database.waitForWrite(2);
  assert.equal(database.writes[1].templates[0].days[0].theme, '第二次编辑');
  database.commit();
  await second;
  storage.close();
  const reopened = createStorage({ indexedDB: database.indexedDB });
  const restored = await reopened.load();
  assert.equal(restored.templates[0].days[0].theme, '第二次编辑');
  assert.equal(restored.templates[0].assets.logo, state.templates[0].assets.logo);
  reopened.close();
});

test('failed reads block writes instead of replacing a saved future-version record with defaults', async () => {
  const original = { version: 2, activeId: 'future', templates: [{ id: 'future', name: '请保留' }] };
  const database = memoryIndexedDB(original);
  const storage = createStorage({ indexedDB: database.indexedDB });
  await assert.rejects(storage.load(), /记录/);
  await assert.rejects(storage.save({ version: 1, activeId: 'new', templates: [{ id: 'new' }] }), /尚未成功读取/);
  assert.equal(database.writes.length, 0);
  assert.deepEqual(database.current(), original);
  storage.close();
});

test('a failed write retains the previous record and draft, and a retry can commit the current edit', async () => {
  const database = memoryIndexedDB();
  const storage = createStorage({ indexedDB: database.indexedDB });
  const state = await storage.load();
  state.templates[0].days[0].theme = '已保存';
  await storage.save(state);
  state.templates[0].days[0].theme = '保留草稿';
  database.failWrite();
  await assert.rejects(storage.save(state), /保存失败/);
  assert.equal(database.current().templates[0].days[0].theme, '已保存');
  assert.equal(state.templates[0].days[0].theme, '保留草稿');
  await storage.save(state);
  assert.equal(database.current().templates[0].days[0].theme, '保留草稿');
  storage.close();
});

test('closing the store finishes accepted writes and rejects new work', async () => {
  const database = memoryIndexedDB();
  const storage = createStorage({ indexedDB: database.indexedDB });
  const state = await storage.load();
  database.deferWrites();
  const saving = storage.save(state);
  await database.waitForWrite(1);
  storage.close();
  await assert.rejects(storage.save(state), /已关闭/);
  assert.equal(database.closed(), 0);
  database.commit();
  await saving;
  await Promise.resolve();
  assert.equal(database.closed(), 1);
  assert.equal(database.current().activeId, state.activeId);
});
