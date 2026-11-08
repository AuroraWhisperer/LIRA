'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createGameSessionService } = require('../../src/games/game-session-service');
const { chooseGameWord } = require('../helpers/draw-guess');
const { projectWebSocketPayload } = require('../../src/server/overlay-projection');

function fixture(t) {
  const events = [];
  const timers = new Set();
  let now = 0;
  const games = createGameSessionService({
    broadcast: (event) => events.push(structuredClone(event)),
    drawGuessWords: [{ word: '苹果', category: '食物' }],
    random: () => 0, monotonicNow: () => now,
    setTimeout(run, delay) { const timer = { run, delay }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
  });
  t.after(() => games.dispose());
  games.start({ game: 'draw-guess', totalRounds: 2 });
  chooseGameWord(games);
  return { games, events, timers, setNow(value) { now = value; },
    flushScores() { for (const timer of timers) if (timer.delay === 40) { timers.delete(timer); timer.run(); } } };
}

test('chat and late avatars never transmit unchanged canvas or repeated chat history', (t) => {
  const { games, events } = fixture(t);
  games.draw({ action: 'append', clientId: 'p', strokeId: 's', color: '#222034', width: 4,
    points: [{ x: 0.1, y: 0.1 }] });
  events.length = 0;
  const revision = games.getSession().eventRevision;
  for (let i = 0; i < 510; i += 1) games.handleDanmaku({ uid: '1', userName: 'A', message: String(i) });
  assert.equal(events.length, 510);
  assert.ok(events.every((event) => event.type === 'game:patch' && event.item && !event.state && !event.session));
  assert.ok(events.every((event, i) => event.eventRevision === revision + i + 1));
  assert.equal(JSON.stringify(events).includes('strokes'), false);
  const snapshot = games.getSession();
  assert.equal(snapshot.danmaku.length, 500);
  assert.equal(snapshot.danmaku[0].message, '10');
  assert.equal(snapshot.state.canvas.strokes.length, 1);
  games.updateDanmakuAvatar({ uid: '1', avatarUrl: 'https://i0.hdslb.com/a.png' });
  assert.deepEqual(events.at(-1).avatar, { uid: '1', avatarUrl: 'https://i0.hdslb.com/a.png' });
  assert.equal(events.at(-1).item, undefined);
});

test('score/phase deltas preserve public answer boundary, while a new round establishes a snapshot', (t) => {
  const { games, events, flushScores } = fixture(t);
  games.handleDanmaku({ uid: '1', message: '苹果' });
  assert.equal(events.at(-1).item.message, '苹果');
  flushScores();
  const scored = events.at(-1);
  assert.equal(scored.type, 'game:patch');
  assert.equal(scored.state.scores[0].score, 10);
  assert.equal(scored.state.canvas, undefined);
  assert.equal(scored.state.revealedAnswer, '');
  const projected = projectWebSocketPayload({ type: 'overlay', scope: 'games' }, {
    ...scored, secret: 'private', state: { ...scored.state, answer: 'private', revealedAnswer: 'private' },
  });
  assert.equal(JSON.stringify(projected).includes('private'), false);
  assert.equal(projectWebSocketPayload({ type: 'overlay', scope: 'queue' }, scored), null);
  games.move({ action: 'finish-round' });
  assert.equal(events.at(-1).state.phase, 'round-result');
  games.move({ action: 'reveal-answer' });
  assert.equal(events.at(-1).state.revealedAnswer, '苹果');
  const oldSession = games.getSession();
  games.move({ action: 'next-round' });
  assert.equal(events.at(-1).type, 'game:update');
  assert.equal(events.at(-1).session.state.round, 2);
  assert.equal(games.draw({ action: 'clear', sessionId: oldSession.sessionId, round: 1 }).accepted, false);
  assert.deepEqual(games.getSession().state.canvas.strokes, []);
});

test('score batches remain ordered with drawings and a snapshot taken before the batch flush', async t => {
  const { games, events, flushScores } = fixture(t);
  const f = await streamFixture();
  const request = f.stream.beginSnapshot();
  events.length = 0;
  games.handleDanmaku({ uid: '1', userName: 'A', message: '苹果' });
  games.draw({ action: 'append', clientId: 'p', strokeId: 's', color: '#222034', width: 4,
    points: [{ x: 0.1, y: 0.1 }] });
  games.handleDanmaku({ uid: '2', userName: 'B', message: '苹果' });
  games.handleDanmaku({ uid: '3', message: 'hello' });
  const snapshot = games.getSession();
  assert.equal(snapshot.state.correct.length, 2, 'HTTP recovery sees accepted scores before the next publication');
  events.forEach(event => f.stream.receive(event));
  flushScores();
  f.stream.receive(events.at(-1));
  assert.equal(events.length, 5, 'chat and drawing are immediate; one additional patch publishes both scores');
  assert.ok(events.every((event, index) => index === 0 || event.eventRevision === events[index - 1].eventRevision + 1));
  assert.equal(f.stream.finishSnapshot(request, snapshot), true);
  assert.equal(f.recovery(), 0);
  assert.equal(f.deltas.length, 1);
  assert.deepEqual(f.deltas[0].value.state.scores.map(item => item.score), [10, 7]);
  assert.equal(f.deltas[0].value.state.canvas, undefined);
});

test('phase transitions flush scores and cancelled score callbacks cannot enter a later round or session', t => {
  const { games, events, timers, setNow } = fixture(t);
  games.handleDanmaku({ uid: '1', message: '苹果' });
  const obsolete = [...timers].find(timer => timer.delay === 40);
  games.move({ action: 'finish-round' });
  assert.equal(events.at(-1).state.scores[0].score, 10);
  assert.equal(timers.has(obsolete), false);
  games.move({ action: 'reveal-answer' });
  games.move({ action: 'next-round' });
  chooseGameWord(games);
  const before = events.length;
  obsolete.run();
  assert.equal(events.length, before);

  games.handleDanmaku({ uid: '1', message: '苹果' });
  setNow(90_000);
  assert.equal(games.getMenuState().state.phase, 'round-result', 'menu reads still materialize an expired round');
  assert.equal(events.at(-1).state.scores[0].score, 20);
  assert.equal(timers.size, 0);
  games.stop();
  assert.equal(games.getMenuState(), null);
  games.start({ game: 'draw-guess' }); chooseGameWord(games);
  games.handleDanmaku({ uid: '2', message: '苹果' });
  const disposed = [...timers].find(timer => timer.delay === 40);
  games.dispose();
  const finalCount = events.length;
  disposed.run();
  assert.equal(events.length, finalCount);
  assert.equal(timers.size, 0);
});

test('scene game merges retain only omitted parts from the same session and round', async () => {
  const { mergeGameSession } = await loadModuleExports(path.join(__dirname, '../../public/js/overlays/games-session.js'));
  const previous = { sessionId: 'a', game: 'draw-guess', state: { round: 1, canvas: { revision: 4 },
    correct: [{ uid: '1' }], scores: [{ uid: '1', score: 10 }] } };
  const next = { sessionId: 'a', game: 'draw-guess', danmaku: [{ message: 'new' }], state: { round: 1, remainingMs: 3000 } };
  const merged = mergeGameSession(previous, next);
  assert.equal(merged.state.canvas, previous.state.canvas);
  assert.equal(merged.state.scores, previous.state.scores);
  assert.equal(merged.state.correct, previous.state.correct);
  assert.equal(merged.danmaku, next.danmaku);
  assert.equal(mergeGameSession(previous, null), null);
  for (const replacement of [{ ...next, sessionId: 'b' }, { ...next, state: { round: 2 } },
    { ...next, game: 'gomoku' }]) assert.equal(mergeGameSession(previous, replacement), replacement);
  const cleared = mergeGameSession(previous, { ...next, state: { round: 1, canvas: { revision: 5, strokes: [] }, correct: [], scores: [] } });
  assert.equal(cleared.state.canvas.revision, 5);
  assert.equal(cleared.state.scores.length, 0);
});

async function streamFixture() {
  const { createGameSessionStream } = await loadModuleExports(path.join(__dirname, '../../public/js/overlays/games-session.js'));
  const snapshots = [];
  const deltas = [];
  let recovery = 0;
  const stream = createGameSessionStream({
    onSnapshot: (value) => snapshots.push(value),
    onDelta: (value, replaying) => deltas.push({ value, replaying }),
    recover() { recovery += 1; stream.beginSnapshot(); },
  });
  return { stream, snapshots, deltas, recovery: () => recovery };
}

test('snapshot recovery replays only newer deltas and discards duplicates', async () => {
  const f = await streamFixture();
  const request = f.stream.beginSnapshot();
  const chat = { type: 'game:patch', sessionId: 'a', eventRevision: 2, item: { message: 'hello' } };
  const draw = { type: 'game:draw', sessionId: 'a', eventRevision: 3, operation: { action: 'clear' } };
  f.stream.receive(chat);
  f.stream.receive(draw);
  assert.equal(f.stream.finishSnapshot(request, { sessionId: 'a', eventRevision: 2 }), true);
  assert.deepEqual(f.deltas, [{ value: draw, replaying: true }]);
  f.stream.receive(draw);
  assert.equal(f.deltas.length, 1);
  assert.equal(f.recovery(), 0);
});

test('new-session broadcasts invalidate stale HTTP snapshots; gaps and bounded-buffer overflow recover', async () => {
  const f = await streamFixture();
  const request = f.stream.beginSnapshot();
  f.stream.receive({ type: 'game:update', session: { sessionId: 'new', eventRevision: 1 } });
  assert.equal(f.stream.finishSnapshot(request, { sessionId: 'old', eventRevision: 100 }), false);
  f.stream.receive({ type: 'game:patch', sessionId: 'new', eventRevision: 3 });
  assert.equal(f.recovery(), 1);
  assert.equal(f.deltas.length, 0);
  const overflowRequest = f.stream.beginSnapshot();
  for (let i = 0; i < 513; i += 1) f.stream.receive({ type: 'game:draw', sessionId: 'new', eventRevision: i + 4 });
  assert.equal(f.stream.finishSnapshot(overflowRequest, { sessionId: 'new', eventRevision: 3 }), false);
  assert.equal(f.recovery(), 2);
});
