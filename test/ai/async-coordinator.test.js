'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOrderedAsyncCoordinator } = require('../../src/ai/async-coordinator');
const { waitUntil } = require('../helpers/ai-assistant-service-fixture');

test('grouped generation skips busy viewers without losing global delivery order', async t => {
  const jobs = new Map();
  const delivered = [];
  const coordinator = createOrderedAsyncCoordinator({
    getKey: item => item.viewer, getConcurrency: () => 2,
    generate(item) { const gate = Promise.withResolvers(); jobs.set(item.id, gate); return gate.promise; },
    deliver: async item => delivered.push(item.id),
  });
  t.after(async () => { const stopping = coordinator.stop(); for (const gate of jobs.values()) gate.resolve(); await stopping; });
  for (const [id, viewer] of [['A1', 'A'], ['A2', 'A'], ['B1', 'B'], ['B2', 'B']]) coordinator.enqueue({ id, viewer });
  await waitUntil(() => jobs.size === 2);
  assert.deepEqual([...jobs.keys()], ['A1', 'B1']);
  jobs.get('B1').resolve();
  await waitUntil(() => coordinator.getStatus().ready === 1);
  assert.deepEqual(delivered, []);
  jobs.get('A1').resolve();
  await waitUntil(() => jobs.has('A2'));
  assert.equal(jobs.has('B2'), false, 'B remains locked until its earlier result is delivered');
  jobs.get('A2').resolve();
  await waitUntil(() => jobs.has('B2'));
  jobs.get('B2').resolve();
  await waitUntil(() => coordinator.getStatus().queued === 0 && !coordinator.getStatus().delivering);
  assert.deepEqual(delivered, ['A1', 'A2', 'B1', 'B2']);
});

for (const failure of ['generate', 'deliver', 'onError']) {
  test(`a ${failure} failure releases the viewer for the following turn`, async t => {
    t.mock.method(console, 'warn', () => {});
    const sent = [];
    const failed = [];
    const coordinator = createOrderedAsyncCoordinator({
      getKey: item => item.viewer, getConcurrency: () => 2,
      async generate(item) { if (item.id === 1 && failure === 'generate') throw new Error('generation'); return item.id; },
      async deliver(item) { if (item.id === 1 && failure !== 'generate') throw new Error('delivery'); sent.push(item.id); },
      async onError(_error, item) { failed.push(item.id); if (failure === 'onError') throw new Error('logging'); },
    });
    t.after(() => coordinator.stop());
    coordinator.enqueue({ viewer: 'A', id: 1 });
    coordinator.enqueue({ viewer: 'A', id: 2 });
    await waitUntil(() => coordinator.getStatus().queued === 0 && !coordinator.getStatus().delivering);
    assert.deepEqual(failed, [1]);
    assert.deepEqual(sent, [2]);
  });
}
