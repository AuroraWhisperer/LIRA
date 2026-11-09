'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchBilibiliFormerNames } = require('../../src/shared/bilibili-former-names');
const { fixture, deferred } = require('../helpers/fan-profile-controller-fixture');
const { fanFixture, IDENTITY } = require('../helpers/fan-profile-fixture');

test('former-name lookup uses a fixed credential-free provider and normalizes the returned names', async () => {
  const names = await fetchBilibiliFormerNames('900000001', { fetchImpl: async (url, options) => {
    assert.equal(url.origin, 'https://api.aicu.cc');
    assert.equal(url.searchParams.get('uid'), '900000001');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Cookie, undefined);
    return { ok: true, json: async () => ({ code: 0, data: { hname: [' 旧名字 ', '旧名字', '另一个名字', '', null] } }) };
  } });
  assert.deepEqual(names, ['旧名字', '另一个名字']);
  await assert.rejects(fetchBilibiliFormerNames('900000001', {
    fetchImpl: async () => ({ ok: true, json: async () => ({ code: -1 }) }),
  }));
});

test('draft lookup and profile supplement share an in-flight request and commit without changing the default name', async (t) => {
  const domain = fanFixture(t);
  const p = domain.create({ preferredFormerName: '我记得的名字' });
  const delayed = deferred();
  let calls = 0;
  const f = fixture(t, { service: domain.service, formerNames: () => { calls++; return delayed.promise; } });
  const { contextId } = await f.invoke({ action: 'open' });
  const draft = f.invoke({ action: 'lookup-former-names', contextId, payload: { uid: IDENTITY.value } });
  const supplement = f.invoke({ action: 'supplement-former-names', contextId, payload: { id: p.id } });
  await Promise.resolve();
  assert.equal(calls, 1);
  delayed.resolve(['收录的名字']);
  assert.equal((await draft).ok, true);
  assert.equal((await supplement).data.added, 1);
  assert.equal(domain.detail(p.id).formerName, '我记得的名字');
  f.controller.dispose();
  await f.controller.whenIdle();
});

test('account changes cancel former-name requests and late results cannot write private profiles', async (t) => {
  const domain = fanFixture(t);
  const p = domain.create();
  const delayed = deferred();
  let signal;
  const f = fixture(t, { service: domain.service, formerNames: (_uid, options) => {
    signal = options.signal;
    return delayed.promise;
  } });
  const { contextId } = await f.invoke({ action: 'open' });
  const pending = f.invoke({ action: 'supplement-former-names', contextId, payload: { id: p.id } });
  await Promise.resolve();
  f.state.authorized = false;
  f.emit();
  assert.equal(signal.aborted, true);
  delayed.resolve(['迟到的名字']);
  assert.equal((await pending).ok, false);
  assert.equal(domain.detail(p.id).formerNames.length, 0);
  f.controller.dispose();
  await f.controller.whenIdle();
});
