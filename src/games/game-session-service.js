'use strict';

const { createPublicError } = require('../shared/public-error');

const { randomUUID } = require('node:crypto');
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
  const viewers = new Map();
  let viewerSourceKey = '';
  let session = null;
  let viewer = null;
  let winner = null;
  let roundTimer = null;
  let scoreTimer = null;
  const MAX_DANMAKU = 500;
  const SCORE_UPDATE_DELAY_MS = 40;

  function touchViewer(danmaku = {}) {
    if (!syncViewerSource()) return;
    const uid = String(danmaku.uid || '').trim();
    const name = String(danmaku.userName || '观众').trim() || '观众';
    if (!uid && name === '观众') return;
    const key = uid || `name:${name}`;
    // Keep insertion order aligned with expiry so each stale viewer is visited once.
    viewers.delete(key);
    viewers.set(key, { uid, name, lastSeenAt: wallNow(), expiresAtMs: monotonicNow() + 10 * 60 * 1000 });
    pruneViewers();
  }

  function listViewers() {
    syncViewerSource();
    pruneViewers();
    return [...viewers.values()]
      .map(({ uid, name, lastSeenAt }) => ({ uid, name, lastSeenAt }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  function syncViewerSource() {
    if (!options.getSourceState) return true;
    const source = options.getSourceState();
    const key = source.configuredRoomChanged ? '' : JSON.stringify([source.roomId, source.accountUid, source.connectionKey]);
    if (key !== viewerSourceKey) {
      viewers.clear();
      viewerSourceKey = key;
    }
    return !source.configuredRoomChanged;
  }

  function assertCanCollect() {
    if (options.isInteractionCollecting?.()) {
      throw createPublicError('请先结束类别 3 的投票或评分。', 409);
    }
  }

  function isActive() {
    materializeDrawGuessDeadline();
    return Boolean(
      session && (session.game === 'draw-guess' ? session.state.phase !== 'finished' : !session.state.winner),
    );
  }

  function start(input = {}) {
    assertCanCollect();
    if (session) {
      throw createPublicError('已有游戏正在进行，请先结束当前游戏。', 409);
    }
    const game = input.game === 'gomoku' ? 'gomoku' : input.game === 'draw-guess' ? 'draw-guess' : 'number-bomb';
    const mode = game === 'draw-guess' || input.mode === 'multi' ? 'multi' : 'single';
    const targetUid = String(input.targetUid || '').trim();
    const targetName = String(input.targetName || '').trim();
    viewer = targetUid ? { uid: targetUid, name: targetName || '观众' } : null;
    winner = null;
    session = {
      sessionId: randomUUID(),
      eventRevision: 0,
      game,
      mode,
      targetUid,
      targetName,
      startedAt: new Date(wallNow()).toISOString(),
      state:
        game === 'gomoku'
          ? gomoku.createGomokuState()
          : game === 'draw-guess'
            ? drawGuess.createDrawGuessState({
                words: options.drawGuessWords,
                categoryIds: input.categoryIds,
                totalRounds: input.totalRounds,
                roundDurationSeconds: input.roundDurationSeconds,
              })
            : numberBomb.createNumberBombState(),
    };
    if (game === 'draw-guess') session.danmaku = [];
    scheduleDrawGuessTimer();
    publish(true);
    return publicSessionRaw();
  }

  function stop() {
    cancelDrawGuessTimer();
    cancelScoreUpdate();
    session = null;
    viewer = null;
    winner = null;
    publish();
    return null;
  }

  function restart() {
    assertCanCollect();
    if (!session || session.game === 'draw-guess' || !session.state.winner) {
      throw createPublicError('当前游戏尚未结算。', 409);
    }
    const input = {
      game: session.game,
      mode: session.mode,
      targetUid: session.targetUid,
      targetName: session.targetName,
    };
    session = null;
    viewer = null;
    winner = null;
    return start(input);
  }

  function move(input = {}, player = 'host', playerIdentity = {}) {
    if (!session) return { accepted: false, reason: '当前没有进行中的游戏。' };
    materializeDrawGuessDeadline();
    if (session.game === 'draw-guess') return controlDrawGuess(input, player);
    const result =
      session.game === 'gomoku'
        ? gomoku.placeStone(session.state, input.value, player)
        : numberBomb.guessNumber(session.state, input.value, player);
    if (!result.accepted) return result;
    session.state = result.state;
    if (player === 'viewer') viewer = normalizeViewer(playerIdentity, viewer);
    if (result.state.winner === 'draw') {
      winner = null;
    } else if (result.state.winner) {
      winner =
        result.state.winner === 'viewer' ? { role: 'viewer', ...(viewer || {}) } : { role: 'host', uid: '', name: '' };
    }
    publish();
    return { ...result, session: publicSessionRaw() };
  }

  function handleDanmaku(danmaku = {}) {
    const isStreamer = danmaku.isStreamer === true;
    if (!isStreamer) touchViewer(danmaku);
    if (session?.game === 'draw-guess') {
      materializeDrawGuessDeadline();
      const item = normalizeGameDanmaku(danmaku);
      session.danmaku.push(item);
      if (session.danmaku.length > MAX_DANMAKU) session.danmaku.splice(0, session.danmaku.length - MAX_DANMAKU);
      const result = isStreamer ? { accepted: false } : drawGuess.submitGuess(session.state, danmaku, monotonicNow());
      if (result.accepted) session.state = result.state;
      publishPatch({ item });
      if (result.accepted) scheduleScoreUpdate();
      return { ...result, game: 'draw-guess' };
    }
    materializeDrawGuessDeadline();
    if (isStreamer || !session || session.state.winner || session.state.turn !== 'viewer') return { accepted: false };
    const uid = String(danmaku.uid || '').trim();
    const isTarget = session.mode === 'multi' || !session.targetUid || uid === session.targetUid;
    if (!isTarget) return { accepted: false };
    const value = session.game === 'gomoku' ? extractCoordinate(danmaku.message) : extractNumber(danmaku.message);
    if (value === null) return { accepted: false };
    return move({ value }, 'viewer', { uid, name: danmaku.userName });
  }

  function draw(input = {}) {
    materializeDrawGuessDeadline();
    if (!session || session.game !== 'draw-guess') return { accepted: false, reason: '你画我猜尚未开始。' };
    if (
      (input.sessionId && input.sessionId !== session.sessionId) ||
      (input.round !== undefined && input.round !== session.state.round)
    ) {
      return { accepted: false, reason: '画笔所属回合已经结束。' };
    }
    const result = drawGuess.applyDrawOperation(session.state, input);
    if (!result.accepted) return result;
    session.state = result.state;
    broadcast({
      type: 'game:draw',
      sessionId: session.sessionId,
      eventRevision: ++session.eventRevision,
      round: session.state.round,
      operation: result.operation,
      revision: result.operation.revision,
    });
    return { accepted: true, revision: result.operation.revision };
  }

  function updateDanmakuAvatar(input = {}) {
    if (session?.game !== 'draw-guess') return false;
    const uid = String(input.uid || '').trim();
    const avatarUrl = String(input.avatarUrl || '')
      .trim()
      .slice(0, 500);
    if (!uid || !avatarUrl) return false;
    let changed = false;
    for (const item of session.danmaku || []) {
      if (item.uid === uid && !item.avatarUrl) {
        item.avatarUrl = avatarUrl;
        changed = true;
      }
    }
    if (changed) publishPatch({ avatar: { uid, avatarUrl } });
    return changed;
  }

  function getSession() {
    materializeDrawGuessDeadline();
    return publicSessionRaw();
  }

  function getDisplaySession(known = {}) {
    materializeDrawGuessDeadline();
    const drawing = session?.game === 'draw-guess';
    const prefix = drawing ? `${session.sessionId}_${session.state.round}` : '';
    const canvasVersion = drawing ? `${prefix}_${session.state.canvas.revision}` : null;
    const scoresVersion = drawing ? `${prefix}_${session.state.correct.length}` : null;
    return {
      session: publicSessionRaw({ includeCanvas: !canvasVersion || known.canvasVersion !== canvasVersion,
        includeScores: !scoresVersion || known.scoresVersion !== scoresVersion }),
      canvasVersion,
      scoresVersion,
    };
  }

  function getMenuState() {
    materializeDrawGuessDeadline();
    return session ? { game: session.game,
      state: { phase: session.state.phase, turn: session.state.turn, winner: session.state.winner } } : null;
  }

  function getHostState() {
    materializeDrawGuessDeadline();
    return session?.game === 'draw-guess' ? drawGuess.getHostDrawGuessState(session.state) : null;
  }

  function listDrawGuessCategories() {
    return drawGuess.getDrawGuessCategories();
  }

  function publicSessionRaw(projection = {}) {
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      eventRevision: session.eventRevision,
      game: session.game,
      ...(options.isInteractionCollecting?.() ? { restartBlocked: true } : {}),
      mode: session.mode,
      targetUid: session.targetUid,
      targetName: session.targetName,
      startedAt: session.startedAt,
      ...(session.game === 'draw-guess' ? { danmaku: session.danmaku || [] } : {}),
      ...(winner ? { winner } : {}),
      state:
        session.game === 'number-bomb'
          ? numberBomb.publicNumberBombState(session.state)
          : session.game === 'draw-guess'
            ? drawGuess.publicDrawGuessState(session.state, {
                nowMs: monotonicNow(),
                serverNowMs: wallNow(),
                ...projection,
              })
            : session.state,
    };
  }

  function publish(full = false) {
    cancelScoreUpdate();
    if (session?.game === 'draw-guess' && !full) {
      publishPatch({
        state: drawGuess.publicDrawGuessState(session.state, {
          nowMs: monotonicNow(),
          serverNowMs: wallNow(),
          includeCanvas: false,
        }),
        restartBlocked: Boolean(options.isInteractionCollecting?.()),
      });
      return;
    }
    if (session) session.eventRevision += 1;
    broadcast({ type: 'game:update', session: publicSessionRaw() });
  }

  function publishPatch(fields) {
    broadcast({
      type: 'game:patch',
      sessionId: session.sessionId,
      eventRevision: ++session.eventRevision,
      round: session.state.round,
      ...fields,
    });
  }

  function scheduleScoreUpdate() {
    if (scoreTimer !== null) return;
    const pending = { sessionId: session.sessionId, round: session.state.round };
    scoreTimer = pending;
    pending.id = scheduleTimeout(() => {
      if (scoreTimer !== pending) return;
      scoreTimer = null;
      if (session?.sessionId === pending.sessionId && session.state.round === pending.round) publish();
    }, SCORE_UPDATE_DELAY_MS);
  }

  function cancelScoreUpdate() {
    if (scoreTimer === null) return;
    cancelTimeout(scoreTimer.id);
    scoreTimer = null;
  }

  function controlDrawGuess(input, player) {
    if (player !== 'host') return { accepted: false, reason: '只有主播可以控制回合。' };
    const action = String(input.value?.action || input.action || '').trim();
    if (action === 'choose-word') {
      const choice = input.value || input;
      if (choice.sessionId !== session.sessionId || choice.round !== session.state.round) {
        return { accepted: false, reason: '选词所属回合已经结束，请重新选择。' };
      }
      const result = drawGuess.chooseDrawGuessWord(session.state, choice.word, monotonicNow());
      if (!result.accepted) return result;
      session.state = result.state;
      scheduleDrawGuessTimer();
      publish(true);
      return { accepted: true, session: publicSessionRaw() };
    }
    if (action === 'finish-round') {
      if (session.state.phase !== 'drawing') return { accepted: false, reason: '当前回合已经结束。' };
      finishDrawGuessRound({ reveal: false, deferFinal: true });
      return {
        accepted: true,
        state: session.state,
        session: publicSessionRaw(),
      };
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
      return {
        accepted: true,
        state: session.state,
        session: publicSessionRaw(),
      };
    }
    if (action === 'next-round') {
      if (session.state.phase !== 'round-result' || !session.state.answerRevealed)
        return { accepted: false, reason: '请先公布答案。' };
      session.state = drawGuess.startNextRound(session.state);
      scheduleDrawGuessTimer();
      publish(true);
      return {
        accepted: true,
        state: session.state,
        session: publicSessionRaw(),
      };
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
    cancelScoreUpdate();
  }

  function pruneViewers() {
    const nowMs = monotonicNow();
    for (const [key, viewer] of viewers) {
      if (viewer.expiresAtMs >= nowMs) break;
      viewers.delete(key);
    }
  }

  return {
    start,
    isActive,
    refreshAvailability: publish,
    stop,
    restart,
    move,
    draw,
    handleDanmaku,
    updateDanmakuAvatar,
    getSession,
    getDisplaySession,
    getMenuState,
    getHostState,
    listDrawGuessCategories,
    listViewers,
    dispose,
  };
}

function normalizeGameDanmaku(danmaku = {}) {
  const requestedGuardLevel = Number(danmaku.requesterGuardLevel);
  const requestedMedalLevel = Math.trunc(Number(danmaku.requesterMedalLevel));
  return {
    uid: String(danmaku.uid || '')
      .trim()
      .slice(0, 40),
    name:
      String(danmaku.userName || '观众')
        .trim()
        .slice(0, 80) || '观众',
    message: String(danmaku.message || '')
      .trim()
      .slice(0, 300),
    avatarUrl: String(danmaku.avatarUrl || danmaku.face || '')
      .trim()
      .slice(0, 500),
    guardLevel: [1, 2, 3].includes(requestedGuardLevel) ? requestedGuardLevel : 0,
    medalName: String(danmaku.requesterMedalName || '')
      .trim()
      .slice(0, 40),
    medalLevel: Number.isFinite(requestedMedalLevel) ? Math.max(0, Math.min(999, requestedMedalLevel)) : 0,
    timestamp: Number.isFinite(Number(danmaku.messageTimestamp)) ? Number(danmaku.messageTimestamp) : Date.now(),
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
  const match = String(message || '')
    .toUpperCase()
    .match(/\b([A-O](?:1[0-5]|[1-9]))\b/);
  return match ? match[1] : null;
}

module.exports = { createGameSessionService, extractNumber, extractCoordinate };
