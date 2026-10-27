'use strict';

const { randomUUID } = require('node:crypto');
const { createChatGptOAuth, PLAN_SCOPE } = require('./chatgpt-oauth');
const { createPublicError } = require('./http-client');

function createChatGptSession({ persistence, secretCodec, openBrowser, fetchImpl, now = Date.now }) {
  const oauth = createChatGptOAuth({ fetchImpl, now });
  const rows = persistence.readConfiguration();
  const hostId = rows.find(row => row.key === 'chatgptHostId')?.value || `urn:uuid:${randomUUID()}`;
  let state = { profiles: [], activeId: '' };
  let lastError = '';
  let disposed = false;
  let pending = null;
  let refreshPromise = null;
  let revision = randomUUID();
  let controller = new AbortController();
  const operations = new Set();
  try {
    const encrypted = rows.find(row => row.key === 'chatgptAccounts')?.value;
    if (encrypted) state = JSON.parse(secretCodec.decrypt(encrypted));
    if (!Array.isArray(state.profiles)) throw new Error();
  } catch {
    state = { profiles: [], activeId: '' };
    lastError = '无法解密已保存的 ChatGPT 登录信息，请重新登录。';
  }

  function save(next = state) {
    persistence.updateConfiguration([
      { key: 'chatgptHostId', value: hostId, isSecret: false },
      { key: 'chatgptAccounts', value: secretCodec.encrypt(JSON.stringify(next)), isSecret: true },
    ], new Date(now()).toISOString(), () => {});
    state = next;
  }
  function active() { return state.profiles.find(profile => profile.id === state.activeId); }
  function getStatus() {
    const profile = active();
    const available = !disposed && typeof openBrowser === 'function' && secretCodec.isAvailable();
    return {
      available, pending: Boolean(pending), activeId: state.activeId,
      loggedIn: Boolean(profile?.accessToken),
      ready: available && Boolean(profile?.accessToken && profile.scopes?.includes(PLAN_SCOPE)),
      profiles: state.profiles.map((profile, index) => ({ id: profile.id, label: `${profile.email || 'ChatGPT'} · ${index + 1}`, loggedIn: Boolean(profile.accessToken) })),
      lastError,
    };
  }
  function track(operation) {
    operations.add(operation);
    void operation.then(() => operations.delete(operation), () => operations.delete(operation));
    return operation;
  }
  function replaceSession() {
    revision = randomUUID();
    controller.abort(createPublicError('AI_MODEL_SESSION_CHANGED', 'AI 账号已切换或退出，本次请求已取消。'));
    controller = new AbortController();
    refreshPromise = null;
  }
  function cancelLogin() {
    pending?.abort(createPublicError('CHATGPT_LOGIN_CANCELLED', '已取消 ChatGPT 登录。'));
    pending = null;
    return getStatus();
  }
  async function startLogin({ profileId, newAccount = false } = {}) {
    if (!getStatus().available) throw createPublicError('CHATGPT_UNAVAILABLE', '请在支持系统加密的 LIRA 桌面客户端登录 ChatGPT。');
    if (pending) return getStatus();
    const existing = newAccount ? null : state.profiles.find(profile => profile.id === (profileId || state.activeId));
    if (profileId && !existing) throw createPublicError('CHATGPT_ACCOUNT_MISSING', '找不到所选 ChatGPT 账号。');
    const id = existing?.id || randomUUID();
    // Keep the host identity stable even when the first browser login is cancelled.
    save();
    const attempt = new AbortController();
    pending = attempt;
    lastError = '';
    try {
      const flow = await oauth.begin({ hostId, profile: existing, signal: attempt.signal,
        onRegistration(clientId) {
          attempt.signal.throwIfAborted();
          const profile = { ...state.profiles.find(entry => entry.id === id), id, clientId };
          save({ ...state, profiles: state.profiles.some(entry => entry.id === id)
            ? state.profiles.map(entry => entry.id === id ? profile : entry) : [...state.profiles, profile] });
        },
      });
      const result = track(flow.completion.then(credentials => {
        attempt.signal.throwIfAborted();
        save({ ...state, activeId: id, profiles: state.profiles.map(profile => profile.id === id ? { id, ...credentials } : profile) });
        replaceSession();
        lastError = credentials.scopes.includes(PLAN_SCOPE) ? '' : '已登录，但未授权使用 ChatGPT 订阅；请重新授权。';
      }).catch(error => {
        if (pending === attempt) lastError = error.message;
      }).finally(() => { if (pending === attempt) pending = null; }));
      try {
        attempt.signal.throwIfAborted();
        await openBrowser(flow.url);
      } catch {
        flow.cancel(createPublicError('CHATGPT_BROWSER_FAILED', '无法打开系统浏览器，请重试登录。'));
        await result;
      }
    } catch (error) {
      if (pending === attempt) { pending = null; lastError = error.message; }
      throw error;
    }
    return getStatus();
  }
  function selectAccount(id) {
    if (disposed || !state.profiles.some(profile => profile.id === id)) throw createPublicError('CHATGPT_ACCOUNT_MISSING', '找不到所选 ChatGPT 账号。');
    cancelLogin();
    save({ ...state, activeId: id });
    replaceSession();
    lastError = '';
    return getStatus();
  }
  function logout() {
    cancelLogin();
    const profile = active();
    if (!profile) return Promise.resolve(getStatus());
    save({ ...state, profiles: state.profiles.map(entry => entry.id === profile.id
      ? { id: entry.id, clientId: entry.clientId, subject: entry.subject, email: entry.email } : entry) });
    replaceSession();
    const logoutRevision = revision;
    lastError = '';
    return track(oauth.revoke(profile).catch(() => {
      if (revision === logoutRevision) lastError = '本机已退出，未确认远端撤销；可在 ChatGPT 设置中断开 LIRA。';
    }).then(getStatus));
  }
  async function withAccessToken(work, signal) {
    if (!getStatus().ready) throw createPublicError('CHATGPT_LOGIN_REQUIRED', '请登录 ChatGPT 并授权使用订阅。');
    const sessionSignal = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    const selectedRevision = revision;
    let profile = active();
    if (profile.expiresAt <= now() + 60000) {
      if (!refreshPromise) {
        const refreshSignal = controller.signal;
        const operation = track(oauth.refresh(profile, refreshSignal).then(tokens => {
          refreshSignal.throwIfAborted();
          save({ ...state, profiles: state.profiles.map(entry => entry.id === profile.id ? { ...entry, ...tokens } : entry) });
        }).catch(error => {
          if (revision === selectedRevision && error.code === 'CHATGPT_REAUTH_REQUIRED') {
            save({ ...state, profiles: state.profiles.map(entry => entry.id === profile.id
              ? { id: entry.id, clientId: entry.clientId, subject: entry.subject, email: entry.email } : entry) });
            replaceSession();
            lastError = error.message;
          }
          throw error;
        }).finally(() => { if (refreshPromise === operation) refreshPromise = null; }));
        refreshPromise = operation;
      }
      await refreshPromise;
      profile = active();
    }
    sessionSignal.throwIfAborted();
    if (!profile.scopes?.includes(PLAN_SCOPE)) throw createPublicError('CHATGPT_LOGIN_REQUIRED', '请重新授权使用 ChatGPT 订阅。');
    return track(Promise.resolve().then(() => work(profile.accessToken, sessionSignal)).then(value => {
      sessionSignal.throwIfAborted();
      return value;
    }));
  }
  function shutdown() {
    disposed = true;
    cancelLogin();
    replaceSession();
    return Promise.allSettled([...operations]);
  }
  return { getStatus, openLogin: input => track(startLogin(input)), cancelLogin, selectAccount, logout,
    withAccessToken, getSessionRevision: () => revision, shutdown };
}

module.exports = { createChatGptSession };
