'use strict';

const { createHash } = require('node:crypto');

// Reuse only within one paginated load, never across a refresh or account change.
const providerSessions = new WeakMap();

function getLikedTracksSession(provider, sessionId, cookie) {
  let state = providerSessions.get(provider);
  const hasSession = typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 100;
  if (!hasSession && !state) return null;
  const signature = createHash('sha256').update(cookie).digest('hex');
  if (!hasSession) {
    // A sessionless read can still invalidate an older account's pages.
    if (state.signature !== signature) clearLikedTracksSessions(provider);
    return null;
  }
  if (!state || state.signature !== signature) {
    state = { signature, sessions: new Map() };
    providerSessions.set(provider, state);
  }
  const now = Date.now();
  for (const [key, session] of state.sessions) {
    if (now - session.createdAt > 5 * 60 * 1000) state.sessions.delete(key);
  }
  let session = state.sessions.get(sessionId);
  if (!session) {
    if (state.sessions.size >= 8) state.sessions.delete(state.sessions.keys().next().value);
    session = { createdAt: now };
    state.sessions.set(sessionId, session);
  }
  return session;
}

function clearLikedTracksSessions(provider) {
  providerSessions.delete(provider);
}

module.exports = { getLikedTracksSession, clearLikedTracksSessions };
