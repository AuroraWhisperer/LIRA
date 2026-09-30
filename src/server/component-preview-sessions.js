'use strict';

const crypto = require('node:crypto');

const COMPONENTS = new Set(['danmaku', 'clock', 'queue', 'overtime', 'canvas']);
const SESSION_TTL_MS = 15000;
const copy = (value) => JSON.parse(JSON.stringify(value));
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

function fail(statusCode, message) {
  throw Object.assign(new Error(message), { statusCode, code: 'COMPONENT_PREVIEW_ERROR' });
}

// This relay owns no configuration or persistence. Only the originating desktop
// controller can acknowledge edits and publish the result of its existing save.
function createComponentPreviewSessions({ now = Date.now, getOwner = () => null } = {}) {
  const sessions = new Map();
  const owner = () => JSON.stringify(getOwner());

  function prune() {
    const currentOwner = owner();
    for (const [id, session] of sessions) {
      if (now() - session.touched > SESSION_TTL_MS || session.owner !== currentOwner) sessions.delete(id);
    }
  }

  function get(id) {
    prune();
    const session = sessions.get(id);
    if (!session) fail(410, '预览连接已结束，请从客户端重新打开预览。');
    return session;
  }

  function stateOf(value) {
    if (!record(value) || !record(value.draft) || !record(value.saved)
      || !Number.isSafeInteger(value.generation)) fail(400, '预览状态无效。');
    return copy({ draft: value.draft, saved: value.saved, generation: value.generation,
      loaded: value.loaded === true, loading: value.loading === true, saving: value.saving === true,
      dirty: value.dirty === true, conflict: value.conflict === true, applied: value.applied === true,
      error: typeof value.error === 'string' ? value.error.slice(0, 500) : '' });
  }

  function publicState(session) {
    return copy({ component: session.component, state: session.state, display: session.display, ack: session.ack });
  }

  function open({ component, state, display = null }) {
    prune();
    if (!COMPONENTS.has(component)) fail(400, '未知预览组件。');
    const initial = stateOf(state);
    for (const [id, session] of sessions) if (session.component === component) sessions.delete(id);
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(id, { component, state: initial, display: copy(display), owner: owner(),
      tokenHash: crypto.createHash('sha256').update(token).digest(), touched: now(), ack: 0, sequence: 0, commands: [] });
    return { id, token };
  }

  function exchange({ id, state, display = null, ack }) {
    const session = get(id);
    const next = stateOf(state);
    if (next.generation !== session.state.generation) {
      sessions.delete(id);
      fail(410, '配置来源已变化，请重新打开预览。');
    }
    if (!Number.isSafeInteger(ack) || ack < session.ack || ack > session.sequence) fail(400, '预览确认序号无效。');
    session.state = next;
    session.display = copy(display);
    session.ack = ack;
    session.commands = session.commands.filter((command) => command.sequence > ack);
    session.touched = now();
    return copy({ commands: session.commands, closed: session.closed === true });
  }

  function browser({ id, action, change }, token) {
    const session = get(id);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
      || !crypto.timingSafeEqual(session.tokenHash, crypto.createHash('sha256').update(token).digest())) {
      fail(403, '此预览链接无效。');
    }
    if (action === 'close') { session.closed = true; return {}; }
    if (session.closed) fail(410, '预览连接已结束，请从客户端重新打开预览。');
    if (action === 'read') return publicState(session);
    if (!['edit', 'save', 'discard'].includes(action)
      && !(session.component === 'canvas' && ['publish', 'source'].includes(action))) fail(400, '不支持的预览操作。');
    if (!session.state.loaded) fail(409, '配置尚未读取，请稍后重试。');
    if (session.commands.length >= 64) fail(429, '预览操作过于频繁，请稍后重试。');
    if (action === 'edit' && (!record(change) || Object.keys(change).some((key) =>
      !Object.hasOwn(session.state.draft, key) || ['__proto__', 'constructor', 'prototype'].includes(key)))) {
      fail(400, '预览参数无效。');
    }
    const sequence = ++session.sequence;
    session.commands.push({ sequence, action, ...(action === 'edit' ? { change: copy(change) } : {}) });
    return { sequence };
  }

  return { open, exchange, browser, revoke: (id) => sessions.delete(id), clear: () => sessions.clear() };
}

module.exports = { createComponentPreviewSessions, SESSION_TTL_MS };
