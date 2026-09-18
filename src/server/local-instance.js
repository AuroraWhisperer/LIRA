'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { readPortOwner, isOwnProcess } = require('./local-process-owner');

const CHALLENGE_HEADER = 'x-lira-instance-challenge';
const MAX_HEALTH_BYTES = 16384;

function createInstanceProof(token, challenge, port) {
  if (!token || typeof challenge !== 'string' || !/^[a-f0-9]{64}$/.test(challenge)) return '';
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return '';
  return crypto.createHmac('sha256', token)
    .update(`LIRA local shutdown peer v1\n${port}\n${challenge}`)
    .digest('hex');
}

function verifyProof(token, challenge, port, actual) {
  const expected = createInstanceProof(token, challenge, port);
  return Boolean(expected && typeof actual === 'string' && /^[a-f0-9]{64}$/.test(actual) &&
    crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex')));
}

function exchange(agent, port, { challenge, token, verifiedSocket } = {}) {
  return new Promise((resolve, reject) => {
    const shutdown = Boolean(verifiedSocket);
    let socket;
    const req = http.request({
      host: '127.0.0.1', port, agent,
      method: shutdown ? 'POST' : 'GET',
      path: shutdown ? '/api/system/shutdown' : '/api/health',
      headers: shutdown ? { 'Content-Type': 'application/json' } : { [CHALLENGE_HEADER]: challenge },
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('error', reject);
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_HEALTH_BYTES) {
          reject(new Error('Local instance response exceeded limit'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (_) {
          body = null;
        }
        resolve({ status: res.statusCode, body, socket });
      });
    });
    req.on('error', reject);
    const deadline = setTimeout(() => {
      reject(new Error('Local instance request timed out'));
      req.destroy();
    }, 1000);
    req.once('close', () => clearTimeout(deadline));
    req.on('socket', (assigned) => {
      socket = assigned;
      if (shutdown && (socket !== verifiedSocket || socket.destroyed)) {
        reject(new Error('Verified local connection was replaced'));
        req.destroy();
        return;
      }
      // Do not even queue credentials until the verified connection is assigned.
      if (shutdown && token) req.setHeader('Authorization', `Bearer ${token}`);
      req.end(shutdown ? JSON.stringify({ confirm: true }) : undefined);
    });
  });
}

async function requestVerifiedShutdown({ port, token, rootDir }) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  let owner = null;
  let verified = false;
  try {
    const challenge = crypto.randomBytes(32).toString('hex');
    const health = await exchange(agent, port, { challenge });
    if (!health.socket || health.socket.destroyed) return { verified, owner };
    const processInfo = readPortOwner(port, health.socket.localPort);
    if (processInfo?.ProcessId === process.pid) return { verified, owner };
    owner = isOwnProcess(processInfo, rootDir) ? processInfo : null;
    verified = Boolean(owner || (health.status === 200 && health.body?.ok === true &&
      health.body.data?.phase === 'ready' &&
      verifyProof(token, challenge, port, health.body.data?.instanceProof)));
    if (!verified) return { verified, owner };
    await exchange(agent, port, { token, verifiedSocket: health.socket });
  } catch (_) {
    // A verified instance may close while handling shutdown. Never retry on a new socket.
    return { verified, owner };
  } finally {
    agent.destroy();
  }
  return { verified, owner };
}

module.exports = { CHALLENGE_HEADER, createInstanceProof, requestVerifiedShutdown };
