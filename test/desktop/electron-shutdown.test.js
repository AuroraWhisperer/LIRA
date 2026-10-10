'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createShutdownHarness } = require('../helpers/electron-shutdown');
const { acknowledgePlaybackFlush } = require('../../src/electron/playback-flush');
const { createHarness: createLicenseHarness } = require('../helpers/license-manager-harness');
const { createSceneCloudController } = require('../../src/electron/scene-cloud-controller');

test('every main process dependency is modelled for shutdown review', () => {
  const h = createShutdownHarness();
  assert.deepEqual(h.unmodelledDependencies, [], 'add each new main.js dependency to helpers/electron-shutdown.js');
});

test('quit drains a scene waiting for scheduled renewal and reaches the actual playback flush', async (t) => {
  const scheduled = new Set();
  const license = createLicenseHarness({
    identity: { deviceId: 'd', licenseId: 'l', streamerId: 7 },
    timers: {
      setTimeout(callback, delay) {
        const timer = { callback, delay, unref() {} };
        scheduled.add(timer);
        return timer;
      },
      clearTimeout: (timer) => scheduled.delete(timer),
    },
  });
  const renewal = Promise.withResolvers();
  let scene;
  t.after(() => {
    acknowledgePlaybackFlush();
    scene?.dispose();
    license.manager.dispose();
    renewal.resolve({});
  });
  await license.manager.bootstrap();
  let renewalCompleted = false;
  license.remote.verify = () => renewal.promise.finally(() => { renewalCompleted = true; });
  const renewalTimer = [...scheduled].find(({ delay }) => delay > 150_000);
  assert.ok(renewalTimer, 'bootstrap schedules early renewal');
  scheduled.delete(renewalTimer);
  renewalTimer.callback();
  let settingsCalls = 0;
  let sceneSignal;
  license.remote.getOverlaySettings = async () => { settingsCalls++; };
  const getSettings = license.manager.getOverlaySettings;
  license.manager.getOverlaySettings = (options) => {
    sceneSignal = options.signal;
    return getSettings(options);
  };
  scene = createSceneCloudController({
    licenseManager: license.manager,
    publish() {},
    subscribeDemand(listener) { listener(true); return () => {}; },
    fetchImpl: () => assert.fail('a cancelled scene must not open its event stream'),
  });
  const h = createShutdownHarness({ sceneController: scene, realPlaybackFlush: true });
  await h.start();
  assert.ok(sceneSignal);
  assert.equal(settingsCalls, 0, 'scene settings are still waiting for authorization');

  h.quit();
  h.remoteIdle.resolve();
  h.cloudIdle.resolve();
  h.backendStop.resolve();
  await h.settle();

  assert.equal(sceneSignal.aborted, true);
  assert.equal(renewalCompleted, false);
  assert.equal(h.count('runtime:stop'), 1);
  assert.equal(h.count('ipc:app:prepare-shutdown'), 1);
  assert.equal(h.count('license:dispose'), 0);
  assert.equal(h.count('app:exit'), 0);
  assert.equal(acknowledgePlaybackFlush(), true);
  await h.state.lifecycle.shutdownPromise;
  assertFinalized(h, false);
  assert.equal(settingsCalls, 0);
  assert.equal(h.logs.find((log) => log.scope === 'playback-flush').value.status, 'ack');
  assert.equal(h.logs.some((log) => log.value?.event === 'QUIT_TIMEOUT'), false);
});

for (const entry of ['ipc', 'native']) {
  test(`${entry} window close keeps the renderer alive until its actual playback flush is acknowledged`, async (t) => {
    const h = createShutdownHarness({ realPlaybackFlush: true });
    t.after(acknowledgePlaybackFlush);
    await h.start();
    const window = h.state.window.main;
    if (entry === 'ipc') h.handlers.get('desktop:close-window')();
    else window.close();
    assert.equal(window.isDestroyed(), false);
    assert.equal(h.state.window.main, window);
    window.close();
    assert.equal(h.count('cloud:dispose'), 1);
    h.cloudIdle.resolve();
    h.remoteIdle.resolve();
    h.backendStop.resolve();
    await h.settle();
    assert.equal(h.count('ipc:app:prepare-shutdown'), 1);
    assert.equal(h.count('app:exit'), 0);
    assert.equal(window.isDestroyed(), false);
    assert.equal(acknowledgePlaybackFlush(), true);
    await h.state.lifecycle.shutdownPromise;
    assert.equal(window.isDestroyed(), true);
    assert.equal(h.count('app:exit'), 1);
    assert.equal(h.logs.find((log) => log.scope === 'playback-flush').value.status, 'ack');
  });
}

test('repeated native close retains the existing shutdown deadline when the renderer never acknowledges', async (t) => {
  const h = createShutdownHarness({ realPlaybackFlush: true });
  t.after(acknowledgePlaybackFlush);
  await h.start();
  const window = h.state.window.main;
  window.close();
  h.cloudIdle.resolve();
  h.remoteIdle.resolve();
  await h.settle();
  window.close();
  assert.deepEqual(h.clock.delays, [5000]);
  h.clock.advance(5000);
  await h.state.lifecycle.shutdownPromise;
  assert.equal(window.isDestroyed(), true);
  assert.equal(h.count('app:exit'), 1);
  assert.ok(h.logs.some((log) => log.value?.event === 'QUIT_TIMEOUT'));
  acknowledgePlaybackFlush();
  h.backendStop.resolve();
  await h.settle();
  assert.equal(h.count('app:exit'), 1);
});

test('an interrupted installation cannot start an empty backend', async () => {
  const recoveryDataDir = 'D:\\Apps\\LIRA.lira-data-backup';
  const h = createShutdownHarness({ recoveryDataDir });
  await h.start({ expectStartupError: true });
  assert.equal(h.count('runtime:start'), 0);
  assert.equal(h.count('app:path:userData'), 0);
  assert.equal(h.count('app:path:sessionData'), 0);
  assert.equal(h.count('app:exit'), 1);
  assert.equal(h.startupErrors.length, 1);
  assert.ok(h.startupErrors[0].includes(recoveryDataDir));
  assert.ok(h.startupErrors[0].includes('重新运行安装包'));
});

function assertFinalized(harness, restart) {
  assert.equal(harness.count('license:dispose'), 1);
  assert.equal(harness.count('app:release-lock'), 1);
  assert.equal(harness.count('app:relaunch'), restart ? 1 : 0);
  assert.equal(harness.count('app:exit'), 1);
  assert.equal(harness.count('app:default-quit'), 0);
  assert.equal(harness.clock.pending, 0);
}

// Each owner must be released during quit and drained before the backend and database stop.
for (const [idleOption, disposedOnce, stoppedAtLeastOnce] of [
  ['appearanceIdle', [], []],
  ['integrityIdle', [], ['integrity:stop']],
  ['authIdle', ['auth:dispose'], []],
  ['lotteryIdle', ['lottery:dispose', 'lottery:remove-ipc'], []],
  ['fanIdle', ['fan:dispose', 'fan:remove-ipc'], []],
]) {
  test(`shutdown drains ${idleOption} before stopping the runtime`, async () => {
    const idle = Promise.withResolvers();
    const h = createShutdownHarness({ [idleOption]: idle });
    await h.start();
    h.quit();
    h.remoteIdle.resolve();
    h.cloudIdle.resolve();
    await h.settle();
    for (const call of disposedOnce) assert.equal(h.count(call), 1, call);
    for (const call of stoppedAtLeastOnce) assert.ok(h.count(call) > 0, call);
    assert.equal(h.count('runtime:stop'), 0);
    idle.resolve();
    await h.settle();
    assert.equal(h.count('runtime:stop'), 1);
    h.backendStop.resolve();
    await h.state.lifecycle.shutdownPromise;
    assertFinalized(h, false);
  });
}

test('every quit event waits for one sync drain, playback flush and runtime stop', async () => {
  const playbackFlush = Promise.withResolvers();
  const h = createShutdownHarness({ playbackFlush });
  await h.start();
  assert.equal(h.powerMonitor.listenerCount('resume'), 1);

  assert.equal(h.quit().defaultPrevented, true);
  const shutdown = h.state.lifecycle.shutdownPromise;
  assert.equal(h.quit().defaultPrevented, true);
  assert.ok(shutdown && typeof shutdown.then === 'function');
  assert.equal(h.state.lifecycle.shutdownPromise, shutdown);
  assert.equal(h.powerMonitor.listenerCount('resume'), 0);
  assert.equal(h.count('remote:dispose'), 1);
  assert.equal(h.count('cloud:dispose'), 1);
  assert.equal(h.count('gift-interaction:remove-ipc'), 1);
  assert.equal(h.count('daily-bot:remove-ipc'), 1);
  assert.equal(h.count('daily-bot:dispose'), 1);
  assert.equal(h.count('planner-reminder:remove-ipc'), 1);
  assert.equal(h.count('planner-reminder:dispose'), 1);
  assert.ok(h.calls.indexOf('gift-interaction:remove-ipc') < h.calls.indexOf('cloud:dispose'));
  assert.equal(h.count('runtime:stop'), 0);
  assert.equal(h.count('app:exit'), 0);
  assert.deepEqual(h.clock.delays, [5000]);

  h.remoteIdle.resolve();
  await h.settle();
  assert.equal(h.count('runtime:stop'), 0);
  assert.equal(h.runtimeOpen, true);
  h.cloudIdle.resolve();
  await h.settle();
  assert.equal(h.count('runtime:stop'), 1);
  assert.equal(h.count('playback:flush'), 1);
  assert.equal(h.count('playback:flushed'), 0);
  assert.equal(h.count('app:exit'), 0);

  playbackFlush.resolve();
  await h.settle();
  assert.equal(h.count('playback:flushed'), 1);
  assert.equal(h.count('runtime:stopped'), 0);
  assert.equal(h.count('app:exit'), 0);
  h.backendStop.resolve();
  await h.settle();
  await shutdown;
  assertFinalized(h, false);
  assert.equal(h.runtimeOpen, false);
  assert.equal(h.quit().defaultPrevented, true);
  assert.equal(h.count('app:exit'), 1);
});

test('registered restart IPC drains both controllers before stopping and relaunching', async () => {
  const h = createShutdownHarness();
  await h.start();
  const restart = h.restart();
  assert.equal(h.count('runtime:stop'), 0);
  assert.equal(h.count('remote:dispose'), 1);
  assert.equal(h.count('cloud:dispose'), 1);
  assert.equal(h.powerMonitor.listenerCount('resume'), 0);
  h.cloudIdle.resolve();
  await h.settle();
  assert.equal(h.count('runtime:stop'), 0);
  h.remoteIdle.resolve();
  await h.settle();
  assert.equal(h.count('runtime:stop'), 1);
  assert.equal(h.count('app:relaunch'), 0);
  assert.equal(h.count('app:exit'), 0);
  h.backendStop.resolve();
  assert.equal(await restart, undefined);
  assertFinalized(h, true);
  assert.ok(h.calls.indexOf('runtime:stopped') < h.calls.indexOf('app:relaunch'));
  assert.ok(h.calls.indexOf('app:relaunch') < h.calls.indexOf('app:exit'));
});

for (const firstIntent of ['quit', 'restart']) {
  test(`${firstIntent} owns the final action across repeated restart and quit requests`, async () => {
    const h = createShutdownHarness();
    await h.start();
    const first = firstIntent === 'restart' ? h.restart() : h.quit();
    const shutdown = h.state.lifecycle.shutdownPromise;
    const restarts = [h.restart(), h.restart()];
    assert.equal(h.quit().defaultPrevented, true);
    assert.equal(h.state.lifecycle.shutdownPromise, shutdown);
    assert.equal(h.count('remote:dispose'), 1);
    assert.equal(h.count('cloud:dispose'), 1);
    assert.equal(h.count('runtime:stop'), 0);
    h.remoteIdle.resolve();
    h.cloudIdle.resolve();
    h.backendStop.resolve();
    await h.settle();
    assert.deepEqual(await Promise.all(restarts), [undefined, undefined]);
    if (firstIntent === 'restart') assert.equal(await first, undefined);
    assert.equal(h.count('runtime:stop'), 1);
    assertFinalized(h, firstIntent === 'restart');
  });

  for (const failedStage of ['sync', 'runtime']) {
    test(`${firstIntent} logs ${failedStage} failure and finalizes once`, async () => {
      const h = createShutdownHarness();
      await h.start();
      const result = firstIntent === 'restart' ? h.restart() : h.quit();
      const error = new Error(`${failedStage} failed`);
      if (failedStage === 'sync') {
        h.remoteIdle.reject(error);
      } else {
        h.remoteIdle.resolve();
        h.cloudIdle.resolve();
        await h.settle();
        h.backendStop.reject(error);
      }
      await h.settle();
      assertFinalized(h, firstIntent === 'restart');
      assert.equal(h.logs.filter((log) => log.scope === 'shutdown-error' && log.value === error).length, 1);
      assert.equal(h.count('runtime:stop'), failedStage === 'sync' ? 0 : 1);
      if (firstIntent === 'restart') assert.equal(await result, undefined);
      h.cloudIdle.resolve();
      await h.settle();
      assertFinalized(h, firstIntent === 'restart');
    });
  }

  for (const timedOutStage of ['sync', 'runtime']) {
    for (const lateResult of ['resolve', 'reject']) {
      test(`${firstIntent} has one deadline during ${timedOutStage} and ignores late ${lateResult}`, async () => {
        const h = createShutdownHarness();
        await h.start();
        const result = firstIntent === 'restart' ? h.restart() : h.quit();
        if (timedOutStage === 'runtime') {
          h.remoteIdle.resolve();
          h.cloudIdle.resolve();
          await h.settle();
          assert.equal(h.count('runtime:stop'), 1);
        }
        h.clock.advance(4000);
        const duplicate = h.restart();
        assert.equal(h.quit().defaultPrevented, true);
        assert.equal(h.count('app:exit'), 0);
        assert.deepEqual(h.clock.delays, [5000]);
        h.clock.advance(999);
        assert.equal(h.count('app:exit'), 0);
        h.clock.advance(1);
        assertFinalized(h, firstIntent === 'restart');
        assert.equal(await duplicate, undefined);
        if (firstIntent === 'restart') assert.equal(await result, undefined);

        const deferred = timedOutStage === 'sync' ? h.remoteIdle : h.backendStop;
        deferred[lateResult](lateResult === 'reject' ? new Error('late failure') : undefined);
        h.cloudIdle.resolve();
        await h.settle();
        assertFinalized(h, firstIntent === 'restart');
        assert.equal(h.count('runtime:stop'), timedOutStage === 'sync' ? 0 : 1);
        assert.deepEqual(
          h.logs
            .filter((log) => ['QUIT_DONE', 'QUIT_TIMEOUT'].includes(log.value?.event))
            .map((log) => log.value.event),
          ['QUIT_TIMEOUT'],
        );
      });
    }
  }
}

test('synchronous sync disposal failure still finalizes through the bounded owner', async () => {
  const h = createShutdownHarness({
    syncDisposeError: new Error('dispose failed'),
  });
  await h.start();
  const event = h.quit();
  await h.settle();
  assert.equal(event.defaultPrevented, true);
  assertFinalized(h, false);
  assert.equal(h.count('runtime:stop'), 0);
  assert.equal(h.logs.filter((log) => log.scope === 'shutdown-error').length, 1);
});

test('license disposal failure is logged without preventing restart termination', async () => {
  const h = createShutdownHarness({
    licenseDisposeError: new Error('license dispose failed'),
  });
  await h.start();
  const result = h.restart();
  h.remoteIdle.resolve();
  h.cloudIdle.resolve();
  h.backendStop.resolve();
  await h.settle();
  assertFinalized(h, true);
  assert.equal(await result, undefined);
  assert.equal(h.logs.filter((log) => log.scope === 'shutdown-error').length, 1);
});

test('request-auth disposal failure cannot defeat the forced shutdown deadline', async () => {
  const h = createShutdownHarness();
  await h.start();
  h.state.lifecycle.requestAuth = { dispose() { throw new Error('request auth disposal failed'); } };
  h.quit();
  assert.doesNotThrow(() => h.clock.advance(5000));
  assertFinalized(h, false);
  assert.equal(h.logs.filter((log) => log.scope === 'shutdown-error').length, 1);
});

test('quit before runtime initialization preserves Electron default exit', () => {
  const h = createShutdownHarness();
  assert.equal(h.quit().defaultPrevented, false);
  assert.equal(h.count('app:default-quit'), 1);
  assert.equal(h.clock.pending, 0);
});

for (const restore of ['musicRestore', 'bilibiliRestore']) {
  test(`restart during ${restore} exits without creating a runtime later`, async () => {
    const pendingRestore = Promise.withResolvers();
    const h = createShutdownHarness({ [restore]: pendingRestore });
    await h.start();
    assert.equal(h.state.lifecycle.runtime, null);
    assert.deepEqual(await h.restart(), { ok: false, error: 'IPC_SOURCE_INVALID' });
    assert.equal(await h.requestRestart(), undefined);
    assert.equal(h.count('app:relaunch'), 1);
    assert.equal(h.count('app:exit'), 1);
    pendingRestore.resolve();
    await h.settle();
    assert.equal(h.count('runtime:start'), 0);
    assert.equal(h.count('license:create'), 0);
    assert.deepEqual(h.startupErrors, []);
  });
}

test('quit while runtime starts waits for stop without creating license or controllers', async () => {
  const runtimeStart = Promise.withResolvers();
  const h = createShutdownHarness({ runtimeStart });
  await h.start();
  assert.equal(h.count('license:create'), 0);
  assert.equal(h.quit().defaultPrevented, true);
  await h.settle();
  assert.equal(h.count('runtime:stop'), 1);
  assert.equal(h.count('app:exit'), 0);
  runtimeStart.resolve();
  h.backendStop.resolve();
  await h.settle();
  assert.equal(h.count('license:create'), 0);
  assert.equal(h.count('cloud:create'), 0);
  assert.equal(h.count('remote:create'), 0);
  assert.equal(h.count('scene:create'), 0);
  assert.equal(h.count('app:exit'), 1);
  assert.deepEqual(h.startupErrors, []);
});

test('quit during license bootstrap cannot create sync controllers after termination', async () => {
  const licenseBootstrap = Promise.withResolvers();
  const h = createShutdownHarness({ licenseBootstrap });
  await h.start();
  assert.equal(h.count('license:create'), 1);
  assert.equal(h.count('cloud:create'), 0);
  assert.equal(h.quit().defaultPrevented, true);
  h.backendStop.resolve();
  await h.settle();
  assertFinalized(h, false);
  licenseBootstrap.resolve();
  await h.settle();
  assert.equal(h.count('cloud:create'), 0);
  assert.equal(h.count('remote:create'), 0);
  assert.equal(h.count('scene:create'), 0);
  assert.deepEqual(h.startupErrors, []);
});

test('update install IPC keeps delegating to the existing updater', async () => {
  const h = createShutdownHarness();
  await h.start();
  h.handlers.get('desktop:install-update')();
  assert.equal(h.count('update:install'), 1);
  assert.equal(h.count('remote:dispose'), 0);
  assert.equal(h.count('runtime:stop'), 0);
  assert.equal(h.count('app:relaunch'), 0);
});

for (const intent of ['quit', 'restart']) {
  test(`${intent} drains scene cloud delivery before closing the runtime`, async () => {
    const sceneIdle = Promise.withResolvers();
    const sceneOwner = { scope: '["https://scene.test","streamer-1"]', epoch: 1 };
    const h = createShutdownHarness({ sceneIdle, sceneOwner });
    await h.start();
    assert.equal(h.count('scene:create'), 1);
    assert.equal(h.count('scene:start'), 1);
    assert.equal(h.runtimeOptions.getSceneOwner(), sceneOwner);
    const update = { ownerScope: sceneOwner.scope, authorizationEpoch: 1, status: 'offline' };
    h.publishSceneCloud(update);
    assert.deepEqual(h.sceneUpdates, [update]);

    if (intent === 'restart') h.restart();
    else h.quit();
    h.quit();
    h.remoteIdle.resolve();
    h.cloudIdle.resolve();
    await h.settle();
    assert.equal(h.count('scene:dispose'), 1);
    assert.equal(h.count('scene:idle'), 1);
    assert.equal(h.count('playback:flush'), 0);
    assert.equal(h.count('runtime:stop'), 0);
    assert.equal(h.runtimeOpen, true);

    sceneIdle.resolve();
    await h.settle();
    assert.equal(h.count('runtime:stop'), 1);
    assert.ok(h.calls.indexOf('scene:dispose') < h.calls.indexOf('scene:idle'));
    assert.ok(h.calls.indexOf('scene:idle') < h.calls.indexOf('runtime:stop'));
    h.backendStop.resolve();
    await h.state.lifecycle.shutdownPromise;
    assertFinalized(h, intent === 'restart');
  });
}
