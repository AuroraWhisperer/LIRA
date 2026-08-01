// 编写人：Aurora
// WebSocket 连接管理器 — 负责 Bilibili 弹幕长连的连接、心跳和数据包收发。
'use strict';

class WebSocketConnection {
  constructor() {
    this.ws = null;
    this.heartbeatTimer = null;
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
      this.heartbeatTimer = setInterval(() => this.sendPacket(2, 1, {}), 30000);
      this.emit('open');
    });

    ws.addEventListener('message', async (event) => {
      if (this.ws !== ws) return;
      const data = event.data instanceof ArrayBuffer
        ? Buffer.from(event.data)
        : Buffer.from(await event.data.arrayBuffer());
      this.emit('message', data);
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      clearInterval(this.heartbeatTimer);
      this.ws = null;
      this.emit('close');
    });

    ws.addEventListener('error', () => {
      if (this.ws !== ws) return;
      this.emit('error');
    });

    if (options.waitForOpen) {
      await this.waitForSocketOpen(ws);
    }
  }

  close() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
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

module.exports = { WebSocketConnection };
