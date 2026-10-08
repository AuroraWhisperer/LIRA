'use strict';

const { once } = require('node:events');

// Encodes one client-to-server WebSocket frame. Clients must mask payloads;
// the mask value is irrelevant to the server and only needs to be four bytes.
function maskedFrame(payload, { opcode = 0x1, fin = true, mask = [0x12, 0x34, 0x56, 0x78] } = {}) {
  const body = Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | body.length;
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  header[0] = (fin ? 0x80 : 0) | opcode;
  const key = Buffer.from(mask);
  const masked = Buffer.from(body);
  for (let index = 0; index < masked.length; index += 1) masked[index] ^= key[index % 4];
  return Buffer.concat([header, key, masked]);
}

// Starts the real local HTTP transport on an ephemeral loopback port and
// closes it, including kept-alive connections, when the test finishes.
async function listenHttpServer(t, options = {}) {
  const { createHttpServer } = require('../../src/server/http-server');
  const server = createHttpServer({
    host: '127.0.0.1',
    startPort: 0,
    getPhase: () => 'ready',
    getStartedPort: () => server.address()?.port,
    isLicenseAuthorized: () => true,
    ...options,
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  return { server, port, origin: `http://127.0.0.1:${port}` };
}

module.exports = { maskedFrame, listenHttpServer };
