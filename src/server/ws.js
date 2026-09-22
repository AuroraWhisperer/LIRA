// 编写人：Aurora
// WebSocket 连接管理 + 广播。
'use strict';

const crypto = require('node:crypto');
const { isUtf8 } = require('node:buffer');
const { URL } = require('node:url');
const { resolveRequestPrincipal } = require('./access-policy');
const { projectWebSocketPayload } = require('./overlay-projection');

const MAX_FRAME_BYTES = 256 * 1024; // 256 KB
const MAX_MESSAGE_BYTES = 256 * 1024; // 256 KB across all fragments
const MAX_PENDING_BYTES = 2 * 1024 * 1024; // 2 MB per outbound socket queue
const HEARTBEAT_INTERVAL_MS = 30000;
const SOCKET_TIMEOUT_MS = 90000;
const CLOSE_TIMEOUT_MS = 1000;
const SUBSCRIPTION_TOPICS = new Set(['danmaku']);

function createWebSocketHub(options = {}) {
  const sockets = new Set();
  const closingSockets = new Map();
  const closeTimeoutMs = options.closeTimeoutMs || CLOSE_TIMEOUT_MS;
  let stopped = false;
  const heartbeatIntervalMs = options.heartbeatIntervalMs || HEARTBEAT_INTERVAL_MS;
  const socketTimeoutMs = options.socketTimeoutMs || SOCKET_TIMEOUT_MS;
  const maxPendingBytes = Math.max(1, Math.trunc(Number(options.maxPendingBytes)) || MAX_PENDING_BYTES);
  let heartbeatTimer = null;
  let snapshotFlushQueued = false;
  let pendingSnapshot = null;

  function handleWebSocketUpgrade(context, req, socket) {
    if (stopped) {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const principal = resolveRequestPrincipal(context, req, requestUrl);
    if (!principal) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Sandboxed overlays have an opaque origin; only their verified scope may use it.
    const origin = req.headers.origin;
    if (origin) {
      const allowed = origin === 'null' ? principal.type === 'overlay' : context.allowedOrigins?.includes(origin);
      if (!allowed) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n',
    );

    // Per-socket state for frame reassembly and heartbeat
    socket._wsBuffer = Buffer.alloc(0);
    socket._wsFragment = null;
    socket._wsFragmentOpcode = 0;
    socket._wsFragmentBytes = 0;
    socket._lastPongAt = Date.now();
    socket._wsCleanedUp = false;
    socket._wsPrincipal = principal;
    socket._wsTopics = parseSubscriptionTopics(requestUrl.searchParams);
    socket._wsMaxPendingBytes = maxPendingBytes;

    sockets.add(socket);
    if (context.state && context.state.sockets) context.state.sockets.add(socket);
    socket._wsContext = context;
    socket.on('close', () => finishSocket(socket));
    socket.on('error', () => dropSocket(socket));
    socket._wsDataHandler = (chunk) => handleSocketData(socket, chunk);
    socket.on('data', socket._wsDataHandler);

    ensureHeartbeat();

    if (
      !sendWebSocket(socket, {
        type: 'snapshot',
        reason: 'connect',
        state: context.getState(),
      })
    )
      dropSocket(socket);
  }

  function dropSocket(socket) {
    try {
      socket.destroy();
    } catch (_) {}
    finishSocket(socket);
  }

  function finishSocket(socket) {
    clearTimeout(closingSockets.get(socket));
    closingSockets.delete(socket);
    cleanupSocket(socket);
  }

  function closeSocket(socket, payload) {
    if (socket._wsCleanedUp) return;
    if (!sendWebSocketFrame(socket, payload, 0x8)) {
      dropSocket(socket);
      return;
    }
    // Remove from broadcasts now, but retain ownership until physical close.
    cleanupSocket(socket);
    const timer = setTimeout(() => dropSocket(socket), closeTimeoutMs);
    timer.unref();
    closingSockets.set(socket, timer);
    try {
      socket.end();
    } catch (_) {
      dropSocket(socket);
    }
  }

  function rejectFrame(socket, code = 1002) {
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code);
    closeSocket(socket, payload);
  }

  function cleanupSocket(socket) {
    if (socket._wsCleanedUp) return;

    socket._wsCleanedUp = true;
    if (socket._wsDataHandler) socket.off('data', socket._wsDataHandler);
    socket._wsDataHandler = null;
    sockets.delete(socket);
    if (socket._wsContext && socket._wsContext.state && socket._wsContext.state.sockets) {
      socket._wsContext.state.sockets.delete(socket);
    }
    socket._wsContext = null;
    socket._wsPrincipal = null;
    socket._wsBuffer = null;
    socket._wsFragment = null;
    socket._wsFragmentOpcode = 0;
    socket._wsFragmentBytes = 0;
    socket._wsTopics = null;
    socket._wsMaxPendingBytes = null;
  }

  function handleSocketData(socket, chunk) {
    if (socket._wsCleanedUp || !sockets.has(socket) || socket._wsBuffer === null) return;

    socket._wsBuffer = socket._wsBuffer.length === 0 ? chunk : Buffer.concat([socket._wsBuffer, chunk]);
    processBufferedFrames(socket);
  }

  function processBufferedFrames(socket) {
    while (socket._wsBuffer && socket._wsBuffer.length >= 2) {
      const buffer = socket._wsBuffer;
      const opcode = buffer[0] & 0x0f;
      const fin = Boolean(buffer[0] & 0x80);
      const masked = Boolean(buffer[1] & 0x80);
      const control = opcode >= 0x8;
      const lengthCode = buffer[1] & 0x7f;
      if (
        !masked ||
        buffer[0] & 0x70 ||
        ![0x0, 0x1, 0x2, 0x8, 0x9, 0xa].includes(opcode) ||
        (control && (!fin || lengthCode > 125)) ||
        (!control && (opcode === 0x0) !== (socket._wsFragment !== null))
      ) {
        rejectFrame(socket);
        return;
      }

      let length = lengthCode;
      let headerSize = 2;
      if (length === 126) {
        if (buffer.length < 4) break;
        length = buffer.readUInt16BE(2);
        headerSize = 4;
      } else if (length === 127) {
        if (buffer.length < 10) break;
        if (buffer[2] & 0x80) {
          rejectFrame(socket);
          return;
        }
        length = Number(buffer.readBigUInt64BE(2));
        headerSize = 10;
      }

      if ((lengthCode === 126 && length < 126) || (lengthCode === 127 && length < 65536)) {
        rejectFrame(socket);
        return;
      }

      if (length > MAX_FRAME_BYTES) {
        rejectFrame(socket, 1009);
        return;
      }

      const totalFrameSize = headerSize + 4 + length;
      if (buffer.length < totalFrameSize) break; // Partial frame, wait for more data

      const maskKey = buffer.subarray(headerSize, headerSize + 4);

      // Extract and unmask payload
      const payloadStart = headerSize + 4;
      const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
      }

      // Advance buffer past this frame
      socket._wsBuffer = buffer.subarray(totalFrameSize);

      // Dispatch by opcode
      if (opcode === 0x8) {
        if (payload.length === 1) {
          rejectFrame(socket);
          return;
        }
        if (payload.length >= 2) {
          const code = payload.readUInt16BE(0);
          const validCode =
            (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999);
          if (!validCode) {
            rejectFrame(socket);
            return;
          }
          if (!isUtf8(payload.subarray(2))) {
            rejectFrame(socket, 1007);
            return;
          }
        }
        closeSocket(socket, payload);
        return;
      }

      if (opcode === 0x9) {
        // Ping: reply with pong, echoing payload
        if (!sendWebSocketFrame(socket, payload, 0xa)) {
          dropSocket(socket);
          return;
        }
        // Continue loop (more frames may follow in same buffer)
        continue;
      }

      if (opcode === 0xa) {
        // Pong: update heartbeat timestamp
        socket._lastPongAt = Date.now();
        continue;
      }

      if (socket._wsPrincipal.type === 'overlay') {
        rejectFrame(socket, 1008);
        return;
      }

      // Text (0x1) / Binary (0x2) / Continuation (0x0)
      // Accumulate fragments but don't act on them (server doesn't consume client messages)
      if (opcode === 0x0) {
        // Continuation frame
        if (socket._wsFragmentBytes + payload.length > MAX_MESSAGE_BYTES) {
          rejectFrame(socket, 1009);
          return;
        }
        socket._wsFragment = Buffer.concat([socket._wsFragment, payload]);
        socket._wsFragmentBytes += payload.length;
      } else if (fin) {
        if (opcode === 0x1 && !isUtf8(payload)) {
          rejectFrame(socket, 1007);
          return;
        }
      } else {
        // Start of fragmented message
        socket._wsFragment = payload;
        socket._wsFragmentOpcode = opcode;
        socket._wsFragmentBytes = payload.length;
      }

      if (fin && socket._wsFragment !== null) {
        if (socket._wsFragmentOpcode === 0x1 && !isUtf8(socket._wsFragment)) {
          rejectFrame(socket, 1007);
          return;
        }
        // Fragmented message complete — reset
        socket._wsFragment = null;
        socket._wsFragmentOpcode = 0;
        socket._wsFragmentBytes = 0;
      }

      // Loop continues to process next frame in buffer
    }
  }

  function ensureHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const socket of Array.from(sockets)) {
        if (now - socket._lastPongAt > socketTimeoutMs) {
          dropSocket(socket);
        } else {
          if (!sendWebSocketFrame(socket, Buffer.alloc(0), 0x9)) dropSocket(socket);
        }
      }
    }, heartbeatIntervalMs);
    heartbeatTimer.unref();
  }

  function broadcastSnapshot(context, reason) {
    if (sockets.size === 0) return;
    pendingSnapshot = { context, reason };
    if (snapshotFlushQueued) return;
    snapshotFlushQueued = true;
    queueMicrotask(() => {
      snapshotFlushQueued = false;
      const next = pendingSnapshot;
      pendingSnapshot = null;
      if (!next || sockets.size === 0) return;
      const payload = {
        type: 'snapshot',
        reason: next.reason,
        state: next.context.getState(),
      };
      for (const socket of Array.from(sockets)) {
        if (!sendWebSocket(socket, payload)) dropSocket(socket);
      }
    });
  }

  function broadcast(payload, options = {}) {
    const topic = String(options.topic || '');
    for (const socket of Array.from(sockets)) {
      if (topic && !socket._wsTopics?.has(topic)) continue;
      if (!sendWebSocket(socket, payload)) dropSocket(socket);
    }
  }

  function stop(options = {}) {
    if (stopped) return;
    stopped = true;
    pendingSnapshot = null;
    snapshotFlushQueued = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    for (const socket of Array.from(sockets)) {
      if (options.shutdownPayload && !sendWebSocket(socket, options.shutdownPayload)) {
        dropSocket(socket);
        continue;
      }
      closeSocket(socket, Buffer.from([0x03, 0xe9])); // 1001 going away
    }
  }

  return {
    handleUpgrade: handleWebSocketUpgrade,
    broadcastSnapshot,
    broadcast,
    stop,
  };
}

function sendWebSocket(socket, payload) {
  if (!socket._wsPrincipal) return false;
  const projected = projectWebSocketPayload(socket._wsPrincipal, payload);
  if (projected === null) return true;
  return sendWebSocketFrame(socket, Buffer.from(JSON.stringify(projected)), 0x1);
}

function sendWebSocketFrame(socket, payload, opcode) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  const frame = Buffer.concat([header, payload]);
  const pendingBytes = Math.max(0, Number(socket.writableLength) || 0);
  const maxPendingBytes = Math.max(1, Number(socket._wsMaxPendingBytes) || MAX_PENDING_BYTES);
  if (socket.destroyed || pendingBytes + frame.length > maxPendingBytes) return false;
  try {
    socket.write(frame);
    return true;
  } catch (_) {
    return false;
  }
}

function parseSubscriptionTopics(searchParams) {
  const topics = new Set();
  for (const value of searchParams.getAll('topic')) {
    for (const topic of String(value).split(',')) {
      const normalized = topic.trim().toLowerCase();
      if (SUBSCRIPTION_TOPICS.has(normalized)) topics.add(normalized);
    }
  }
  return topics;
}

const compatibilityHub = createWebSocketHub();

function handleWebSocketUpgrade(context, req, socket) {
  compatibilityHub.handleUpgrade(context, req, socket);
}

function broadcastSnapshot(context, reason) {
  const payload = { type: 'snapshot', reason, state: context.getState() };
  const sockets = context && context.state && context.state.sockets;
  if (!sockets) return;
  for (const socket of Array.from(sockets)) {
    sendWebSocket(socket, payload);
  }
}

module.exports = {
  createWebSocketHub,
  handleWebSocketUpgrade,
  broadcastSnapshot,
  sendWebSocket,
};
