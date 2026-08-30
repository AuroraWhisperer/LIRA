// 编写人：Aurora
// WebSocket 连接管理 + 广播。
'use strict';

const crypto = require('node:crypto');
const { URL } = require('node:url');

const MAX_FRAME_BYTES = 256 * 1024; // 256 KB
const MAX_MESSAGE_BYTES = 256 * 1024; // 256 KB across all fragments
const MAX_PENDING_BYTES = 2 * 1024 * 1024; // 2 MB per outbound socket queue
const HEARTBEAT_INTERVAL_MS = 30000;
const SOCKET_TIMEOUT_MS = 90000;
const SUBSCRIPTION_TOPICS = new Set(['danmaku']);

function createWebSocketHub(options = {}) {
  const sockets = new Set();
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs || HEARTBEAT_INTERVAL_MS;
  const socketTimeoutMs = options.socketTimeoutMs || SOCKET_TIMEOUT_MS;
  const maxPendingBytes = Math.max(
    1,
    Math.trunc(Number(options.maxPendingBytes)) || MAX_PENDING_BYTES,
  );
  let heartbeatTimer = null;
  let snapshotFlushQueued = false;
  let pendingSnapshot = null;

  function handleWebSocketUpgrade(context, req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    // Origin validation: Check Origin header if present (browser requests)
    const origin = req.headers.origin;
    if (origin && context.allowedOrigins) {
      const allowed = context.allowedOrigins.some(
        (allowed) => origin === allowed,
      );
      if (!allowed) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host || '127.0.0.1'}`,
    );

    // Token 校验：检查 URL query param 中的 token
    const token = context.sessionToken;
    if (token) {
      const queryToken = requestUrl.searchParams.get('token');
      if (queryToken !== token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
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
    socket._wsTopics = parseSubscriptionTopics(requestUrl.searchParams);
    socket._wsMaxPendingBytes = maxPendingBytes;

    sockets.add(socket);
    if (context.state && context.state.sockets)
      context.state.sockets.add(socket);
    socket._wsContext = context;
    socket.on('close', () => cleanupSocket(socket));
    socket.on('error', () => cleanupSocket(socket));
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
    cleanupSocket(socket);
  }

  function cleanupSocket(socket) {
    if (socket._wsCleanedUp) return;

    socket._wsCleanedUp = true;
    if (socket._wsDataHandler) socket.off('data', socket._wsDataHandler);
    socket._wsDataHandler = null;
    sockets.delete(socket);
    if (
      socket._wsContext &&
      socket._wsContext.state &&
      socket._wsContext.state.sockets
    ) {
      socket._wsContext.state.sockets.delete(socket);
    }
    socket._wsContext = null;
    socket._wsBuffer = null;
    socket._wsFragment = null;
    socket._wsFragmentBytes = 0;
    socket._wsTopics = null;
    socket._wsMaxPendingBytes = null;
  }

  function handleSocketData(socket, chunk) {
    if (
      socket._wsCleanedUp ||
      !sockets.has(socket) ||
      socket._wsBuffer === null
    )
      return;

    socket._wsBuffer =
      socket._wsBuffer.length === 0
        ? chunk
        : Buffer.concat([socket._wsBuffer, chunk]);
    processBufferedFrames(socket);
  }

  function processBufferedFrames(socket) {
    while (socket._wsBuffer && socket._wsBuffer.length >= 2) {
      const buffer = socket._wsBuffer;
      const opcode = buffer[0] & 0x0f;
      const fin = Boolean(buffer[0] & 0x80);
      const masked = Boolean(buffer[1] & 0x80);

      let length = buffer[1] & 0x7f;
      let headerSize = 2;
      if (length === 126) {
        if (buffer.length < 4) break;
        length = buffer.readUInt16BE(2);
        headerSize = 4;
      } else if (length === 127) {
        if (buffer.length < 10) break;
        length = Number(buffer.readBigUInt64BE(2));
        headerSize = 10;
      }

      if (!Number.isFinite(length) || length < 0) {
        sendWebSocketFrame(socket, Buffer.from([0x03, 0xea]), 0x8); // 1002 protocol error
        socket.end();
        return;
      }

      if (length > MAX_FRAME_BYTES) {
        sendWebSocketFrame(socket, Buffer.from([0x03, 0xf1]), 0x8); // 1009 too large
        socket.end();
        return;
      }

      const maskSize = masked ? 4 : 0;
      const totalFrameSize = headerSize + maskSize + length;
      if (buffer.length < totalFrameSize) break; // Partial frame, wait for more data

      // Extract mask if present
      let maskKey = null;
      if (masked) {
        maskKey = buffer.subarray(headerSize, headerSize + 4);
      }

      // Extract and unmask payload
      const payloadStart = headerSize + maskSize;
      const payload = Buffer.from(
        buffer.subarray(payloadStart, payloadStart + length),
      );
      if (masked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      // Advance buffer past this frame
      socket._wsBuffer = buffer.subarray(totalFrameSize);

      // Dispatch by opcode
      if (opcode === 0x8) {
        // Close frame: echo client's status code + reason, then end
        sendWebSocketFrame(socket, payload, 0x8);
        cleanupSocket(socket);
        socket.end();
        return;
      }

      if (opcode === 0x9) {
        // Ping: reply with pong, echoing payload
        sendWebSocketFrame(socket, payload, 0xa);
        // Continue loop (more frames may follow in same buffer)
        continue;
      }

      if (opcode === 0xa) {
        // Pong: update heartbeat timestamp
        socket._lastPongAt = Date.now();
        continue;
      }

      // Text (0x1) / Binary (0x2) / Continuation (0x0)
      // Accumulate fragments but don't act on them (server doesn't consume client messages)
      if (opcode === 0x0) {
        // Continuation frame
        if (socket._wsFragment !== null) {
          if (socket._wsFragmentBytes + payload.length > MAX_MESSAGE_BYTES) {
            sendWebSocketFrame(socket, Buffer.from([0x03, 0xf1]), 0x8); // 1009 too large
            cleanupSocket(socket);
            socket.end();
            return;
          }
          socket._wsFragment = Buffer.concat([socket._wsFragment, payload]);
          socket._wsFragmentBytes += payload.length;
        }
      } else if (fin) {
        // Complete single-frame message — ignore (server doesn't consume)
      } else {
        // Start of fragmented message
        socket._wsFragment = payload;
        socket._wsFragmentOpcode = opcode;
        socket._wsFragmentBytes = payload.length;
      }

      if (fin && socket._wsFragment !== null) {
        // Fragmented message complete — reset
        socket._wsFragment = null;
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
          if (!sendWebSocketFrame(socket, Buffer.alloc(0), 0x9))
            dropSocket(socket);
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
      const encodedPayload = Buffer.from(JSON.stringify(payload));
      for (const socket of Array.from(sockets)) {
        if (!sendWebSocketFrame(socket, encodedPayload, 0x1))
          dropSocket(socket);
      }
    });
  }

  function broadcast(payload, options = {}) {
    const topic = String(options.topic || '');
    const encodedPayload = Buffer.from(JSON.stringify(payload));
    for (const socket of Array.from(sockets)) {
      if (topic && !socket._wsTopics?.has(topic)) continue;
      if (!sendWebSocketFrame(socket, encodedPayload, 0x1)) dropSocket(socket);
    }
  }

  function stop(options = {}) {
    pendingSnapshot = null;
    snapshotFlushQueued = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    for (const socket of Array.from(sockets)) {
      try {
        if (options.shutdownPayload)
          sendWebSocket(socket, options.shutdownPayload);
        socket.end();
      } catch (_) {
        try {
          socket.destroy();
        } catch (_) {}
      }
      cleanupSocket(socket);
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
  return sendWebSocketFrame(socket, Buffer.from(JSON.stringify(payload)), 0x1);
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
  const maxPendingBytes = Math.max(
    1,
    Number(socket._wsMaxPendingBytes) || MAX_PENDING_BYTES,
  );
  if (socket.destroyed || pendingBytes + frame.length > maxPendingBytes)
    return false;
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
  const encodedPayload = Buffer.from(JSON.stringify(payload));
  const sockets = context && context.state && context.state.sockets;
  if (!sockets) return;
  for (const socket of Array.from(sockets)) {
    sendWebSocketFrame(socket, encodedPayload, 0x1);
  }
}

module.exports = {
  createWebSocketHub,
  handleWebSocketUpgrade,
  broadcastSnapshot,
  sendWebSocket,
};
