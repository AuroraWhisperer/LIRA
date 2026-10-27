'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { readResponseText } = require('../shared/response-body');
const { createPublicError, createRequestSignal } = require('./http-client');

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

function createChatGptOAuth({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let discoveryPromise;

  async function discovery() {
    discoveryPromise ||= request(`${ISSUER}/.well-known/openid-configuration`).then(metadata => {
      if (metadata.issuer !== ISSUER) throw authError();
      for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'revocation_endpoint']) {
        const url = new URL(metadata[key]);
        if (url.origin !== ISSUER || url.username || url.password) throw authError();
      }
      return metadata;
    }).catch(error => { discoveryPromise = null; throw error; });
    return discoveryPromise;
  }

  async function request(url, { body, signal, empty = false } = {}) {
    try {
      const response = await fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
        body, redirect: 'error', signal: createRequestSignal(signal, 15000),
      });
      const text = await readResponseText(response, 256 * 1024, authError);
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        if (data.error === 'invalid_grant') throw createPublicError('CHATGPT_REAUTH_REQUIRED', 'ChatGPT 授权已失效，请重新登录。');
        throw authError();
      }
      return empty ? undefined : data;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (['CHATGPT_REAUTH_REQUIRED', 'CHATGPT_AUTH_FAILED'].includes(error.code)) throw error;
      throw authError();
    }
  }

  async function verifyIdentity(token, clientId, nonce, signal) {
    try {
      const metadata = await discovery();
      const { jwtVerify, createLocalJWKSet } = await import('jose');
      const jwks = await request(metadata.jwks_uri, { signal });
      const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
        issuer: ISSUER, audience: clientId, algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat'], maxTokenAge: 300, clockTolerance: 5, currentDate: new Date(now()),
      });
      if (!payload.sub || typeof payload.sub !== 'string' || (nonce && payload.nonce !== nonce)) throw authError();
      return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' };
    } catch { throw authError(); }
  }

  function readTokens(data, previous = {}) {
    if (typeof data.access_token !== 'string' || !data.access_token || data.token_type?.toLowerCase() !== 'bearer'
      || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw authError();
    return {
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : previous.refreshToken || '',
      idToken: typeof data.id_token === 'string' ? data.id_token : previous.idToken || '',
      scopes: typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : previous.scopes || [],
      expiresAt: now() + data.expires_in * 1000,
    };
  }

  async function begin({ hostId, profile, onRegistration, signal }) {
    const metadata = await discovery();
    signal?.throwIfAborted();
    const verifier = crypto.randomBytes(32).toString('base64url');
    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const controller = new AbortController();
    let resolveResult;
    let rejectResult;
    let settled = false;
    let receiving = false;
    let timer;
    let redirectUri;
    const completion = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    // The owner attaches its handler after the loopback listener has started.
    void completion.catch(() => {});
    const server = http.createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      let callback;
      try {
        if (!req.url || req.url.length > 8192) throw authError();
        callback = new URL(req.url, redirectUri);
      } catch { res.writeHead(400).end('Invalid callback'); return; }
      if (req.method !== 'GET' || req.headers.host !== new URL(redirectUri).host || callback.pathname !== '/auth/callback') {
        res.writeHead(404).end('Not found');
        return;
      }
      if (receiving || settled) { res.writeHead(409).end('登录请求已处理。'); return; }
      receiving = true;
      void complete(callback).then(result => {
        res.end('ChatGPT 授权完成，可以关闭此页并返回 LIRA。');
        finish(null, result);
      }, error => {
        res.writeHead(400).end('登录未完成，请返回 LIRA 查看状态并重试。');
        finish(error);
      });
    });
    server.maxHeadersCount = 16;
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.abort(error || createPublicError('CHATGPT_LOGIN_FINISHED', '登录已结束。'));
      server.close();
      server.closeIdleConnections();
      if (error) rejectResult(error);
      else resolveResult(result);
    }
    function abort() { finish(signal.reason); }
    async function complete(callback) {
      if (callback.searchParams.get('state') !== state) throw authError();
      if (callback.searchParams.has('error')) throw createPublicError('CHATGPT_CONSENT_DENIED', '已取消 ChatGPT 授权，可重新登录并允许使用订阅。');
      const code = callback.searchParams.get('code');
      const clientId = callback.searchParams.get('client_id') || profile?.clientId;
      if (!code || !clientId || clientId === 'dynamic_agent_client' || clientId.length > 512
        || (profile?.clientId && clientId !== profile.clientId)) throw authError();
      onRegistration(clientId);
      const data = await request(metadata.token_endpoint, { signal: controller.signal, body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier,
        redirect_uri: redirectUri, resource: RESOURCE,
      }) });
      const identity = await verifyIdentity(data.id_token, clientId, nonce, controller.signal);
      if (profile?.subject && identity.subject !== profile.subject) throw authError();
      return { clientId, ...identity, ...readTokens(data) };
    }

    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    if (settled) return { completion, cancel: finish };
    timer = setTimeout(() => finish(createPublicError('CHATGPT_LOGIN_TIMEOUT', 'ChatGPT 登录已超时，请重新登录。')), AUTH_TIMEOUT_MS);
    timer.unref?.();
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: profile?.clientId || 'dynamic_agent_client', response_type: 'code',
      redirect_uri: redirectUri, scope: `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`,
      resource: RESOURCE, ext_agent_host_id: hostId, state, nonce,
      code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      ...(profile?.clientId ? {} : { agent_name_hint: 'LIRA' }),
      ...(profile?.idToken ? { id_token_hint: profile.idToken } : {}),
      ...(profile?.email ? { login_hint: profile.email } : {}),
    }).toString();
    return { url: url.toString(), completion, cancel: error => finish(error || authError()) };
  }

  async function refresh(profile, signal) {
    if (!profile.refreshToken) throw createPublicError('CHATGPT_REAUTH_REQUIRED', '请重新登录 ChatGPT。');
    const metadata = await discovery();
    const data = await request(metadata.token_endpoint, { signal, body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: profile.refreshToken, resource: RESOURCE,
    }) });
    if (data.id_token) {
      const identity = await verifyIdentity(data.id_token, profile.clientId, null, signal);
      if (identity.subject !== profile.subject) throw authError();
    }
    return readTokens(data, profile);
  }

  async function revoke(profile) {
    if (!profile.refreshToken) return;
    const metadata = await discovery();
    await request(metadata.revocation_endpoint, { empty: true, body: new URLSearchParams({
      token: profile.refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId,
    }) });
  }

  return { begin, refresh, revoke };
}

function authError() {
  return createPublicError('CHATGPT_AUTH_FAILED', 'ChatGPT 授权未通过验证或服务暂不可用，请重新登录。');
}

module.exports = { createChatGptOAuth, PLAN_SCOPE };
