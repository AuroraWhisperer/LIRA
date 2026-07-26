// 编写人：Aurora
// WebSocket 连接管理 + 广播。
'use strict';

const crypto = require('node:crypto');

function handleWebSocketUpgrade(context, req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );

  context.state.sockets.add(socket);
  socket.on('close', () => context.state.sockets.delete(socket));
  socket.on('error', () => context.state.sockets.delete(socket));
  socket.on('data', (buffer) => handleWebSocketFrame(context, socket, buffer));
  sendWebSocket(socket, {
    type: 'snapshot',
    reason: 'connect',
    state: context.getState()
  });
}

function handleWebSocketFrame(context, socket, buffer) {
  if (!buffer.length) return;
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) {
    sendWebSocketFrame(socket, Buffer.alloc(0), 0x8);
    context.state.sockets.delete(socket);
    socket.end();
    return;
  }
  if (opcode === 0x9) {
    sendWebSocketFrame(socket, readWebSocketPayload(buffer), 0xA);
  }
}

function readWebSocketPayload(buffer) {
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  const masked = Boolean(buffer[1] & 0x80);
  let mask;
  if (masked) {
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked && mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return payload;
}

function broadcastSnapshot(context, reason) {
  const payload = { type: 'snapshot', reason, state: context.getState() };
  for (const socket of Array.from(context.state.sockets)) {
    sendWebSocket(socket, payload);
  }
}

function sendWebSocket(socket, payload) {
  sendWebSocketFrame(socket, Buffer.from(JSON.stringify(payload)), 0x1);
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
  socket.write(Buffer.concat([header, payload]));
}

module.exports = { handleWebSocketUpgrade, broadcastSnapshot, sendWebSocket };
