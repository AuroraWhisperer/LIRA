'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInteractionSessionService } = require('../src/games/interaction-session-service');
const { createGameSessionService } = require('../src/games/game-session-service');
const { createGameRuntime } = require('../src/server/game-runtime');
const {
  inspectInteractionText,
  validateInteractionConfig,
  pollPageDuration,
} = require('../public/js/shared/interaction-rules.js');

function fixture() {
  let time = 1000;
  let listener = null;
  const source = { ready: true, roomId: '100', accountUid: '200', ownerUid: '300', connectionKey: '1' };
  const tasks = new Map();
  const updates = [];
  let games;
  const service = createInteractionSessionService({
    now: () => time,
    wallNow: () => time,
    getSourceState: () => source,
    isGameActive: () => games.isActive(),
    subscribe(fn) {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    setTimeout(fn, delay) {
      const key = {};
      tasks.set(key, { fn, delay });
      return key;
    },
    clearTimeout: (key) => tasks.delete(key),
    broadcast: (event) => updates.push(event),
  });
  games = createGameSessionService({ isInteractionCollecting: () => service.isCollecting() });
  return {
    service,
    source,
    tasks,
    updates,
    games,
    setTime(value) {
      time = value;
    },
    get listener() {
      return listener;
    },
    send(uid, message, extra = {}) {
      listener?.({ ...source, uid, message, source: 'danmaku', receivedAt: time, ...extra });
    },
  };
}
const poll = { kind: 'poll', options: ['唱歌', '聊天'], durationSeconds: 60 };

test('shared Unicode rules preserve visible graphemes and reject invisible input without deletion', () => {
  for (const value of ['e\u0301', '👩‍💻', '❤️', '1️⃣', '🏳️‍🌈']) {
    assert.equal(inspectInteractionText(value.repeat(10)).error, '', value);
    assert.equal(inspectInteractionText(value.repeat(10)).length, 10);
    assert.ok(inspectInteractionText(value.repeat(11)).error);
  }
  for (const value of [
    '\u200b',
    '唱\u200b歌',
    'A\nB',
    '\u0000',
    '\u0301',
    'a\u2060b',
    'a\u200db',
    'a\ufe0f',
    'a\ufeffb',
    '\u202eabc',
  ])
    assert.ok(inspectInteractionText(value).error, value);
  assert.equal(inspectInteractionText(' 唱 歌 ').text, '唱 歌');
  assert.throws(() => validateInteractionConfig({ ...poll, options: ['é', 'e\u0301'] }), /重复/);
  for (const options of [[], ['a'], ['a', ''], ['a', 'a']])
    assert.throws(() => validateInteractionConfig({ ...poll, options }));
  assert.equal(
    validateInteractionConfig({ ...poll, options: Array.from({ length: 20 }, (_, i) => String(i)) }).options.length,
    20,
  );
  assert.throws(
    () => validateInteractionConfig({ ...poll, options: Array.from({ length: 3000 }, (_, i) => String(i)) }),
    /16 KiB|64 KiB/,
  );
  assert.deepEqual(pollPageDuration(11), { pages: 3, seconds: 24 });
  assert.equal(pollPageDuration(2).pages, 1);
});

test('poll accepts the first complete valid choice per reliable viewer and preserves order', () => {
  const f = fixture();
  assert.equal(f.listener, null);
  f.service.start(poll);
  f.send('1', 'hello');
  f.send('1', '唱\u200b歌');
  f.send('1', ' 唱歌 ');
  f.send('1', '聊天');
  f.send('2', '聊天');
  f.send('300', '唱歌');
  f.send('0', '唱歌');
  f.send('masked', '唱歌');
  f.send(9007199254740992, '唱歌');
  const state = f.service.getState();
  assert.deepEqual(
    state.session.options.map((item) => item.votes),
    [1, 1],
  );
  assert.equal(state.session.participants, 2);
  assert.equal(state.session.options[0].percentage, 50);
  assert.ok(!JSON.stringify(state).includes('accountUid'));
  f.service.dispose();
});

test('rating keeps final valid score, rejects stale timestamps/replays and hides all aggregate inputs until finish', () => {
  const f = fixture();
  const id = f.service.start({ kind: 'rating' }).session.sessionId;
  for (const value of ['3', '8', '10']) f.send('1', value);
  f.send('2', '6');
  f.send('2', '文字');
  f.send('3', '9');
  for (const value of ['0', '11', '8.5', '08', '8分', '我打8分']) f.send('2', value);
  assert.equal(f.service.getHostState().participants, 3);
  assert.equal(f.service.getState().session.average, null);
  assert.equal(f.service.getState().session.participants, undefined);
  assert.equal(f.service.getState().session.sum, undefined);
  const final = f.service.finish(id);
  assert.equal(final.session.average.toFixed(2), '8.33');
  assert.equal(f.listener, null);
  f.send('1', '1');
  assert.deepEqual(f.service.finish(id), final);
  assert.equal(f.tasks.size, 0);
  f.service.clear(id);
  const next = f.service.start({ kind: 'rating' });
  f.send('1', '8', { platformTime: 1, eventId: 'a' });
  f.send('1', '9', { platformTime: 1, eventId: 'b' });
  f.send('1', '8', { platformTime: 1, eventId: 'c' });
  f.send('1', '9', { platformTime: 1, eventId: 'b' });
  f.send('1', '3', { platformTime: 0 });
  assert.equal(f.service.finish(next.session.sessionId).session.average, 8);
  assert.throws(() => f.service.clear(id), { statusCode: 409 });
});

for (const hours of [12, 24, 168]) {
  test(`rating survives ${hours} virtual hours and releases its subscription without background tasks`, () => {
    const f = fixture();
    const expectedScores = new Map();
    const id = f.service.start({ kind: 'rating' }).session.sessionId;
    try {
      const originalListener = f.listener;
      for (let minute = 0; minute < hours * 60; minute++) {
        f.setTime(1000 + minute * 60_000);
        if (minute % 60 === 0) {
          f.source.ready = false;
          f.service.sourceChanged();
          f.send('999', '10');
          f.source.ready = true;
          f.source.connectionKey = String(minute + 2);
          f.service.sourceChanged();
          assert.equal(f.listener, originalListener);
        }
        const uid = String(1 + minute % 64);
        const score = 1 + minute % 10;
        f.send(uid, String(score), { platformTime: minute * 60_000, eventId: null });
        expectedScores.set(uid, score);
        assert.equal(f.tasks.size, 0);
      }
      assert.equal(f.service.getHostState().participants, 64);
      assert.equal(f.service.getState().session.average, null);
      const final = f.service.finish(id);
      assert.equal(final.session.average, [...expectedScores.values()].reduce((sum, value) => sum + value, 0) / 64);
      assert.equal(final.session.participants, 64);
      assert.equal(f.listener, null);
      assert.equal(f.tasks.size, 0);
    } finally {
      f.service.dispose();
      f.games.dispose();
    }
  });
}

test('receiving window excludes pre-start frames and deadline equality despite late timer', () => {
  const f = fixture();
  f.service.start({ ...poll, durationSeconds: 1 });
  const oldCallback = f.listener;
  f.send('1', '唱歌', { receivedAt: 999 });
  f.send('1', '唱歌', { source: 'history' });
  f.send('1', '唱歌', { roomId: '101' });
  f.send('1', '唱歌', { connectionKey: 'stale' });
  assert.equal(f.service.getState().session.participants, 0);
  f.setTime(1999);
  f.send('1', '唱歌');
  f.setTime(2000);
  f.send('2', '聊天', { receivedAt: 1999 });
  assert.equal(f.service.getState().session.phase, 'finished');
  assert.equal(f.service.getState().session.participants, 1);
  assert.equal(f.listener, null);
  oldCallback({ ...f.source, uid: '3', message: '聊天', source: 'danmaku', receivedAt: 2000 });
  assert.equal(f.service.getState().session.participants, 1);
  assert.equal(f.tasks.size, 0);
});

test('disconnect retains scores, same-room reconnect continues, identity switch never resumes old session', () => {
  const f = fixture();
  const id = f.service.start({ kind: 'rating' }).session.sessionId;
  f.send('1', '8');
  f.source.ready = false;
  f.service.sourceChanged();
  f.send('2', '10');
  f.source.ready = true;
  f.source.connectionKey = '2';
  f.service.sourceChanged();
  f.send('2', '6');
  f.source.accountUid = '201';
  f.service.sourceChanged();
  assert.equal(f.service.getState().session.phase, 'interrupted');
  assert.equal(f.listener, null);
  f.source.accountUid = '200';
  f.service.sourceChanged();
  assert.equal(f.service.getState().session.phase, 'interrupted');
  assert.equal(f.service.finish(id).session.average, 7);
  assert.equal(f.service.getState().session.receptionInterrupted, true);
});

test('cross-category gate rejects starts/restarts without deleting results and releases after finish', () => {
  const f = fixture();
  f.games.start({ game: 'number-bomb' });
  assert.throws(() => f.service.start(poll), { statusCode: 409 });
  assert.equal(f.listener, null);
  for (let i = 1; i <= 100 && f.games.isActive(); i++) f.games.move({ value: i }, f.games.getSession().state.turn);
  const oldGame = f.games.getSession();
  assert.ok(oldGame.state.winner);
  const id = f.service.start(poll).session.sessionId;
  assert.throws(() => f.games.restart(), { statusCode: 409 });
  assert.deepEqual(f.games.getSession().state, oldGame.state);
  assert.equal(f.games.getSession().restartBlocked, true);
  assert.throws(() => f.service.start(poll), { statusCode: 409 });
  f.service.finish(id);
  f.games.restart();
  assert.equal(f.games.isActive(), true);
  assert.equal(f.service.getState().session.phase, 'finished');
});

test('failed start does not subscribe, clear is versioned, and empty rating settles as null', () => {
  const f = fixture();
  f.source.ready = false;
  assert.throws(() => f.service.start(poll), { statusCode: 409 });
  f.source.ready = true;
  assert.throws(() => f.service.start({ ...poll, options: ['a'] }), { statusCode: 400 });
  assert.equal(f.listener, null);
  const start = f.service.start({ kind: 'rating' });
  const final = f.service.finish(start.session.sessionId);
  assert.equal(final.session.average, null);
  assert.equal(final.session.participants, 0);
  const cleared = f.service.clear(start.session.sessionId);
  assert.equal(cleared.session, null);
  assert.ok(cleared.revision > final.revision);
  assert.equal(cleared.runtimeId, start.runtimeId);
  f.service.dispose();
  assert.throws(() => f.service.start(poll));
});

test('runtime broadcasts restart availability when interaction collection starts and stops', (t) => {
  const updates = [];
  const source = { ready: true, roomId: '100', accountUid: '200', ownerUid: '300', connectionKey: '1' };
  const { games, interactions } = createGameRuntime({
    broadcast: (event) => updates.push(event),
    getSourceState: () => source,
    subscribe: () => () => {},
  });
  t.after(() => {
    interactions.dispose();
    games.dispose();
  });
  games.start({ game: 'number-bomb' });
  assert.throws(() => interactions.start({ kind: 'rating' }), { statusCode: 409 });
  for (let value = 1; value <= 100 && games.isActive(); value++) games.move({ value }, games.getSession().state.turn);
  const id = interactions.start({ kind: 'rating' }).session.sessionId;
  assert.equal(updates.filter((event) => event.type === 'game:update').at(-1).session.restartBlocked, true);
  assert.throws(() => games.restart(), { statusCode: 409 });
  source.accountUid = '201';
  interactions.sourceChanged();
  assert.equal(interactions.getState().session.phase, 'interrupted');
  assert.equal(updates.filter((event) => event.type === 'game:update').at(-1).session.restartBlocked, undefined);
  games.restart();
  assert.equal(games.isActive(), true);
  interactions.finish(id);
  assert.equal(interactions.getState().session.phase, 'finished');
});
