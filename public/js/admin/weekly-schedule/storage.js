import { ASSET_KEYS, MAX_TEMPLATE_ASSET_BYTES, createWeeklyScheduleTemplate, getWeeklyScheduleAssetBytes, isWeeklyScheduleAsset, normalizeWeeklyScheduleTemplate } from './model.js';

const DATABASE_NAME = 'lira.weeklySchedule';
const STORE_NAME = 'state';
const STATE_KEY = 'current';

function normalizeState(input, checkSize = false) {
  if (!input || input.version !== 1 || !Array.isArray(input.templates) || !input.templates.length) {
    throw new Error('周表保存记录无法读取，请先保留本机数据后重试。');
  }
  const ids = new Set();
  const templates = input.templates.map(template => {
    if (!template || typeof template.id !== 'string' || !template.id || template.id.trim() !== template.id
      || template.id.length > 100 || ids.has(template.id)) {
      throw new Error('周表模板记录不完整，请先保留本机数据后重试。');
    }
    ids.add(template.id);
    for (const key of ASSET_KEYS) {
      const value = template.assets?.[key];
      if (value && !isWeeklyScheduleAsset(value)) throw new Error('周表素材记录无法读取，请先保留本机数据后重试。');
    }
    if (checkSize && ASSET_KEYS.reduce((total, key) => total + getWeeklyScheduleAssetBytes(template.assets?.[key]), 0) > MAX_TEMPLATE_ASSET_BYTES) {
      throw new Error('每份周表的素材合计不能超过 48 MiB，请先移除或缩小部分图片。');
    }
    return normalizeWeeklyScheduleTemplate(template);
  });
  return { version: 1, activeId: ids.has(input.activeId) ? input.activeId : templates[0].id, templates };
}

export function createWeeklyScheduleStorage({ indexedDB = globalThis.indexedDB } = {}) {
  let database = null;
  let opening = null;
  let queue = Promise.resolve();
  let loaded = false;
  let closed = false;

  function openDatabase() {
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!indexedDB?.open) {
        reject(new Error('本机周表存储不可用，当前内容尚未保存。'));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onblocked = () => {
        blocked = true;
        reject(new Error('周表存储被其他页面占用，请关闭其他管理页后重试。'));
      };
      request.onerror = () => reject(new Error('本机周表存储无法打开，当前内容尚未保存。', { cause: request.error }));
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();
          return;
        }
        database = request.result;
        database.onversionchange = () => {
          database.close();
          database = null;
          opening = null;
          loaded = false;
        };
        resolve(database);
      };
    }).catch(error => {
      opening = null;
      throw error;
    });
    return opening;
  }

  async function read() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(new Error('周表保存记录读取失败，未覆盖原记录。', { cause: transaction.error }));
    });
  }

  async function write(state) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error('周表保存失败，请保留当前页面并重试。', { cause: transaction.error }));
    });
  }

  function enqueue(operation) {
    if (closed) return Promise.reject(new Error('周表存储已关闭。'));
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }

  return {
    load() {
      return enqueue(async () => {
        loaded = false;
        const stored = await read();
        let state;
        if (stored === undefined) {
          const template = createWeeklyScheduleTemplate();
          state = { version: 1, activeId: template.id, templates: [template] };
        } else {
          state = normalizeState(stored);
        }
        loaded = true;
        return state;
      });
    },
    save(state) {
      let snapshot;
      try {
        snapshot = normalizeState(state, true);
      } catch (error) {
        return Promise.reject(error);
      }
      return enqueue(async () => {
        if (!loaded) throw new Error('周表保存记录尚未成功读取，未覆盖原记录。');
        await write(snapshot);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      void queue.then(() => {
        database?.close();
        database = null;
      });
    },
  };
}
