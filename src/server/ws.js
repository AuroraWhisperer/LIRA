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
  sendWebSocketFrame(socket, JSON.stringify({
    type: 'snapshot',
    reason: 'connect',
    state: context.getState()
  }), 0x1);

  socket.on('close', () => context.state.sockets.delete(socket));
  socket.on('error', () => context.state.sockets.delete(socket));
}

function broadcastSnapshot(context, reason) {
  const state = context.getState();
  const payload = JSON.stringify({ type: 'snapshot', reason, state });
  for (const socket of context.state.sockets) {
    try { sendWebSocketFrame(socket, payload, 0x1); } catch (_) {
      socket.destroy();
      context.state.sockets.delete(socket);
    }
  }
}

function sendWebSocketFrame(socket, payload, opcode) {
  const data = Buffer.from(payload, 'utf8');
  const frame = buildWebSocketFrame(data, opcode);
  socket.write(frame);
}

function buildWebSocketFrame(data, opcode) {
  const length = data.length;
  let header;
  const maskKey = crypto.randomBytes(4);
  const masked = Buffer.alloc(length);

  if (length < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | length;
    header.writeUInt32BE(maskKey.readUInt32BE(0), 2);
  } else if (length < 65536) {
    header = Buffer.alloc(8);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
    header.writeUInt32BE(maskKey.readUInt32BE(0), 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
    header.writeUInt32BE(maskKey.readUInt32BE(0), 10);
  }

  for (let i = 0; i < length; i++) {
    masked[i] = data[i] ^ maskKey[i % 4];
  }

  return Buffer.concat([header, masked]);
}

module.exports = { handleWebSocketUpgrade, broadcastSnapshot };
