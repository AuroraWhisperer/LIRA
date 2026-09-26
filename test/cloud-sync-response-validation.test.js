'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');
const { createFixture } = require('./helpers/cloud-sync-controller-fixture');

test('malformed cloud state cannot seed remote scopes or clear a local login', async () => {
  const valid = {
    settings: { initialized: true, revision: 2, values: { giftBlindBoxConfig: [] } },
    songs: { initialized: true, revision: 3 },
    bilibili: { initialized: true, revision: 4 },
  };
  for (const malformed of [
    {},
    { ...valid, bilibili: undefined },
    { ...valid, settings: { initialized: 'false', revision: 2, values: {} } },
    { ...valid, songs: { initialized: false, revision: -1 } },
    { ...valid, settings: { initialized: true, revision: 2 } },
    { ...valid, settings: { initialized: true, revision: 2, values: [] } },
  ]) {
    let response = malformed;
    const client = createRemoteLicenseClient({ fetchImpl: async () => new Response(JSON.stringify(response)) });
    const fixture = createFixture({ licenseManager: { getCloudState: () => client.getCloudState('synthetic-token') } });
    try {
      await assert.rejects(fixture.controller.start(), { code: 'INVALID_RESPONSE' });
      assert.deepEqual(fixture.calls, [], 'an invalid snapshot must not cause any local or remote mutation');
      response = valid;
      await fixture.controller.syncNow();
      assert.deepEqual(
        fixture.calls.map(([kind]) => kind),
        ['apply-settings', 'apply-songs', 'apply-bilibili'],
      );
    } finally {
      fixture.controller.dispose();
    }
  }
});

test('malformed cloud credentials preserve the login and remain retryable', async () => {
  for (const malformed of [
    {},
    { revision: 4, loggedIn: 'false' },
    { revision: -1, loggedIn: false },
    { revision: 4, loggedIn: true },
    { revision: 4, loggedIn: true, cookie: {} },
  ]) {
    let response = malformed;
    const client = createRemoteLicenseClient({ fetchImpl: async () => new Response(JSON.stringify(response)) });
    const fixture = createFixture({
      licenseManager: { getBilibiliCredentialsInternal: () => client.getBilibiliCredentials('synthetic-token') },
    });
    try {
      await assert.rejects(fixture.controller.start(), { code: 'INVALID_RESPONSE' });
      assert.equal(fixture.calls.some(([kind]) => kind.startsWith('apply-bilibili')), false);
      response = { revision: 4, loggedIn: false };
      await fixture.controller.syncNow();
      assert.equal(fixture.calls.filter(([kind]) => kind === 'apply-bilibili-logout').length, 1);
    } finally {
      fixture.controller.dispose();
    }
  }
});
