'use strict';

const crypto = require('node:crypto');
const { MAX_SCENE_BYTES } = require('../scenes/scene-contract');
const { SHARED_SCENE_TYPES } = require('../shared/scene-component-types');

const PREVIEW_SESSION_TYPES = Object.freeze([...SHARED_SCENE_TYPES, 'canvas']);
const SESSION_TTL_MS = 2 * 60 * 1000;
const MAX_PREVIEW_CONFIG_BYTES = MAX_SCENE_BYTES + 1024;
const MAX_PREVIEW_STATE_BYTES = 2 * MAX_PREVIEW_CONFIG_BYTES + 4096;
const MAX_PREVIEW_REQUEST_BYTES = MAX_PREVIEW_STATE_BYTES + 256 * 1024 + 4096;
const copy = (value) => JSON.parse(JSON.stringify(value));
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

function fail(statusCode, message) {
  throw Object.assign(new Error(message), { statusCode, code: 'COMPONENT_PREVIEW_ERROR' });
}

function checkSize(value, limit) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > limit) fail(413, '预览数据过大。');
}

function checkConfig(value, component) {
  checkSize(value, MAX_PREVIEW_CONFIG_BYTES);
  if (component === 'canvas' && value.document !== undefined) checkSize(value.document, MAX_SCENE_BYTES);
}

// This relay owns no configuration or persistence. Only the originating desktop
// controller can acknowledge edits and publish the result of its existing save.
function createComponentPreviewSessions({ now = Date.now, getOwner = () => null } = {}) {
  const sessions = new Map();
  const anonymousScope = crypto.randomUUID();
  const owner = () => JSON.stringify(getOwner());

  function prune() {
    const currentOwner = owner();
    for (const [id, session] of sessions) {
      if (session.owner !== currentOwner) sessions.delete(id);
    }
  }

  function get(id) {
    prune();
    const session = sessions.get(id);
    if (!session) fail(410, '预览连接已结束，请从客户端重新打开预览。');
    return session;
  }

  function authenticate(id, token) {
    const session = get(id);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
      || !crypto.timingSafeEqual(session.tokenHash, crypto.createHash('sha256').update(token).digest())) {
      fail(403, '此预览链接无效。');
    }
    if (session.closed) fail(410, '预览连接已结束，请从客户端重新打开预览。');
    return session;
  }

  function link({ links, selectedId = null, selectedSize = null }) {
    if (!Array.isArray(links) || !links.length || links.length > PREVIEW_SESSION_TYPES.length
      || links.some((entry) => !record(entry)) || new Set(links.map(({ id }) => id)).size !== links.length) {
      fail(400, '预览链接无效。');
    }
    const entries = links.map(({ id, token }) => {
      const session = authenticate(id, token);
      return { component: session.component, id, token, draftKey: session.draftKey };
    });
    if (selectedId !== null && (!SHARED_SCENE_TYPES.includes(selectedId)
      || !entries.some(({ component }) => component === selectedId))) fail(400, '预览组件无效。');
    if (selectedSize !== null && (!selectedId || !record(selectedSize)
      || !['width', 'height'].every((axis) => Number.isFinite(selectedSize[axis])
        && selectedSize[axis] >= 32 && selectedSize[axis] <= 7680))) fail(400, '组件尺寸无效。');
    const anchor = get(entries.find(({ component }) => component === 'canvas')?.id || entries[0].id);
    anchor.links ||= new Map();
    const previous = anchor.links.get(selectedId);
    const key = previous && JSON.stringify(previous.entries) === JSON.stringify(entries)
      ? previous.key : crypto.randomBytes(16).toString('base64url');
    anchor.links.set(selectedId, { key, hash: crypto.createHash('sha256').update(key).digest(), entries, selectedId,
      selectedSize: selectedSize === null ? null : { width: selectedSize.width, height: selectedSize.height } });
    return { key };
  }

  function resolveLink(key) {
    if (typeof key !== 'string' || !/^(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43})$/.test(key)) fail(403, '此预览链接无效。');
    prune();
    const hash = crypto.createHash('sha256').update(key).digest();
    const linked = [...sessions.values()].flatMap((session) => session.links ? [...session.links.values()] : [])
      .find((entry) => crypto.timingSafeEqual(entry.hash, hash));
    if (!linked) fail(410, '预览连接已结束，请从客户端重新打开预览。');
    for (const { id, token } of linked.entries) authenticate(id, token);
    return copy({ links: linked.entries, selectedId: linked.selectedId, selectedSize: linked.selectedSize });
  }

  function stateOf(value, component) {
    if (!record(value) || !record(value.draft) || !record(value.saved)
      || !Number.isSafeInteger(value.generation)) fail(400, '预览状态无效。');
    checkConfig(value.draft, component);
    checkConfig(value.saved, component);
    checkSize(value, MAX_PREVIEW_STATE_BYTES);
    return copy({ draft: value.draft, saved: value.saved, generation: value.generation,
      loaded: value.loaded === true, loading: value.loading === true, saving: value.saving === true,
      dirty: value.dirty === true, conflict: value.conflict === true, applied: value.applied === true,
      error: typeof value.error === 'string' ? value.error.slice(0, 500) : '' });
  }

  function publicState(session) {
    return copy({ component: session.component, draftKey: session.draftKey,
      state: session.state, display: session.display, ack: session.ack,
      sequence: session.sequence, attachmentId: session.attachmentId || null });
  }

  function open({ component, state, display = null }) {
    prune();
    if (!PREVIEW_SESSION_TYPES.includes(component)) fail(400, '未知预览组件。');
    const initial = stateOf(state, component);
    checkSize(display, 256 * 1024);
    for (const [id, session] of sessions) if (session.component === component) sessions.delete(id);
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const scope = getOwner()?.scope || anonymousScope;
    const draftKey = crypto.createHash('sha256').update(JSON.stringify([
      scope, component, component === 'canvas' ? initial.saved.document?.id : null,
    ])).digest('hex');
    sessions.set(id, { component, draftKey, state: initial, display: copy(display), owner: owner(),
      tokenHash: crypto.createHash('sha256').update(token).digest(), touched: now(), ack: 0, sequence: 0, commands: [] });
    return { id, token, draftKey };
  }

  function exchange({ id, state, display = null, ack }) {
    const session = get(id);
    const next = stateOf(state, session.component);
    checkSize(display, 256 * 1024);
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

  function browser({ id, action, change, commandId, attachmentId, previousAttachmentId }, token) {
    const session = authenticate(id, token);
    // Keep at most one session per component so the original desktop can resume
    // after suspended timers. Browser capabilities cannot revive an idle lease.
    if (action !== 'close' && now() - session.touched > SESSION_TTL_MS) {
      fail(503, '正在等待客户端恢复连接，未保存修改仍保留。');
    }
    if (action === 'attach') {
      if (typeof attachmentId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attachmentId)) {
        fail(400, '预览页面标识无效。');
      }
      if (attachmentId !== session.attachmentId) {
        if (previousAttachmentId !== (session.attachmentId || null)) fail(409, '编辑已在其他页面继续，请刷新此页后重试。');
        session.attachmentId = attachmentId;
        session.lastCommand = undefined;
      }
      session.touched = now();
      return publicState(session);
    }
    if ((action !== 'read' || attachmentId !== undefined) && attachmentId !== session.attachmentId) {
      fail(409, '编辑已在其他页面继续，请刷新此页后重试。');
    }
    if (action === 'close') { session.closed = true; session.touched = now(); return {}; }
    if (action === 'read') { session.touched = now(); return publicState(session); }
    if (!['edit', 'save', 'discard'].includes(action)
      && !(session.component === 'canvas' && ['publish', 'source'].includes(action))) fail(400, '不支持的预览操作。');
    if (commandId !== undefined) {
      if (!Number.isSafeInteger(commandId) || commandId < 1) fail(400, '预览操作编号无效。');
      if (commandId < session.lastCommand?.id) fail(409, '预览操作已过期，请重新打开预览。');
      if (commandId === session.lastCommand?.id) {
        session.touched = now();
        return { sequence: session.lastCommand.sequence };
      }
    }
    if (!session.state.loaded) fail(409, '配置尚未读取，请稍后重试。');
    if (session.commands.length >= 64) fail(429, '预览操作过于频繁，请稍后重试。');
    if (action === 'edit' && (!record(change) || Object.keys(change).some((key) =>
      !Object.hasOwn(session.state.draft, key) || ['__proto__', 'constructor', 'prototype'].includes(key)))) {
      fail(400, '预览参数无效。');
    }
    if (action === 'edit') checkConfig(change, session.component);
    const sequence = ++session.sequence;
    session.commands.push({ sequence, action, ...(action === 'edit' ? { change: copy(change) } : {}) });
    if (commandId !== undefined) session.lastCommand = { id: commandId, sequence };
    session.touched = now();
    return { sequence };
  }

  return { open, exchange, browser, link, resolveLink,
    revoke: (id) => sessions.delete(id), clear: () => sessions.clear() };
}

module.exports = { createComponentPreviewSessions, PREVIEW_SESSION_TYPES, SESSION_TTL_MS, MAX_PREVIEW_REQUEST_BYTES };
