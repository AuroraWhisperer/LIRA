'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInteractionClient } = require('../public/js/shared/interaction-client.js');

test('HTTP/WS revisions preserve newest result and clear across session changes', async () => {
  const pending = [];
  const states = [];
  const client = createInteractionClient({ onState: (state) => states.push(state), fetchState: () => new Promise((resolve) => pending.push(resolve)) });
  const initial = client.load();
  client.receive({ runtimeId: 'one', revision: 2, session: { sessionId: 'new' } });
  client.receive({ runtimeId: 'one', revision: 1, session: { sessionId: 'old' } });
  pending.shift()({ runtimeId: 'one', revision: 1, session: { sessionId: 'old' } });
  await initial;
  assert.equal(states.at(-1).session.sessionId, 'new');
  client.receive({ runtimeId: 'one', revision: 3, session: null });
  client.receive({ runtimeId: 'one', revision: 2, session: { sessionId: 'new' } });
  assert.equal(states.at(-1).session, null);
  const old = client.load();
  client.reset();
  const fresh = client.load();
  pending.pop()({ runtimeId: 'two', revision: 0, session: null });
  await fresh;
  pending.shift()({ runtimeId: 'one', revision: 99, session: { sessionId: 'old' } });
  await old;
  client.receive({ runtimeId: 'one', revision: 100, session: { sessionId: 'old' } });
  assert.equal(states.at(-1).runtimeId, 'two');
  assert.equal(states.at(-1).session, null);
});
