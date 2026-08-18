'use strict';

const numberBomb = require('./number-bomb');
const gomoku = require('./gomoku');

function createGameSessionService(options = {}) {
  const broadcast = typeof options.broadcast === 'function' ? options.broadcast : () => {};
  const viewers = new Map();
  let session = null;

  function touchViewer(danmaku = {}) {
    const uid = String(danmaku.uid || '').trim();
    const name = String(danmaku.userName || '观众').trim() || '观众';
    if (!uid && name === '观众') return;
    const key = uid || `name:${name}`;
    viewers.set(key, { uid, name, lastSeenAt: Date.now() });
    pruneViewers();
  }

  function listViewers() {
    pruneViewers();
    return [...viewers.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  function start(input = {}) {
    const game = input.game === 'gomoku' ? 'gomoku' : 'number-bomb';
    const mode = input.mode === 'multi' ? 'multi' : 'single';
    const targetUid = String(input.targetUid || '').trim();
    const targetName = String(input.targetName || '').trim();
    session = {
      game,
      mode,
      targetUid,
      targetName,
      startedAt: new Date().toISOString(),
      state: game === 'gomoku' ? gomoku.createGomokuState() : numberBomb.createNumberBombState()
    };
    publish();
    return publicSession();
  }

  function stop() {
    session = null;
    publish();
    return null;
  }

  function move(input = {}, player = 'host') {
    if (!session) return { accepted: false, reason: '当前没有进行中的游戏。' };
    const result = session.game === 'gomoku'
      ? gomoku.placeStone(session.state, input.value, player)
      : numberBomb.guessNumber(session.state, input.value, player);
    if (!result.accepted) return result;
    session.state = result.state;
    publish();
    return { ...result, session: publicSession() };
  }

  function handleDanmaku(danmaku = {}) {
    touchViewer(danmaku);
    if (!session || session.state.winner || session.state.turn !== 'viewer') return { accepted: false };
    const uid = String(danmaku.uid || '').trim();
    const isTarget = session.mode === 'multi' || !session.targetUid || uid === session.targetUid;
    if (!isTarget) return { accepted: false };
    const value = session.game === 'gomoku'
      ? extractCoordinate(danmaku.message)
      : extractNumber(danmaku.message);
    if (value === null) return { accepted: false };
    return move({ value }, 'viewer');
  }

  function getSession() { return publicSession(); }

  function publicSession() {
    if (!session) return null;
    return {
      game: session.game,
      mode: session.mode,
      targetUid: session.targetUid,
      targetName: session.targetName,
      startedAt: session.startedAt,
      state: session.game === 'number-bomb'
        ? numberBomb.publicNumberBombState(session.state)
        : session.state
    };
  }

  function publish() {
    broadcast({ type: 'game:update', session: publicSession() });
  }

  function pruneViewers() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, viewer] of viewers) if (viewer.lastSeenAt < cutoff) viewers.delete(key);
  }

  return { start, stop, move, handleDanmaku, getSession, listViewers };
}

function extractNumber(message) {
  const match = String(message || '').match(/\b(\d{1,3})\b/);
  return match ? Number(match[1]) : null;
}

function extractCoordinate(message) {
  const match = String(message || '').toUpperCase().match(/\b([A-O](?:1[0-5]|[1-9]))\b/);
  return match ? match[1] : null;
}

module.exports = { createGameSessionService, extractNumber, extractCoordinate };
