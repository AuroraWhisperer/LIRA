'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createGameSessionService } = require('../../src/games/game-session-service');
const { projectWebSocketPayload } = require('../../src/server/overlay-projection');

function fixture(t) {
  const events = [];
  const games = createGameSessionService({
    broadcast: (event) => events.push(structuredClone(event)),
    drawGuessWords: [{ word: '苹果', category: '食物' }],
    random: () => 0, monotonicNow: () => 0,
    setTimeout: () => 1, clearTimeout() {},
  });
  t.after(() => games.dispose());
  games.start({ game: 'draw-guess', totalRounds: 2 });
  return { games, events };
}

test('chat and late avatars never transmit unchanged canvas or repeated chat history', (t) => {
  const { games, events } = fixture(t);
  games.draw({ action: 'append', clientId: 'p', strokeId: 's', color: '#222034', width: 4,
    points: [{ x: 0.1, y: 0.1 }] });
  events.length = 0;
  for (let i = 0; i < 510; i += 1) games.handleDanmaku({ uid: '1', userName: 'A', message: String(i) });
  assert.equal(events.length, 510);
  assert.ok(events.every((event) => event.type === 'game:patch' && event.item && !event.state && !event.session));
  assert.ok(events.every((event, i) => event.eventRevision === i + 3));
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
  const { games, events } = fixture(t);
  games.handleDanmaku({ uid: '1', message: '苹果' });
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
