'use strict';

// Reuse only within one paginated load, never across a refresh or account change.
const providerSessions = new WeakMap();

async function getLikedTracksSession(provider, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 100) return null;
  const cookie = await provider.getSafeCookieHeader();
  let state = providerSessions.get(provider);
  if (!state || state.cookie !== cookie) {
    state = { cookie, sessions: new Map() };
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
