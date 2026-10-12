'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('../helpers/cloud-sync-controller-fixture');

const snapshot = (revision = 3) => ({
  settings: { initialized: true, revision, values: { customExactReplyEnabled: true, customExactReplies: [], giftBlindBoxConfig: [] } },
  songs: { initialized: true, revision: 1 },
  bilibili: { initialized: true, revision: 1 },
});

test('cloud exact reply projection refreshes despite pending local settings and clears on stop', async (t) => {
  const projections = [], uploads = [];
  const fixture = createFixture({
    runtime: {
      getPendingCloudSettings: () => ({ mutationId: 'pending', values: { queueLimit: 2, menuCommands: ['旧指令'] } }),
      getCloudSettingsSnapshot: () => ({ queueLimit: 3, menuCommands: ['点歌 歌名', '小游戏'] }),
      applyCloudFixedReplySettingsSnapshot: (settings, revision) => projections.push({ settings, revision }),
    },
    licenseManager: {
      getCloudState: async () => snapshot(),
      updateCloudSettings: async (values) => { uploads.push(values); throw new Error('offline'); },
    },
  });
  t.after(() => fixture.controller.dispose());
  await fixture.controller.start();
  assert.deepEqual(uploads, [{ queueLimit: 2, menuCommands: ['点歌 歌名', '小游戏'] }]);
  assert.deepEqual(projections, [{ settings: snapshot().settings.values, revision: 3 }]);
  fixture.controller.stop();
  assert.equal(projections.at(-1).settings, null);
});

test('late settings reads cannot restore an exact reply projection after stop', async (t) => {
  let resolve, requested;
  const reading = new Promise((done) => { requested = done; });
  const projections = [];
  const fixture = createFixture({
    runtime: { applyCloudFixedReplySettingsSnapshot: (settings) => projections.push(settings) },
    licenseManager: { getCloudState: () => new Promise((done) => { resolve = done; requested(); }) },
  });
  t.after(() => fixture.controller.dispose());
  const pending = fixture.controller.start();
  await reading;
  fixture.controller.stop();
  resolve(snapshot());
  await pending;
  assert.deepEqual(projections, [null]);
});

test('initial local menu is projected after cloud settings apply without repeatedly seeding an older server', async (t) => {
  const events = [];
  let queueLimit = 99, revision = 3;
  const fixture = createFixture({
    runtime: {
      getCloudSettingsSnapshot: () => ({ queueLimit, menuCommands: ['点歌 歌名'] }),
      applyCloudSettingsSnapshot: (settings) => { queueLimit = settings.queueLimit; events.push('apply'); },
    },
    licenseManager: {
      getCloudState: async () => {
        const state = snapshot(revision++);
        state.settings.values.queueLimit = 12;
        return state;
      },
      updateCloudSettings: async (values) => {
        events.push(['upload', values]);
        return { revision: revision++, values: { queueLimit: values.queueLimit } };
      },
    },
  });
  t.after(() => fixture.controller.dispose());
  await fixture.controller.start();
  await fixture.controller.syncNow();
  assert.equal(events[0], 'apply');
  assert.deepEqual(events.filter(Array.isArray), [['upload', { queueLimit: 12, menuCommands: ['点歌 歌名'] }]]);
});
