'use strict';

const { randomUUID } = require('node:crypto');

const UNDO_WINDOW_MS = 10000;

// Only server-captured rows may be restored; the browser supplies a batch token.
function createSuperChatUndo({ store, getScope }) {
  let batch = null;
  let timer = null;

  function clear() {
    clearTimeout(timer);
    timer = null;
    batch = null;
  }

  function current() {
    if (batch && (batch.expiresAt <= Date.now() || batch.scope !== getScope())) clear();
    return batch;
  }

  function describe() {
    const value = current();
    return value ? { token: value.token, count: value.rows.length, expiresAt: value.expiresAt } : null;
  }

  function remove(rawId) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw Object.assign(new Error('缺少 SC ID。'), { statusCode: 400, code: 'INVALID_SUPERCHAT_ID' });
    }
    current();
    const row = store.findById(id);
    if (!row) return describe();
    store.setStatus(id, 'deleted', new Date().toISOString());
    batch ??= { token: randomUUID(), scope: getScope(), rows: [], expiresAt: 0 };
    batch.rows.push(row);
    batch.expiresAt = Date.now() + UNDO_WINDOW_MS;
    clearTimeout(timer);
    timer = setTimeout(clear, UNDO_WINDOW_MS);
    timer.unref();
    return describe();
  }

  function restore(token) {
    const value = current();
    if (!value || value.token !== token) {
      throw Object.assign(new Error('这批 SC 已无法撤销。'), { statusCode: 409, code: 'SUPERCHAT_UNDO_EXPIRED' });
    }
    store.restoreDeleted(value.rows);
    clear();
  }

  function retract(platformIds) {
    if (current()?.rows.some((row) => platformIds.includes(row.platform_id))) clear();
  }

  return { remove, restore, clear, retract };
}

module.exports = { createSuperChatUndo };
