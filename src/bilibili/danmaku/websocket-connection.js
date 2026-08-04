// 编写人：Aurora
// WebSocket 连接管理器 — 负责 Bilibili 弹幕长连的连接、心跳和数据包收发。
'use strict';

const HEARTBEAT_INTERVAL_MS = 30000;

class WebSocketConnection {
  constructor(options = {}) {
    this.ws = null;
    this.heartbeatTimer = null;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || HEARTBEAT_INTERVAL_MS;
    this.awaitingHeartbeatReply = false;
    this.eventHandlers = {
      open: [],
      message: [],
      close: [],
      error: []
    };
  }

  async connect(wsUrl, authPayload, options = {}) {
    this.close();

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.sendPacket(7, 1, authPayload);
      clearInterval(this.heartbeatTimer);
      this.awaitingHeartbeatReply = false;
      this.heartbeatTimer = setInterval(() => {
        if (this.awaitingHeartbeatReply) {
          this.failConnection(ws, {
            code: 0,
            reason: 'heartbeat timeout',
            wasClean: false,
            heartbeatTimeout: true
          });
          return;
        }
        this.awaitingHeartbeatReply = true;
        this.sendPacket(2, 1, {});
      }, this.heartbeatIntervalMs);
      this.emit('open');
    });

    ws.addEventListener('message', async (event) => {
      if (this.ws !== ws) return;
      const data = event.data instanceof ArrayBuffer
        ? Buffer.from(event.data)
        : Buffer.from(await event.data.arrayBuffer());
      if (containsOperation(data, 3)) {
        this.awaitingHeartbeatReply = false;
      }
      this.emit('message', data);
    });

    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return;
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.awaitingHeartbeatReply = false;
      this.ws = null;
      this.emit('close', event);
    });

    ws.addEventListener('error', (event) => {
      if (this.ws !== ws) return;
      this.emit('error', event);
      this.failConnection(ws, {
        code: 0,
        reason: event && event.message ? event.message : 'websocket error',
        wasClean: false,
        connectionError: true
      });
    });

    if (options.waitForOpen) {
      await this.waitForSocketOpen(ws);
    }
  }

  close() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.awaitingHeartbeatReply = false;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch (_) {
        // Ignore shutdown errors.
      }
    }
  }

  failConnection(ws, event) {
    if (this.ws !== ws) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.awaitingHeartbeatReply = false;
    this.ws = null;
    try { ws.close(); } catch (_) {}
    this.emit('close', event);
  }

  sendPacket(operation, version, body) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const header = Buffer.alloc(16);
    header.writeUInt32BE(16 + payload.length, 0);
    header.writeUInt16BE(16, 4);
    header.writeUInt16BE(version, 6);
    header.writeUInt32BE(operation, 8);
    header.writeUInt32BE(1, 12);
    this.ws.send(Buffer.concat([header, payload]));
  }

  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler);
    }
  }

  clearHandlers() {
    this.eventHandlers = { open: [], message: [], close: [], error: [] };
  }

  emit(event, data) {
    const handlers = this.eventHandlers[event] || [];
    for (const handler of handlers) {
      handler(data);
    }
  }

  waitForSocketOpen(ws) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        try { ws.close(); } catch (_) {}
        reject(new Error('弹幕 WebSocket 连接超时，请稍后重试。'));
      }, 8000);

      const cleanup = () => {
        clearTimeout(timeout);
        ws.removeEventListener('open', handleOpen);
        ws.removeEventListener('error', handleError);
        ws.removeEventListener('close', handleClose);
      };
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('弹幕 WebSocket 连接失败。'));
      };
      const handleClose = () => {
        cleanup();
        reject(new Error('弹幕 WebSocket 连接已关闭。'));
      };

      ws.addEventListener('open', handleOpen);
      ws.addEventListener('error', handleError);
      ws.addEventListener('close', handleClose);
    });
  }
}

function containsOperation(buffer, expectedOperation) {
  let offset = 0;
  while (offset + 16 <= buffer.length) {
    const packetLength = buffer.readUInt32BE(offset);
    if (packetLength < 16 || offset + packetLength > buffer.length) return false;
    if (buffer.readUInt32BE(offset + 8) === expectedOperation) return true;
    offset += packetLength;
  }
  return false;
}

module.exports = { WebSocketConnection };
