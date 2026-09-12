'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createShutdownHarness } = require('./helpers/electron-shutdown');

function assertFinalized(harness, restart) {
  assert.equal(harness.count('license:dispose'), 1);
  assert.equal(harness.count('app:release-lock'), 1);
  assert.equal(harness.count('app:relaunch'), restart ? 1 : 0);
  assert.equal(harness.count('app:exit'), 1);
  assert.equal(harness.count('app:default-quit'), 0);
  assert.equal(harness.clock.pending, 0);
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
        assert.deepEqual(h.logs.filter((log) => ['QUIT_DONE', 'QUIT_TIMEOUT'].includes(log.value?.event)).map((log) => log.value.event), ['QUIT_TIMEOUT']);
      });
    }
  }
}

test('synchronous sync disposal failure still finalizes through the bounded owner', async () => {
  const h = createShutdownHarness({ syncDisposeError: new Error('dispose failed') });
  await h.start();
  const event = h.quit();
  await h.settle();
  assert.equal(event.defaultPrevented, true);
  assertFinalized(h, false);
  assert.equal(h.count('runtime:stop'), 0);
  assert.equal(h.logs.filter((log) => log.scope === 'shutdown-error').length, 1);
});

test('license disposal failure is logged without preventing restart termination', async () => {
  const h = createShutdownHarness({ licenseDisposeError: new Error('license dispose failed') });
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
    assert.equal(await h.restart(), undefined);
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
