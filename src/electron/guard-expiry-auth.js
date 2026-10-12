'use strict';

const { randomUUID } = require('node:crypto');
const { openBilibiliLoginWindow } = require('./bilibili-login-window');

const fail = (code) => Object.assign(new Error(code), { code });

function publicAccount(value) {
  if (!value || !['shared', 'separate'].includes(value.source) || typeof value.loggedIn !== 'boolean' ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      (value.loggedIn && !/^[1-9]\d{0,19}$/u.test(value.uid))) {
    throw fail('INVALID_RESPONSE');
  }
  return {
    source: value.source, loggedIn: value.loggedIn, revision: value.revision,
    uid: value.loggedIn ? String(value.uid) : null,
    displayName: value.loggedIn && typeof value.displayName === 'string' ? value.displayName.slice(0, 80) : null,
  };
}

function createGuardExpiryAuth({ session, licenseManager, BrowserWindow, shell, getMainWindow, loginConfig,
  openLogin = openBilibiliLoginWindow }) {
  let disposed = false;
  let loginJob = null;
  let queue = Promise.resolve();

  function identity() {
    if (disposed || !licenseManager.isAuthorized()) throw fail('LICENSE_NOT_AUTHORIZED');
    const scope = licenseManager.getCloudSyncIdentity();
    if (!scope?.streamerId) throw fail('LICENSE_NOT_AUTHORIZED');
    return `${scope.streamerId}:${licenseManager.getAuthorizationGeneration()}`;
  }

  function assertCurrent(owner) {
    if (identity() !== owner) throw fail('GUARD_EXPIRY_SOURCE_CHANGED');
  }

  const unsubscribe = licenseManager.onStateChanged(() => {
    if (!loginJob) return;
    try { assertCurrent(loginJob.owner); } catch { loginJob.abort.abort(); }
  });

  async function getState() {
    const owner = identity();
    const result = await licenseManager.getGuardExpiryAccountInternal();
    assertCurrent(owner);
    return publicAccount(result);
  }

  function mutate(operation) {
    const owner = identity();
    const pendingLogin = loginJob;
    pendingLogin?.abort.abort();
    const result = queue.catch(() => {}).then(async () => {
      await pendingLogin?.promise.catch(() => {});
      assertCurrent(owner);
      const state = await operation();
      assertCurrent(owner);
      return publicAccount(state);
    });
    queue = result;
    return result;
  }

  function setSource(source) {
    if (!['shared', 'separate'].includes(source)) throw fail('INVALID_GUARD_EXPIRY_ACCOUNT');
    return mutate(() => licenseManager.updateGuardExpiryAccountInternal({ source }));
  }

  function logout() {
    return mutate(() => licenseManager.clearGuardExpiryAccountInternal());
  }

  function login() {
    if (loginJob) return loginJob.promise;
    const job = { owner: identity(), abort: new AbortController() };
    job.promise = runLogin(job).finally(() => { if (loginJob === job) loginJob = null; });
    loginJob = job;
    return job.promise;
  }

  async function runLogin(job) {
    await queue.catch(() => {});
    assertCurrent(job.owner);
    job.abort.signal.throwIfAborted();
    const account = await getState();
    if (account.source !== 'separate') throw fail('INVALID_GUARD_EXPIRY_ACCOUNT');
    const partition = `guard-expiry-${randomUUID()}`;
    // A fresh in-memory session never reads or persists the live/bot account.
    const loginSession = session.fromPartition(partition);
    async function cookies() {
      return loginSession.cookies.get({ url: 'https://api.live.bilibili.com/' });
    }
    async function authState() {
      const values = new Map((await cookies()).map((entry) => [entry.name, entry.value]));
      const uid = values.get('DedeUserID') || '';
      return { loggedIn: /^[1-9]\d{0,19}$/u.test(uid) && ['SESSDATA', 'bili_jct'].every((key) => Boolean(values.get(key))), uid };
    }
    try {
      const result = await openLogin({
        BrowserWindow, shell, mainWindow: getMainWindow(), signal: job.abort.signal,
        title: '登录主播账号 · 仅用于大航海到期同步',
        auth: {
          BILIBILI_LOGIN_CONFIG: { ...loginConfig, partition, loginUrl: 'https://passport.bilibili.com/login' },
          getBilibiliAuthState: authState,
          // The cloud owns this optional credential; no local snapshot is created.
          persistBilibiliCookieSnapshot: async () => null,
        },
      });
      assertCurrent(job.owner);
      if (job.abort.signal.aborted || !result.state?.loggedIn) return null;
      const cookie = (await cookies()).map((entry) => `${entry.name}=${entry.value}`).join('; ');
      assertCurrent(job.owner);
      job.abort.signal.throwIfAborted();
      const state = await licenseManager.updateGuardExpiryAccountInternal(
        { source: 'separate', cookie }, { signal: job.abort.signal },
      );
      assertCurrent(job.owner);
      job.abort.signal.throwIfAborted();
      return publicAccount(state);
    } finally {
      await loginSession.clearStorageData();
      await loginSession.closeAllConnections();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    loginJob?.abort.abort();
  }

  return { getState, setSource, login, logout, dispose,
    async whenIdle() { await Promise.allSettled([queue, loginJob?.promise]); } };
}

module.exports = { createGuardExpiryAuth, publicAccount };
