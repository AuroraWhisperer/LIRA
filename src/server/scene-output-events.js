'use strict';

const REVOKED_STATUSES = new Set([401, 403, 404, 409, 423]);

function unavailable(statusCode = 503) {
  return Object.assign(new Error('场景通知暂时不可用，请重试。'), {
    statusCode, code: 'SCENE_EVENTS_UNAVAILABLE',
  });
}

function createSceneOutputEvents({ getAccess, heartbeatMs = 1000, coalesceMs = 40, maxStreams = 4 }) {
  const streams = new Set();
  let heartbeat = null;
  let disposed = false;

  function readAccess(input, getStatus) {
    try {
      const status = getStatus();
      if (status !== 200) throw unavailable(status);
      return getAccess(input);
    } catch (error) {
      throw unavailable([400, 401, 403, 404, 409, 423, 429, 503].includes(error?.statusCode) ? error.statusCode : 503);
    }
  }

  function clearPending(stream) {
    clearTimeout(stream.timer);
    stream.timer = null;
    stream.pending = null;
  }

  function remove(stream) {
    if (!streams.delete(stream)) return false;
    clearPending(stream);
    stream.res.off('close', stream.onClose);
    stream.res.off('error', stream.onError);
    if (!streams.size) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    return true;
  }

  function close(stream, destroy = false) {
    if (!remove(stream)) return;
    if (destroy) { stream.res.destroy(); return; }
    try {
      stream.res.end();
    } catch {
      stream.res.destroy();
    }
  }

  function write(stream, text) {
    if (!streams.has(stream)) return false;
    if (stream.res.destroyed || stream.res.writableEnded) {
      remove(stream);
      return false;
    }
    try {
      if (stream.res.write(text) !== false) return true;
    } catch {
      close(stream, true);
      return false;
    }
    close(stream, true);
    return false;
  }

  function revalidate(stream) {
    try {
      const access = readAccess(stream.input, stream.getStatus);
      if (access.binding !== stream.binding) throw unavailable(409);
      stream.types = access.types;
      return access;
    } catch (error) {
      if (REVOKED_STATUSES.has(error.statusCode)) write(stream, 'data: revoked\n\n');
      close(stream);
      return null;
    }
  }

  function flush(stream) {
    const pending = stream.pending;
    clearPending(stream);
    const access = revalidate(stream);
    if (!access || !pending) return;
    if (pending.all || access.version !== stream.version || access.types.some((type) => pending.types.has(type))) {
      if (write(stream, 'data: change\n\n')) stream.version = access.version;
    }
  }

  function tick() {
    for (const stream of streams) {
      const access = revalidate(stream);
      if (!access) continue;
      if (access.version !== stream.version) {
        clearPending(stream);
        if (write(stream, 'data: change\n\n')) stream.version = access.version;
      } else write(stream, ': heartbeat\n\n');
    }
  }

  function open(res, input, getStatus) {
    if (disposed) throw unavailable();
    const snapshot = { ...input };
    const access = readAccess(snapshot, getStatus);
    if (streams.size >= maxStreams) throw unavailable(429);
    const stream = { res, input: snapshot, getStatus, id: snapshot.id.toLowerCase(),
      binding: access.binding, version: access.version, types: access.types, timer: null, pending: null };
    stream.onClose = () => remove(stream);
    stream.onError = () => close(stream, true);
    streams.add(stream);
    res.on('close', stream.onClose);
    res.on('error', stream.onError);
    try {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
      write(stream, 'data: ready\n\n');
    } catch {
      close(stream, true);
    }
    if (streams.size && !heartbeat) {
      heartbeat = setInterval(tick, heartbeatMs);
      heartbeat.unref();
    }
  }

  function notify({ id, types } = {}) {
    if (disposed) return;
    for (const stream of streams) {
      if (id !== undefined && id.toLowerCase() !== stream.id) continue;
      if (id === undefined && types && !types.some((type) => stream.types.includes(type))) continue;
      stream.pending ??= { all: false, types: new Set() };
      if (id !== undefined || !types) stream.pending.all = true;
      else for (const type of types) stream.pending.types.add(type);
      if (!stream.timer) {
        stream.timer = setTimeout(() => flush(stream), coalesceMs);
        stream.timer.unref();
      }
    }
  }

  function dispose() {
    disposed = true;
    for (const stream of streams) close(stream, true);
  }

  return { open, notify, dispose };
}

module.exports = { createSceneOutputEvents };
