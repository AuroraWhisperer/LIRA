'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createLicenseResumeHandler,
} = require('../src/electron/license/license-resume');

function createFakePowerMonitor() {
  const handlers = new Map();
  return {
    on: (event, handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
    },
    removeListener: (event, handler) => {
      handlers.get(event)?.delete(handler);
    },
    emit: (event) => {
      for (const handler of handlers.get(event) || []) handler();
    },
    listenerCount: (event) => handlers.get(event)?.size || 0,
  };
}

function createHarness({ resumeError = null } = {}) {
  const powerMonitor = createFakePowerMonitor();
  const logs = [];
  let afterResumeCalls = 0;
  const manager = {
    resumeCalls: 0,
    resume: async () => {
      manager.resumeCalls += 1;
      if (resumeError) throw resumeError;
      return true;
    },
  };
  const controller = createLicenseResumeHandler({
    powerMonitor,
    getLicenseManager: () => manager,
    afterResume: async () => {
      afterResumeCalls += 1;
    },
    writeLog: (event, payload) => logs.push({ event, payload }),
  });
  return {
    powerMonitor,
    logs,
    manager,
    controller,
    getAfterResumeCalls: () => afterResumeCalls,
  };
}

test('register attaches a resume listener exactly once', () => {
  const { powerMonitor, controller } = createHarness();
  assert.equal(controller.isRegistered, false);
  controller.register();
  assert.equal(controller.isRegistered, true);
  assert.equal(powerMonitor.listenerCount('resume'), 1);
  controller.register();
  assert.equal(powerMonitor.listenerCount('resume'), 1);
  controller.unregister();
});

test('system resume triggers licenseManager.resume via the latest reference', async () => {
  const { powerMonitor, manager, controller, getAfterResumeCalls } =
    createHarness();
  controller.register();
  powerMonitor.emit('resume');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.resumeCalls, 1);
  assert.equal(getAfterResumeCalls(), 1);
  powerMonitor.emit('resume');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.resumeCalls, 2);
  assert.equal(getAfterResumeCalls(), 2);
  controller.unregister();
});

test('resume rejection is logged instead of crashing', async () => {
  const { powerMonitor, logs, controller, getAfterResumeCalls } = createHarness({
    resumeError: new Error('boom'),
  });
  controller.register();
  powerMonitor.emit('resume');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, 'license-resume-check');
  assert.equal(getAfterResumeCalls(), 0);
  controller.unregister();
});

test('unregister removes the listener and further resumes are ignored', async () => {
  const { powerMonitor, manager, controller } = createHarness();
  controller.register();
  controller.unregister();
  assert.equal(controller.isRegistered, false);
  assert.equal(powerMonitor.listenerCount('resume'), 0);
  powerMonitor.emit('resume');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.resumeCalls, 0);
});

test('resume without a manager is a no-op', async () => {
  const powerMonitor = createFakePowerMonitor();
  const controller = createLicenseResumeHandler({
    powerMonitor,
    getLicenseManager: () => null,
  });
  controller.register();
  powerMonitor.emit('resume');
  await new Promise((resolve) => setImmediate(resolve));
  controller.unregister();
});
