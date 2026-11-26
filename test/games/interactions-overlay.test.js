'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { FakeNode, createFakeDocument } = require('../helpers/fake-dom');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createInteractionSessionService } = require('../../src/games/interaction-session-service');
const { projectOverlayResponse, projectWebSocketPayload } = require('../../src/server/overlay-projection');
const { createInteractionClient } = require('../../public/js/shared/interaction-client.js');
const { createPollCountdown, interactionStatus } = require('../../public/js/shared/interaction-view.js');

test('a poll keeps the same voting and display deadline across clock changes and delayed receipts', async (t) => {
  let serverMs = 8000;
  let rendererMs = 400;
  let wallMs = 1_800_000_000_000;
  t.mock.method(performance, 'now', () => rendererMs);
  t.mock.method(Date, 'now', () => wallMs);
  const source = { ready: true, roomId: '1', accountUid: '2', ownerUid: '3', connectionKey: '4' };
  let receiveVote;
  const service = createInteractionSessionService({
    now: () => serverMs, wallNow: Date.now, getSourceState: () => source,
    subscribe(fn) { receiveVote = fn; return () => {}; }, setTimeout: () => 1, clearTimeout() {},
  });
  t.after(() => service.dispose());
  const countdown = createPollCountdown();
  const read = Promise.withResolvers();
  let session;
  const client = createInteractionClient({ countdown, fetchState: () => read.promise, onState: state => { session = state.session; } });
  const status = () => interactionStatus(session, countdown.remainingMs());
  const load = client.load();
  const empty = service.getState();
  const start = service.start({ kind: 'poll', options: ['唱歌'], durationSeconds: 60 });
  client.receive(projectWebSocketPayload({ type: 'overlay', scope: 'interactions' }, { type: 'interaction:update', state: start }).state);
  serverMs += 10_000;
  rendererMs += 10_000;
  wallMs += 70_000;
  read.resolve(empty);
  await load;
  assert.match(status(), /00:50$/);
  receiveVote({ ...source, source: 'danmaku', receivedAt: serverMs, uid: '7', message: '唱歌' });
  wallMs -= 120_000;
  const fresh = projectOverlayResponse('interactions', '/api/interactions/session', service.getState());
  assert.equal(fresh.session.remainingMs, 50_000);
  client.receive(fresh);
  client.receive(start);
  assert.match(status(), /00:50$/);
  serverMs += 50_000;
  rendererMs += 50_000;
  assert.match(status(), /00:00$/);
  receiveVote({ ...source, source: 'danmaku', receivedAt: serverMs, uid: '8', message: '唱歌' });
  client.receive(service.getState());
  assert.equal(session.phase, 'finished');
  assert.equal(session.participants, 1);
});

test('the first poll snapshot accounts for time in transit, even if the local clock changes during the read', async (t) => {
  let elapsed = 0;
  let adjustment = 0;
  t.mock.method(performance, 'now', () => elapsed);
  t.mock.method(Date, 'now', () => 1_800_000_000_000 + elapsed + adjustment);
  const service = createInteractionSessionService({
    now: () => elapsed, wallNow: Date.now, getSourceState: () => ({ ready: true }),
    subscribe: () => () => {}, setTimeout: () => 1, clearTimeout() {},
  });
  t.after(() => service.dispose());
  service.start({ kind: 'poll', options: ['唱歌'], durationSeconds: 60 });
  for (const jump of [0, 60_000, -60_000]) {
    elapsed = 0;
    adjustment = 0;
    const read = Promise.withResolvers();
    const countdown = createPollCountdown();
    const client = createInteractionClient({ countdown, fetchState: () => read.promise, onState() {} });
    const loading = client.load();
    const snapshot = projectOverlayResponse('interactions', '/api/interactions/session', service.getState());
    elapsed = 10_000;
    adjustment = jump;
    read.resolve(snapshot);
    await loading;
    assert.equal(countdown.remainingMs(), service.getState().session.remainingMs);
  }
});

test('a new poll push crossing a forward clock step retains its voting time', async t => {
  let elapsed = 0;
  let wall = 1_800_000_000_000;
  t.mock.method(performance, 'now', () => elapsed);
  t.mock.method(Date, 'now', () => wall);
  const countdown = createPollCountdown();
  const state = { runtimeId: 'local', revision: 0, session: null };
  const client = createInteractionClient({ countdown, fetchState: () => state, onState() {} });
  await client.load();
  const first = { kind: 'poll', sessionId: 'new', remainingMs: 60_000, serverNowMs: wall };
  elapsed += 120;
  wall += 120_120;
  client.receive({ ...state, revision: 1, session: first });
  assert.equal(countdown.remainingMs(), 59_880);
  elapsed += 1000;
  wall += 1000;
  client.receive({ ...state, revision: 2, session: { ...first, serverNowMs: wall, remainingMs: 58_880 } });
  assert.equal(countdown.remainingMs(), 58_880);
});

test('live poll updates preserve row nodes and scroll position while showing zero and small percentages', async () => {
  const { renderPollRows } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/shared/interaction-view.js'),
    { document: createFakeDocument() },
  );
  const container = new FakeNode('div');
  const session = {
    sessionId: 'one',
    phase: 'collecting',
    options: [
      { text: '<img>', votes: 0, percentage: 0 },
      { text: '汉字', votes: 1, percentage: 0.5 },
    ],
  };
  renderPollRows(container, session);
  const row = container.children[0];
  container.scrollTop = 320;
  session.options[0].votes = 199;
  session.options[0].percentage = 99.5;
  renderPollRows(container, session);
  assert.equal(container.children[0], row);
  assert.equal(container.scrollTop, 320);
  assert.equal(row.children[0].children[1].textContent, '<img>');
  assert.equal(row.children[0].children[0].style.width, '99.5%');
  assert.equal(container.children[1].children[0].children[2].children[0].textContent, '1 票');
  assert.equal(container.children[1].children[0].children[2].children[1].textContent, '0.5%');
  session.phase = 'finished';
  renderPollRows(container, session);
  assert.match(row.children[0].children[1].textContent, /最高票/);
  session.sessionId = 'two';
  session.options.forEach((option) => {
    option.votes = option.percentage = 0;
  });
  renderPollRows(container, session);
  assert.notEqual(container.children[0], row);
  assert.equal(container.scrollTop, 0);
  assert.doesNotMatch(container.children[0].children[0].children[1].textContent, /最高/);
});
