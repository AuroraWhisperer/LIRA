// 编写人：Aurora
// WebSocket 连接管理器 — 负责 Bilibili 弹幕长连的连接、心跳和数据包收发。
'use strict';

const { performance } = require('node:perf_hooks');

const OPEN_TIMEOUT_MS = 8000;
const AUTH_TIMEOUT_MS = 10000;
const HEARTBEAT_INTERVAL_MS = 30000;

class WebSocketConnection {
  constructor(options = {}) {
    this.ws = null;
    this.finishHandshake = null;
    this.heartbeatTimer = null;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || HEARTBEAT_INTERVAL_MS;
    this.awaitingHeartbeatReply = false;
    this.clearHandlers();
  }

  async connect(wsUrl, authPayload, { waitForAuthentication = false } = {}) {
    this.close();

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    const trace = {
      authStatus: 'pending',
      packets: 0,
      heartbeatReplies: 0,
      lastPacketAt: '',
    };
    const report = (event, details = {}) => this.emit('diagnostic', { event, ...details });
    this.connectionTrace = trace;

    const ready = waitForAuthentication ? Promise.withResolvers() : null;
    const failHandshake = (message) => this.failConnection(ws, { code: 0, reason: message, wasClean: false }, message);
    let deadline = ready ? setTimeout(() => failHandshake('弹幕 WebSocket 连接超时，请稍后重试。'), OPEN_TIMEOUT_MS) : null;
    this.finishHandshake = (error) => {
      clearTimeout(deadline);
      this.finishHandshake = null;
      if (error) ready?.reject(error);
      else ready?.resolve();
    };

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      clearTimeout(deadline);
      deadline = setTimeout(() => {
        if (this.ws !== ws) return;
        trace.authStatus = 'no-reply';
        report('auth-no-reply', { waitedMs: AUTH_TIMEOUT_MS });
        failHandshake('弹幕服务鉴权超时，请稍后重试。');
      }, AUTH_TIMEOUT_MS);
      this.sendPacket(7, 1, authPayload);
      if (this.ws !== ws) return;
      report('auth-sent');
      clearInterval(this.heartbeatTimer);
      this.awaitingHeartbeatReply = false;
      this.heartbeatTimer = setInterval(() => {
        if (this.awaitingHeartbeatReply) {
          this.failConnection(ws, {
            code: 0,
            reason: 'heartbeat timeout',
            wasClean: false,
            heartbeatTimeout: true,
          });
          return;
        }
        this.awaitingHeartbeatReply = true;
        this.sendPacket(2, 1, {});
      }, this.heartbeatIntervalMs);
      this.emit('open');
    });

    let frameSeq = 0;
    let reading = false;
    const frames = [];
    const deliver = (data, metadata) => {
      if (this.ws !== ws) return;
      trace.packets += 1;
      trace.lastPacketAt = new Date().toISOString();
      if (trace.packets === 1) report('socket-first-packet');
      if (containsOperation(data, 3)) {
        this.awaitingHeartbeatReply = false;
        trace.heartbeatReplies += 1;
        if (trace.heartbeatReplies === 1) report('heartbeat-confirmed');
      }
      const reply = trace.authStatus === 'pending' ? authenticationReply(data) : null;
      if (reply) {
        const { code } = reply;
        trace.authStatus = code === null ? 'invalid' : code === 0 ? 'accepted' : 'rejected';
        report('auth-result', { status: trace.authStatus, code });
        if (this.ws !== ws) return;
        if (code !== 0) {
          failHandshake('弹幕服务鉴权失败，请检查 B 站登录状态。');
          return;
        }
        this.finishHandshake?.();
        this.emit('authenticated');
      }
      if (this.ws === ws) this.emit('message', data, metadata);
    };
    const drain = () => {
      while (!reading && frames.length && this.ws === ws) {
        const { data, metadata } = frames.shift();
        if (data instanceof ArrayBuffer) {
          deliver(Buffer.from(data), metadata);
        } else {
          reading = true;
          Promise.resolve()
            .then(() => data.arrayBuffer())
            .then((buffer) => {
              deliver(Buffer.from(buffer), metadata);
            })
            .catch((error) => {
              if (this.ws === ws) this.emit('error', error);
            })
            .finally(() => {
              reading = false;
              if (this.ws !== ws) frames.length = 0;
              else drain();
            });
        }
      }
    };
    ws.addEventListener('message', (event) => {
      if (this.ws !== ws) return;
      frames.push({ data: event.data, metadata: { receivedAt: performance.now(), frameSeq: ++frameSeq } });
      drain();
    });

    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return;
      this.resetConnection('弹幕 WebSocket 连接已关闭。');
      report('socket-summary', trace);
      this.emit('close', event);
    });

    ws.addEventListener('error', (event) => {
      if (this.ws !== ws) return;
      this.emit('error', event);
      this.failConnection(ws, {
        code: 0,
        reason: event && event.message ? event.message : 'websocket error',
        wasClean: false,
        connectionError: true,
      }, '弹幕 WebSocket 连接失败。');
    });

    return ready?.promise;
  }

  resetConnection(message) {
    this.finishHandshake?.(new Error(message));
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.awaitingHeartbeatReply = false;
    this.ws = null;
  }

  close(message = '弹幕 WebSocket 连接已关闭。') {
    const ws = this.ws;
    this.resetConnection(message);
    if (ws) {
      try {
        ws.close();
      } catch (_) {
        // Ignore shutdown errors.
      }
    }
  }

  failConnection(ws, event, message) {
    if (this.ws !== ws) return;
    const trace = this.connectionTrace;
    this.close(message);
    this.emit('diagnostic', { event: 'socket-summary', ...trace });
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
    this.eventHandlers = {
      open: [],
      authenticated: [],
      message: [],
      close: [],
      error: [],
      diagnostic: [],
    };
  }

  emit(event, data, metadata) {
    const handlers = this.eventHandlers[event] || [];
    for (const handler of handlers) {
      handler(data, metadata);
    }
  }
}

function authenticationReply(buffer) {
  let offset = 0;
  while (offset + 16 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const headerLength = buffer.readUInt16BE(offset + 4);
    if (length < 16 || headerLength < 16 || headerLength > length || offset + length > buffer.length) break;
    if (buffer.readUInt32BE(offset + 8) === 8) {
      let code;
      try {
        const reply = JSON.parse(buffer.subarray(offset + headerLength, offset + length).toString('utf8'));
        code = Number.isInteger(reply?.code) ? reply.code : null;
      } catch (_) {
        // The raw authentication response may contain secrets; retain only its validity.
        code = null;
      }
      return { code };
    }
    offset += length;
  }
  return null;
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
