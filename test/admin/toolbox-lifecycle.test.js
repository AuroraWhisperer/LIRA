'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const root = path.resolve(__dirname, '../..');
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup(loaders, onError = assert.fail, ownerPageId, onInitError) {
  const { createToolboxLifecycle } = await loadModuleExports(path.join(root, 'public/js/admin/toolbox-lifecycle.js'), {
    queueMicrotask,
  });
  return createToolboxLifecycle({ loaders, onError, ownerPageId, onInitError });
}

test('live component editors initialize only in their owning main page', async () => {
  let inits = 0;
  const lifecycle = await setup({ clock: async () => () => inits++ }, assert.fail, 'liveComponentsPage');
  lifecycle.selectFeature('clock');
  lifecycle.setPage('otherAssistantPage');
  await settle();
  assert.equal(inits, 0);
  lifecycle.setPage('liveComponentsPage');
  await settle();
  assert.equal(inits, 1);
  lifecycle.setPage('otherAssistantPage');
  lifecycle.setPage('liveComponentsPage');
  await settle();
  assert.equal(inits, 1);
  lifecycle.dispose();
});

test('hidden toolbox does no work and remembered selection initializes once on entry', async () => {
  let loads = 0;
  let inits = 0;
  const lifecycle = await setup({
    clock: async () => {
      loads++;
      return () => inits++;
    },
  });
  lifecycle.setPage('songAssistantPage');
  lifecycle.selectFeature('clock');
  await settle();
  assert.equal(loads, 0);
  lifecycle.setPage('otherAssistantPage');
  lifecycle.selectFeature('clock');
  await settle();
  assert.equal(loads, 1);
  assert.equal(inits, 1);
  lifecycle.setPage('songAssistantPage');
  lifecycle.setPage('otherAssistantPage');
  lifecycle.selectFeature('clock');
  await settle();
  assert.equal(inits, 1);
  lifecycle.dispose();
});

test('programmatic page and feature navigation only loads the final selected editor', async () => {
  const calls = [];
  const lifecycle = await setup({
    clock: async () => {
      calls.push('clock');
      return () => {};
    },
    opening: async () => {
      calls.push('opening');
      return () => calls.push('init opening');
    },
  });
  lifecycle.selectFeature('clock');
  lifecycle.setPage('otherAssistantPage');
  lifecycle.selectFeature('opening');
  await settle();
  assert.deepEqual(calls, ['opening', 'init opening']);
});

test('loading shares one request and defers initialization if the panel is left', async () => {
  let finishLoad;
  let loads = 0;
  let inits = 0;
  const lifecycle = await setup({
    clock: () => {
      loads++;
      return new Promise((resolve) => {
        finishLoad = resolve;
      });
    },
  });
  lifecycle.selectFeature('clock');
  lifecycle.setPage('otherAssistantPage');
  await settle();
  lifecycle.selectFeature('clock');
  await settle();
  lifecycle.setPage('songAssistantPage');
  finishLoad(() => inits++);
  await settle();
  assert.equal(loads, 1);
  assert.equal(inits, 0);
  lifecycle.setPage('otherAssistantPage');
  await settle();
  assert.equal(inits, 1);
});

test('shutdown prevents pending initialization and failed imports can retry on next entry', async () => {
  const errors = [];
  let finishLoad;
  let attempts = 0;
  let inits = 0;
  const lifecycle = await setup(
    {
      clock: () => {
        attempts++;
        if (attempts === 1) return Promise.reject(new Error('load failed'));
        return new Promise((resolve) => {
          finishLoad = resolve;
        });
      },
    },
    (error) => errors.push(error.message),
  );
  lifecycle.selectFeature('clock');
  lifecycle.setPage('otherAssistantPage');
  await settle();
  assert.deepEqual(errors, ['load failed']);
  lifecycle.selectFeature('clock');
  await settle();
  assert.equal(attempts, 2);
  lifecycle.dispose();
  finishLoad(() => inits++);
  lifecycle.setPage('otherAssistantPage');
  await settle();
  assert.equal(inits, 0);
});

test('partial initialization requires page recovery without rerunning the failed initializer or its aliases', async () => {
  const failure = new Error('editor initialization failed');
  const recoveries = [];
  const button = new EventTarget();
  let bindings = 0;
  let clicks = 0;
  let healthyInits = 0;
  const initialize = () => {
    bindings++;
    button.addEventListener('click', () => clicks++);
    throw failure;
  };
  const lifecycle = await setup({
    poll: async () => initialize,
    rating: async () => initialize,
    clock: async () => () => healthyInits++,
  }, assert.fail, undefined, (error) => recoveries.push(error));
  lifecycle.selectFeature('poll');
  lifecycle.setPage('otherAssistantPage');
  await settle();
  assert.deepEqual(recoveries, [failure]);
  lifecycle.setPage('songAssistantPage');
  lifecycle.setPage('otherAssistantPage');
  await settle();
  lifecycle.selectFeature('rating');
  await settle();
  assert.equal(bindings, 1, 'a retry must not add duplicate bindings to partial state');
  button.dispatchEvent(new Event('click'));
  assert.equal(clicks, 1);
  assert.deepEqual(recoveries, [failure, failure, failure]);
  lifecycle.selectFeature('clock');
  await settle();
  assert.equal(healthyInits, 1);
  lifecycle.dispose();
  lifecycle.selectFeature('poll');
  await settle();
  assert.equal(recoveries.length, 3);
});

test('an import failure can retry in place and initialize successfully once', async () => {
  const errors = [];
  let loads = 0;
  let inits = 0;
  const lifecycle = await setup({ clock: async () => {
    if (++loads === 1) throw new Error('download failed');
    return () => inits++;
  } }, (error) => errors.push(error.message), undefined, assert.fail);
  lifecycle.selectFeature('clock');
  lifecycle.setPage('otherAssistantPage');
  await settle();
  assert.deepEqual(errors, ['download failed']);
  lifecycle.selectFeature('clock');
  await settle();
  lifecycle.selectFeature('clock');
  await settle();
  assert.equal(loads, 2);
  assert.equal(inits, 1);
  lifecycle.dispose();
});

test('optional editors have no eager entry imports or initialization calls', () => {
  const entry = fs.readFileSync(path.join(root, 'public/js/admin/index.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/js/admin/app.js'), 'utf8');
  for (const file of ['clock-card', 'start-animation', 'games', 'overtime', 'world-clock/index']) {
    assert.doesNotMatch(entry + app, new RegExp(`(?:from\\s+|import\\s+)['"]\\./${file}\\.js['"]`));
    assert.ok(app.includes(`import('./${file}.js')`));
  }
  assert.match(app, /onFeatureSelected: toolbox\.selectFeature/);
  assert.match(app, /toolbox\.setPage\(nextPageId\)/);
});
