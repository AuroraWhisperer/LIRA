'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');
const { createRemoteGiftController } = require('../src/electron/remote-gift-controller');
const { createFixture } = require('./helpers/remote-gift-controller-fixture');
const { createHarness } = require('./helpers/license-manager-harness');

function rejectingClient(body, status = 429, retryAfter = '60') {
  return createRemoteLicenseClient({
    now: () => Date.parse('2026-09-16T00:00:00Z'),
    fetchImpl: async () =>
      new Response(body, {
        status,
        headers: { 'Retry-After': retryAfter },
      }),
  });
}

test('REST and SSE errors retain Retry-After even for malformed proxy bodies', async () => {
  for (const body of ['{"error":"RATE_LIMITED"}', 'null', '[]', 'proxy unavailable']) {
    for (const status of [429, 503]) {
      const client = rejectingClient(body, status);
      for (const invoke of [
        () => client.getGiftEvents(null, 1, 'token'),
        () => client.watchGiftEvents('token'),
        () => client.watchCloudStateChanges('token'),
      ]) {
        await assert.rejects(invoke(), (error) => {
          assert.equal(error.status, status);
          assert.equal(error.retryable, true);
          assert.equal(error.retryAfterMs, 60_000);
          return true;
        });
      }
    }
  }
});

test('Retry-After accepts dates and zero, rejecting malformed or unsafe delay values', async () => {
  for (const [header, expected] of [
    ['Wed, 16 Sep 2026 00:02:00 GMT', 120_000],
    ['Wed, 16 Sep 2026 00:00:00 GMT', 0],
    ['Tue, 15 Sep 2026 23:59:00 GMT', 0],
    ['0', 0],
    ['-1', undefined],
    ['1.5', undefined],
    ['', undefined],
    ['tomorrow', undefined],
    ['9999999999999999999999', undefined],
  ]) {
    await assert.rejects(rejectingClient('{}', 429, header).getGiftEvents(null, 1, 'token'), (error) => {
      assert.equal(error.retryAfterMs, expected, header);
      return true;
    });
  }
});

test('real Retry-After response sets gift discovery and SSE recovery minimum wait', async () => {
  for (const stage of ['discovery', 'stream']) {
    const client = rejectingClient('null', 429, '120');
    const fixture = createFixture();
    if (stage === 'discovery') {
      fixture.options.licenseManager.getGiftEventsInternal = () => client.getGiftEvents(null, 1, 'token');
    } else {
      fixture.options.licenseManager.watchGiftEventsInternal = (options) => client.watchGiftEvents('token', options);
    }
    const controller = createRemoteGiftController(fixture.options);
    try {
      await controller.start();
      await new Promise((resolve) => setImmediate(resolve));
      assert.ok(
        fixture.scheduledTimers.some((timer) => !timer.cleared && timer.delay === 120_000),
        stage,
      );
      assert.equal(
        fixture.scheduledTimers.some((timer) => !timer.cleared && timer.delay === 1000),
        false,
      );
    } finally {
      controller.dispose();
    }
  }
});

test('real malformed SSE 401 responses close license authorization and clear token', async () => {
  for (const body of ['null', '[]', 'proxy denied']) {
    for (const stream of ['gift', 'cloud']) {
      const { manager, remote } = createHarness({ identity: { deviceId: 'd', publicKeyPem: 'public' } });
      const client = rejectingClient(body, 401);
      try {
        await manager.bootstrap();
        remote.watchGiftEvents = client.watchGiftEvents;
        remote.watchCloudStateChanges = client.watchCloudStateChanges;
        await assert.rejects(
          stream === 'gift' ? manager.watchGiftEventsInternal() : manager.watchCloudStateChangesInternal(),
          (error) => error.status === 401,
        );
        assert.equal(manager.getState(), manager.LicenseState.BLOCKED);
        assert.equal(manager.getAccessToken(), '');
      } finally {
        manager.dispose();
      }
    }
  }
});

test('gift restart and stale reconnect timers cannot bypass Retry-After', async () => {
  let requests = 0;
  const client = rejectingClient('{}', 429, '60');
  const fixture = createFixture();
  fixture.options.licenseManager.getGiftEventsInternal = () => {
    requests += 1;
    return client.getGiftEvents(null, 1, 'token');
  };
  const controller = createRemoteGiftController(fixture.options);
  try {
    await controller.start();
    const oldRetry = fixture.scheduledTimers.find((timer) => !timer.cleared);
    await controller.start();
    assert.equal(requests, 1);
    const currentRetry = fixture.scheduledTimers.find((timer) => !timer.cleared);
    assert.notEqual(oldRetry, currentRetry);
    oldRetry.callback();
    await controller.whenIdle();
    assert.equal(requests, 1);
    currentRetry.callback();
    await controller.whenIdle();
    assert.equal(requests, 2);
  } finally {
    controller.dispose();
  }
});

test('gift Retry-After larger than a native timer is waited in cancellable chunks', async () => {
  let requests = 0;
  const client = rejectingClient('{}', 429, '2147484');
  const fixture = createFixture();
  fixture.options.licenseManager.getGiftEventsInternal = () => {
    requests += 1;
    return client.getGiftEvents(null, 1, 'token');
  };
  const controller = createRemoteGiftController(fixture.options);
  try {
    await controller.start();
    const first = fixture.scheduledTimers.at(-1);
    assert.equal(first.delay, 2 ** 31 - 1);
    first.callback();
    await controller.whenIdle();
    assert.equal(requests, 1);
    assert.ok(fixture.scheduledTimers.at(-1).delay >= 353);
    controller.stop();
    fixture.scheduledTimers.at(-1).callback();
    await controller.whenIdle();
    assert.equal(requests, 1);
  } finally {
    controller.dispose();
  }
});
