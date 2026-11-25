'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readAuthorizedIdentity } = require('../../src/electron/authorized-identity');

test('authorized identity rejects invalid origins, tenants and lifecycle generations without throwing', () => {
  const state = { authorized: true, streamerId: 'streamer-a', origin: 'https://LIRA.example:443/', generation: 2 };
  const manager = {
    isAuthorized: () => state.authorized,
    getCloudSyncIdentity: () => ({ streamerId: state.streamerId }),
    getRemoteBaseUrl: () => state.origin,
    getAuthorizationGeneration: () => state.generation,
  };
  assert.deepEqual(readAuthorizedIdentity(manager), { origin: 'https://lira.example', streamerId: 'streamer-a', generation: 2 });
  for (const [key, value] of [['authorized', false], ['streamerId', ' '], ['streamerId', -1],
    ['origin', 'not a URL'], ['origin', 'http://lira.example'], ['generation', NaN], ['generation', -1]]) {
    const previous = state[key];
    state[key] = value;
    assert.equal(readAuthorizedIdentity(manager), null);
    state[key] = previous;
  }
  assert.equal(readAuthorizedIdentity({ isAuthorized() { throw new Error('synthetic unavailable manager'); } }), null);
});
