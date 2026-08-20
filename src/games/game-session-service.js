'use strict';

const { performance } = require('node:perf_hooks');
const numberBomb = require('./number-bomb');
const gomoku = require('./gomoku');
const drawGuess = require('./draw-guess');

function createGameSessionService(options = {}) {
  const broadcast = typeof options.broadcast === 'function' ? options.broadcast : () => {};
  const monotonicNow = typeof options.monotonicNow === 'function' ? options.monotonicNow : () => performance.now();
  const wallNow = typeof options.wallNow === 'function' ? options.wallNow : Date.now;
  const scheduleTimeout = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
  const cancelTimeout = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const viewers = new Map();
  let session = null;
  let viewer = null;
  let winner = null;
  let roundTimer = null;
  const MAX_DANMAKU = 500;

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
    if (session) {
      const error = new Error('已有游戏正在进行，请先结束当前游戏。');
      error.statusCode = 409;
      throw error;
    }
    const game = input.game === 'gomoku'
      ? 'gomoku'
      : input.game === 'draw-guess' ? 'draw-guess' : 'number-bomb';
    const mode = game === 'draw-guess' || input.mode === 'multi' ? 'multi' : 'single';
    const targetUid = String(input.targetUid || '').trim();
    const targetName = String(input.targetName || '').trim();
    viewer = targetUid ? { uid: targetUid, name: targetName || '观众' } : null;
    winner = null;
    session = {
      game,
      mode,
      targetUid,
      targetName,
      startedAt: new Date(wallNow()).toISOString(),
      state: game === 'gomoku'
        ? gomoku.createGomokuState()
        : game === 'draw-guess'
          ? drawGuess.createDrawGuessState({
            words: options.drawGuessWords,
            totalRounds: input.totalRounds,
            roundDurationSeconds: input.roundDurationSeconds,
            random,
            nowMs: monotonicNow()
          })
          : numberBomb.createNumberBombState()
    };
    if (game === 'draw-guess') session.danmaku = [];
    scheduleDrawGuessTimer();
    publish();
    return publicSessionRaw();
  }

  function stop() {
    cancelDrawGuessTimer();
    session = null;
    viewer = null;
    winner = null;
    publish();
    return null;
  }

  function move(input = {}, player = 'host', playerIdentity = {}) {
    if (!session) return { accepted: false, reason: '当前没有进行中的游戏。' };
    materializeDrawGuessDeadline();
    if (session.game === 'draw-guess') return controlDrawGuess(input, player);
    const result = session.game === 'gomoku'
      ? gomoku.placeStone(session.state, input.value, player)
      : numberBomb.guessNumber(session.state, input.value, player);
    if (!result.accepted) return result;
    session.state = result.state;
    if (player === 'viewer') viewer = normalizeViewer(playerIdentity, viewer);
    if (result.state.winner) {
      winner = result.state.winner === 'viewer'
        ? { role: 'viewer', ...(viewer || {}) }
        : { role: 'host', uid: '', name: '' };
    }
    publish();
    return { ...result, session: publicSessionRaw() };
  }

  function handleDanmaku(danmaku = {}) {
    touchViewer(danmaku);
    if (session?.game === 'draw-guess') {
      session.danmaku.push(normalizeGameDanmaku(danmaku));
      if (session.danmaku.length > MAX_DANMAKU) session.danmaku.splice(0, session.danmaku.length - MAX_DANMAKU);
      materializeDrawGuessDeadline();
      const result = drawGuess.submitGuess(session.state, danmaku, monotonicNow());
      publish();
      if (!result.accepted) return { ...result, session: publicSessionRaw() };
      session.state = result.state;
      publish();
      return { ...result, session: publicSessionRaw() };
    }
    materializeDrawGuessDeadline();
    if (!session || session.state.winner || session.state.turn !== 'viewer') return { accepted: false };
    const uid = String(danmaku.uid || '').trim();
    const isTarget = session.mode === 'multi' || !session.targetUid || uid === session.targetUid;
    if (!isTarget) return { accepted: false };
    const value = session.game === 'gomoku'
      ? extractCoordinate(danmaku.message)
      : extractNumber(danmaku.message);
    if (value === null) return { accepted: false };
    return move({ value }, 'viewer', { uid, name: danmaku.userName });
  }

  function draw(input = {}) {
    materializeDrawGuessDeadline();
    if (!session || session.game !== 'draw-guess') return { accepted: false, reason: '你画我猜尚未开始。' };
    const result = drawGuess.applyDrawOperation(session.state, input);
    if (!result.accepted) return result;
    session.state = result.state;
    broadcast({ type: 'game:draw', operation: result.operation, revision: result.operation.revision });
    return { accepted: true, revision: result.operation.revision };
  }

  function getSession() {
    materializeDrawGuessDeadline();
    return publicSessionRaw();
  }

  function getHostState() {
    materializeDrawGuessDeadline();
    return session?.game === 'draw-guess' ? drawGuess.getHostDrawGuessState(session.state) : null;
  }

  function publicSessionRaw() {
    if (!session) return null;
    return {
      game: session.game,
      mode: session.mode,
      targetUid: session.targetUid,
      targetName: session.targetName,
      startedAt: session.startedAt,
      ...(session.game === 'draw-guess' ? { danmaku: session.danmaku || [] } : {}),
      ...(winner ? { winner } : {}),
      state: session.game === 'number-bomb'
        ? numberBomb.publicNumberBombState(session.state)
        : session.game === 'draw-guess'
          ? drawGuess.publicDrawGuessState(session.state, {
            nowMs: monotonicNow(),
            serverNowMs: wallNow()
          })
          : session.state
    };
  }

  function publish() {
    broadcast({ type: 'game:update', session: publicSessionRaw() });
  }

  function controlDrawGuess(input, player) {
    if (player !== 'host') return { accepted: false, reason: '只有主播可以控制回合。' };
    const action = String(input.value?.action || input.action || '').trim();
    if (action === 'finish-round') {
      if (session.state.phase !== 'drawing') return { accepted: false, reason: '当前回合已经结束。' };
      finishDrawGuessRound({ reveal: false, deferFinal: true });
      return { accepted: true, state: session.state, session: publicSessionRaw() };
    }
    if (action === 'reveal-answer') {
      if (session.state.phase !== 'round-result' || session.state.answerRevealed) {
        return { accepted: false, reason: '当前没有待公布的答案。' };
      }
      session.state = drawGuess.revealAnswer(session.state);
      if (session.state.phase === 'finished') {
        const champion = session.state.scores[0];
        winner = champion ? { role: 'viewer', uid: champion.uid, name: champion.name } : null;
      }
      publish();
      return { accepted: true, state: session.state, session: publicSessionRaw() };
    }
    if (action === 'next-round') {
      if (session.state.phase !== 'round-result' || !session.state.answerRevealed) return { accepted: false, reason: '请先公布答案。' };
      session.state = drawGuess.startNextRound(session.state, { random, nowMs: monotonicNow() });
      scheduleDrawGuessTimer();
      publish();
      return { accepted: true, state: session.state, session: publicSessionRaw() };
    }
    return { accepted: false, reason: '不支持这个回合操作。' };
  }

  function materializeDrawGuessDeadline() {
    if (session?.game !== 'draw-guess' || session.state.phase !== 'drawing') return false;
    if (monotonicNow() < session.state.roundDeadlineMs) return false;
    finishDrawGuessRound({ reveal: false, deferFinal: true });
    return true;
  }

  function finishDrawGuessRound(options = {}) {
    cancelDrawGuessTimer();
    session.state = drawGuess.finishRound(session.state, monotonicNow(), options);
    if (session.state.phase === 'finished') {
      const champion = session.state.scores[0];
      winner = champion ? { role: 'viewer', uid: champion.uid, name: champion.name } : null;
    }
    publish();
  }

  function scheduleDrawGuessTimer() {
    cancelDrawGuessTimer();
    if (session?.game !== 'draw-guess' || session.state.phase !== 'drawing') return;
    const delay = Math.max(0, session.state.roundDeadlineMs - monotonicNow());
    roundTimer = scheduleTimeout(() => {
      if (session?.game === 'draw-guess' && session.state.phase === 'drawing') {
        finishDrawGuessRound({ reveal: false, deferFinal: true });
      }
    }, Math.ceil(delay));
  }

  function cancelDrawGuessTimer() {
    if (roundTimer === null) return;
    cancelTimeout(roundTimer);
    roundTimer = null;
  }

  function dispose() {
    cancelDrawGuessTimer();
  }

  function pruneViewers() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, viewer] of viewers) if (viewer.lastSeenAt < cutoff) viewers.delete(key);
  }

  return { start, stop, move, draw, handleDanmaku, getSession, getHostState, listViewers, dispose };
}

function normalizeGameDanmaku(danmaku = {}) {
  return {
    uid: String(danmaku.uid || '').trim().slice(0, 40),
    name: String(danmaku.userName || '观众').trim().slice(0, 80) || '观众',
    message: String(danmaku.message || '').trim().slice(0, 300),
    avatarUrl: String(danmaku.avatarUrl || danmaku.face || '').trim().slice(0, 500),
    timestamp: Number.isFinite(Number(danmaku.messageTimestamp))
      ? Number(danmaku.messageTimestamp)
      : Date.now()
  };
}

function normalizeViewer(input = {}, fallback = null) {
  const uid = String(input.uid || fallback?.uid || '').trim();
  const name = String(input.name || fallback?.name || '观众').trim() || '观众';
  return uid ? { uid, name } : fallback;
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
