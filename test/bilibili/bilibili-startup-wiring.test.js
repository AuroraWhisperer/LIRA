'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createFixture } = require('../helpers/cloud-sync-controller-fixture');

test('only a completed Bilibili login uploads cloud credentials', async (t) => {
  let result = { cancelled: true, state: { loggedIn: false } };
  const cookie = 'DedeUserID=42; SESSDATA=local; bili_jct=local-csrf';
  const fixture = createFixture({
    bilibiliAuth: {
      login: async () => result,
      getAuthState: async () => ({ loggedIn: true, uid: 42 }),
      getCookieHeader: async () => cookie,
    },
  });
  t.after(() => fixture.controller.dispose());
  await fixture.controller.start();
  await fixture.controller.loginBilibili();
  await fixture.controller.whenIdle();
  assert.equal(fixture.calls.filter(([operation]) => operation === 'push-bilibili').length, 0);

  result = { state: { loggedIn: true } };
  await fixture.controller.loginBilibili();
  await fixture.controller.whenIdle();
  assert.deepEqual(fixture.calls.filter(([operation]) => operation === 'push-bilibili'), [['push-bilibili', cookie]]);
});
