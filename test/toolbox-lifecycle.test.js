'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const root = path.resolve(__dirname, '..');
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup(loaders, onError = assert.fail) {
  const { createToolboxLifecycle } = await loadModuleExports(path.join(root, 'public/js/admin/toolbox-lifecycle.js'), {
    queueMicrotask,
  });
  return createToolboxLifecycle({ loaders, onError });
}

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

test('optional editors have no eager entry imports or initialization calls', () => {
  const entry = fs.readFileSync(path.join(root, 'public/js/admin/index.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/js/admin/app.js'), 'utf8');
  for (const file of ['clock-card', 'start-animation', 'games', 'overtime']) {
    assert.doesNotMatch(entry + app, new RegExp(`(?:from\\s+|import\\s+)['"]\\./${file}\\.js['"]`));
    assert.ok(app.includes(`import('./${file}.js')`));
  }
  assert.match(app, /onFeatureSelected: toolbox\.selectFeature/);
  assert.match(app, /toolbox\.setPage\(nextPageId\)/);
});
