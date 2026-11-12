'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applySettingsPatch } = require('../../src/server/settings-service');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');

function fixture() {
  const events = [];
  let saved = { ...DEFAULT_SETTINGS };
  const dependencies = {
    settings: {
      defaults: DEFAULT_SETTINGS,
      get: () => saved,
      setMany(values) {
        events.push('save');
        saved = { ...saved, ...values };
        return Object.keys(values);
      },
    },
    weSing: {
      async prepareConfiguration() {
        events.push('prepare');
        return { async apply() { events.push('apply'); } };
      },
    },
    bilibili: { configure() { events.push('configure'); } },
    broadcastSnapshot(reason) { events.push(`broadcast:${reason}`); },
    cloudSync: { request(scope) { events.push(`cloud:${scope}`); } },
  };
  return { dependencies, events };
}

test('settings consumers observe committed values only after prepared capture is applied', async () => {
  const { dependencies, events } = fixture();
  let finishApply;
  const applied = new Promise(resolve => { finishApply = resolve; });
  dependencies.weSing.prepareConfiguration = async () => {
    events.push('prepare');
    return { async apply() {
      assert.equal(dependencies.settings.get().paused, 'true');
      events.push('apply');
      await applied;
    } };
  };
  const pending = applySettingsPatch(dependencies, { paused: true, weSingLyricOffsetMs: 200 });
  await Promise.resolve();
  assert.deepEqual(events, ['prepare', 'save', 'apply']);
  finishApply();
  await pending;
  assert.deepEqual(events, ['prepare', 'save', 'apply', 'configure', 'broadcast:settings', 'cloud:settings']);
});

test('preparation errors are validation results and do not write settings', async () => {
  const { dependencies, events } = fixture();
  dependencies.weSing.prepareConfiguration = async () => { throw new Error('capture preparation failed'); };
  const result = await applySettingsPatch(dependencies, { paused: true, weSingLyricOffsetMs: 200 });
  assert.deepEqual(result, { error: 'capture preparation failed' });
  assert.deepEqual(events, []);
  assert.equal(dependencies.settings.get().paused, 'false');
});

test('persistence errors propagate without applying prepared configuration or notifying consumers', async () => {
  const { dependencies, events } = fixture();
  dependencies.settings.setMany = () => { throw new Error('database write failed'); };
  await assert.rejects(applySettingsPatch(dependencies, { paused: true, weSingLyricOffsetMs: 200 }), /database write failed/);
  assert.deepEqual(events, ['prepare']);
  assert.equal(dependencies.settings.get().paused, 'false');
});

test('post-commit capture failures propagate without pretending to roll back persisted settings', async () => {
  const { dependencies, events } = fixture();
  dependencies.weSing.prepareConfiguration = async () => ({
    async apply() { throw new Error('capture apply failed'); },
  });
  await assert.rejects(applySettingsPatch(dependencies, { paused: true, weSingLyricOffsetMs: 200 }), /capture apply failed/);
  assert.deepEqual(events, ['save']);
  assert.equal(dependencies.settings.get().paused, 'true');
});

test('authorization changes during capture apply preserve the commit without notifying the next account', async () => {
  const { dependencies, events } = fixture();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let authorized = true;
  dependencies.authorize = () => {
    if (!authorized) throw Object.assign(new Error('authorization changed'), { code: 'REQUEST_AUTHORIZATION_CHANGED' });
  };
  dependencies.weSing.prepareConfiguration = async () => ({ async apply() {
    events.push('apply');
    entered.resolve();
    await release.promise;
  } });
  const pending = applySettingsPatch(dependencies, { paused: true, weSingLyricOffsetMs: 200 });
  await entered.promise;
  authorized = false;
  release.resolve();
  await assert.rejects(pending, { code: 'REQUEST_AUTHORIZATION_CHANGED' });
  assert.equal(dependencies.settings.get().paused, 'true');
  assert.deepEqual(events, ['save', 'apply']);
});
