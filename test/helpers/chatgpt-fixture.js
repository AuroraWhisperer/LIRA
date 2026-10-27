'use strict';

const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createAiStateStore } = require('../../src/storage/ai-state-store');
const { createChatGptSession } = require('../../src/ai/chatgpt-session');
const { waitUntil } = require('./ai-assistant-service-fixture');

async function createChatGptFixture(t, options = {}) {
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' };
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const persistence = createAiStateStore(db);
  const codec = { isAvailable: () => options.encryption !== false,
    encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() };
  const calls = [];
  let browserUrl;
  let time = Date.now();
  const controls = { scope: 'openid email offline_access resource.invoke chatgpt.tokens.use.direct', expiresIn: 3600, identity: {} };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  async function fetchImpl(url, init = {}) {
    calls.push({ url: String(url), body: new URLSearchParams(init.body) });
    const override = await controls.request?.(url, init);
    if (override !== undefined) return override;
    if (String(url).endsWith('openid-configuration')) return json({ issuer: 'https://auth.openai.com',
      authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize', token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
      jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke' });
    if (String(url).endsWith('/jwks')) return json({ keys: [jwk] });
    if (String(url).endsWith('/revoke')) return new Response(null, { status: 200 });
    if (String(url).endsWith('/token')) {
      const params = new URLSearchParams(init.body);
      const refresh = params.get('grant_type') === 'refresh_token';
      const token = await new SignJWT({ sub: 'fixture-subject', email: 'fixture@example.test', nonce: browserUrl.searchParams.get('nonce'),
        iss: 'https://auth.openai.com', aud: params.get('client_id'), iat: Math.floor(time / 1000), exp: Math.floor(time / 1000) + 3600,
        ...controls.identity }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(privateKey);
      return json({ token_type: 'Bearer', access_token: refresh ? 'fixture-refreshed-access' : 'fixture-access',
        refresh_token: refresh ? 'fixture-rotated-refresh' : 'fixture-refresh', id_token: controls.tamperSignature ? `${token.slice(0, -10)}invalidsig` : token,
        expires_in: controls.expiresIn, scope: controls.scope });
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  }
  const sessions = [];
  function makeSession() {
    const session = createChatGptSession({ persistence, secretCodec: codec, fetchImpl, now: () => time,
      openBrowser: options.desktop === false ? undefined : async url => { browserUrl = new URL(url); } });
    sessions.push(session);
    return session;
  }
  const session = makeSession();
  t.after(async () => { await Promise.all(sessions.map(entry => entry.shutdown())); db.close(); });
  async function callback(changes = {}) {
    const url = new URL(browserUrl.searchParams.get('redirect_uri'));
    url.search = new URLSearchParams({ code: 'fixture-code', state: browserUrl.searchParams.get('state'),
      client_id: browserUrl.searchParams.get('client_id') === 'dynamic_agent_client' ? `oaiapp_fixture_${sessions.length}_${calls.length}` : browserUrl.searchParams.get('client_id'),
      ...changes }).toString();
    const response = await fetch(url);
    await response.text();
    await waitUntil(() => !sessions.some(entry => entry.getStatus().pending));
    return response.status;
  }
  async function login(input) { await session.openLogin(input); return callback(); }
  return { session, makeSession, persistence, codec, controls, calls, login, callback, json,
    get browserUrl() { return browserUrl; }, advance: milliseconds => { time += milliseconds; } };
}

module.exports = { createChatGptFixture };
