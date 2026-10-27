'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatGptFixture } = require('../helpers/chatgpt-fixture');
const { createAiConfigStore } = require('../../src/ai/config-store');
const { waitUntil } = require('../helpers/ai-assistant-service-fixture');

test('ChatGPT uses PKCE loopback registration and restores encrypted credentials without public tokens', async t => {
  const f = await createChatGptFixture(t);
  await f.session.openLogin();
  const authorization = f.browserUrl;
  assert.equal(authorization.origin, 'https://auth.openai.com');
  assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(authorization.searchParams.get('agent_name_hint'), 'LIRA');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorization.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
  assert.equal(new URL(authorization.searchParams.get('redirect_uri')).hostname, '127.0.0.1');
  assert.equal(await f.callback(), 200);
  assert.equal(f.session.getStatus().ready, true);
  const tokenCall = f.calls.find(call => call.url.endsWith('/token')).body;
  assert.notEqual(tokenCall.get('client_id'), 'dynamic_agent_client');
  assert.equal(tokenCall.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
  assert.equal(require('node:crypto').createHash('sha256').update(tokenCall.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
  const row = f.persistence.readConfiguration().find(entry => entry.key === 'chatgptAccounts');
  assert.equal(row.isSecret, true);
  assert.doesNotMatch(row.value, /fixture-access|fixture-refresh/);
  assert.doesNotMatch(JSON.stringify(f.session.getStatus()), /fixture-access|fixture-refresh|idToken|clientId|subject/);
  const publicConfig = createAiConfigStore(f.persistence, f.codec).getPublicConfig();
  assert.equal(publicConfig.chatgptAccounts, undefined);
  assert.equal(publicConfig.personaId, 'general');
  assert.equal(publicConfig.functionCallingEnabled, false);
  const restored = f.makeSession();
  assert.equal(restored.getStatus().ready, true);
  await restored.openLogin();
  assert.equal(f.browserUrl.searchParams.get('ext_agent_host_id'), authorization.searchParams.get('ext_agent_host_id'));
  assert.equal(f.browserUrl.searchParams.get('client_id'), tokenCall.get('client_id'));
  assert.equal(f.browserUrl.searchParams.has('agent_name_hint'), false);
  restored.cancelLogin();
});

test('ChatGPT rejects invalid callback state before redeeming any code', async t => {
  const f = await createChatGptFixture(t);
  await f.session.openLogin();
  assert.equal(await f.callback({ state: 'wrong-state' }), 400);
  assert.equal(f.calls.some(call => call.url.endsWith('/token')), false);
  assert.equal(f.session.getStatus().ready, false);
});

for (const [name, identity] of Object.entries({ issuer: { iss: 'https://attacker.test' }, audience: { aud: 'other-client' },
  nonce: { nonce: 'wrong' }, expired: { exp: 1 }, issuedInFuture: { iat: 9999999999 }, subject: { sub: '' } })) {
  test(`ChatGPT rejects a signed ID token with invalid ${name}`, async t => {
    const f = await createChatGptFixture(t);
    f.controls.identity = identity;
    assert.equal(await f.login(), 400);
    assert.equal(f.session.getStatus().loggedIn, false);
  });
}

test('ChatGPT identity sign-in without plan consent cannot perform inference', async t => {
  const f = await createChatGptFixture(t);
  f.controls.scope = 'openid email offline_access';
  await f.login();
  assert.equal(f.session.getStatus().loggedIn, true);
  assert.equal(f.session.getStatus().ready, false);
  await assert.rejects(f.session.withAccessToken(() => assert.fail('must not call inference')), { code: 'CHATGPT_LOGIN_REQUIRED' });
});

test('ChatGPT rejects a forged ID token signature', async t => {
  const f = await createChatGptFixture(t);
  f.controls.tamperSignature = true;
  assert.equal(await f.login(), 400);
  assert.equal(f.session.getStatus().ready, false);
});

test('ChatGPT cancellation closes the callback listener and rejects late credentials', async t => {
  const f = await createChatGptFixture(t);
  await f.session.openLogin();
  const callback = f.browserUrl.searchParams.get('redirect_uri');
  f.session.cancelLogin();
  await assert.rejects(fetch(callback));
  assert.equal(f.session.getStatus().pending, false);
  assert.equal(f.session.getStatus().loggedIn, false);
  const hostId = f.browserUrl.searchParams.get('ext_agent_host_id');
  const restored = f.makeSession();
  await restored.openLogin();
  assert.equal(f.browserUrl.searchParams.get('ext_agent_host_id'), hostId);
  restored.cancelLogin();
});

test('ChatGPT serializes rotating refreshes and persists the replacement token atomically', async t => {
  const f = await createChatGptFixture(t);
  await f.login();
  f.advance(3550000);
  assert.deepEqual(await Promise.all([1, 2, 3].map(() => f.session.withAccessToken(token => token))),
    ['fixture-refreshed-access', 'fixture-refreshed-access', 'fixture-refreshed-access']);
  const refreshes = f.calls.filter(call => call.body.get('grant_type') === 'refresh_token');
  assert.equal(refreshes.length, 1);
  const saved = JSON.parse(f.codec.decrypt(f.persistence.readConfiguration().find(row => row.key === 'chatgptAccounts').value));
  assert.equal(saved.profiles[0].refreshToken, 'fixture-rotated-refresh');
  assert.equal(saved.profiles[0].accessToken, 'fixture-refreshed-access');
});

test('ChatGPT logout cancels in-flight inference and clears only the selected account', async t => {
  const f = await createChatGptFixture(t);
  await f.login();
  const firstId = f.session.getStatus().activeId;
  await f.login({ newAccount: true });
  const secondId = f.session.getStatus().activeId;
  assert.notEqual(firstId, secondId);
  let signal;
  let finish;
  const operation = f.session.withAccessToken((_token, selectedSignal) => {
    signal = selectedSignal;
    return new Promise(resolve => { finish = resolve; });
  });
  await waitUntil(() => Boolean(finish));
  const rejected = assert.rejects(operation, { code: 'AI_MODEL_SESSION_CHANGED' });
  await f.session.logout();
  assert.equal(signal.aborted, true);
  finish('stale answer');
  await rejected;
  assert.equal(f.session.getStatus().loggedIn, false);
  const revoke = f.calls.find(call => call.url.endsWith('/revoke'));
  assert.equal(revoke.body.get('token_type_hint'), 'refresh_token');
  f.session.selectAccount(firstId);
  assert.equal(f.session.getStatus().ready, true);
});

test('failed reauthorization cannot roll back credentials refreshed while the browser was open', async t => {
  const f = await createChatGptFixture(t);
  await f.login();
  f.advance(3550000);
  await f.session.openLogin();
  assert.equal(await f.session.withAccessToken(token => token), 'fixture-refreshed-access');
  f.controls.identity = { nonce: 'invalid' };
  assert.equal(await f.callback(), 400);
  assert.equal(await f.session.withAccessToken(token => token), 'fixture-refreshed-access');
  assert.equal(f.calls.filter(call => call.body.get('grant_type') === 'refresh_token').length, 1);
});

test('ChatGPT rejects a different registration during reauthorization and preserves the active account', async t => {
  const f = await createChatGptFixture(t);
  await f.login();
  const original = f.session.getStatus();
  await f.session.openLogin();
  assert.equal(await f.callback({ client_id: 'oaiapp_attacker' }), 400);
  assert.equal(f.session.getStatus().activeId, original.activeId);
  assert.equal(f.session.getStatus().ready, true);
});

test('ChatGPT invalid refresh requires login without trying an API key', async t => {
  const f = await createChatGptFixture(t);
  await f.login();
  f.advance(3600000);
  f.controls.request = (_url, options) => new URLSearchParams(options.body).get('grant_type') === 'refresh_token'
    ? f.json({ error: 'invalid_grant' }, 400) : undefined;
  await assert.rejects(f.session.withAccessToken(() => assert.fail()), { code: 'CHATGPT_REAUTH_REQUIRED' });
  assert.equal(f.session.getStatus().loggedIn, false);
});

test('ChatGPT logout cannot be undone by a late rotating refresh', async t => {
  const f = await createChatGptFixture(t);
  await f.login();
  f.advance(3600000);
  let release;
  f.controls.request = (_url, options) => new URLSearchParams(options.body).get('grant_type') === 'refresh_token'
    ? new Promise(resolve => { release = () => resolve(f.json({ token_type: 'Bearer', access_token: 'late-token', refresh_token: 'late-refresh', expires_in: 3600, scope: f.controls.scope })); }) : undefined;
  const operation = f.session.withAccessToken(() => assert.fail());
  const rejected = assert.rejects(operation, { code: 'AI_MODEL_SESSION_CHANGED' });
  await waitUntil(() => Boolean(release));
  await f.session.logout();
  release();
  await rejected;
  assert.equal(f.session.getStatus().loggedIn, false);
  assert.equal(f.makeSession().getStatus().loggedIn, false);
});

for (const options of [{ desktop: false }, { encryption: false }]) {
  test(`ChatGPT refuses login without ${options.desktop === false ? 'desktop browser integration' : 'system encryption'}`, async t => {
    const f = await createChatGptFixture(t, options);
    await assert.rejects(f.session.openLogin(), { code: 'CHATGPT_UNAVAILABLE' });
    assert.equal(f.calls.length, 0);
  });
}
