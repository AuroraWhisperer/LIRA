'use strict';

const { createLotteryAuthStore } = require('./dynamic-lottery-auth-store');
const { createLotterySession } = require('./dynamic-lottery-session');
const { openBilibiliLoginWindow } = require('./bilibili-login-window');

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function createDynamicLotteryAuth({
  session,
  safeStorage,
  dataDir,
  licenseManager,
  BrowserWindow,
  shell,
  getMainWindow,
  writeLog = () => {},
}) {
  let account = null;
  let loginJob = null;
  let logoutJob = null;
  let disposed = false;
  let queue = Promise.resolve();

  function getScope() {
    if (disposed) fail('LOTTERY_SESSION_DISPOSED');
    if (licenseManager.getState() !== 'authorized') fail('LOTTERY_IDENTITY_UNAVAILABLE');
    const streamerId = String(licenseManager.getCloudSyncIdentity()?.streamerId || '');
    const authorizationEpoch = licenseManager.getAuthorizationEpoch();
    if (
      !streamerId ||
      streamerId.length > 128 ||
      /[\r\n\0]/u.test(streamerId) ||
      !Number.isSafeInteger(authorizationEpoch) ||
      authorizationEpoch < 0
    ) {
      fail('LOTTERY_IDENTITY_UNAVAILABLE');
    }
    return { streamerId, authorizationEpoch };
  }

  function sameScope(left, right) {
    return left?.streamerId === right?.streamerId && left?.authorizationEpoch === right?.authorizationEpoch;
  }

  function assertCurrent(selected) {
    if (account !== selected || !sameScope(selected.scope, getScope())) {
      fail('LOTTERY_SESSION_CHANGED');
    }
  }

  function run(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function invalidate() {
    lotterySession.invalidate();
    loginJob?.abort.abort();
    account = null;
  }

  async function getAccount() {
    const scope = getScope();
    if (account && !sameScope(account.scope, scope)) invalidate();
    if (!account) {
      const selected = {
        scope,
        store: createLotteryAuthStore({
          session,
          safeStorage,
          dataDir,
          streamerId: scope.streamerId,
        }),
        warning: '',
      };
      account = selected;
      try {
        await selected.store.restore();
      } catch (error) {
        selected.warning = error.code || 'LOTTERY_AUTH_RESTORE_FAILED';
      }
      assertCurrent(selected);
    }
    return account;
  }

  const lotterySession = createLotterySession({
    getIdentity: () => getScope(),
    getAuthorizationEpoch: () => getScope().authorizationEpoch,
    getCookieHeader: async () => {
      if (logoutJob) fail('LOTTERY_AUTH_BUSY');
      const selected = await getAccount();
      const header = await selected.store.getCookieHeader();
      assertCurrent(selected);
      return header;
    },
  });

  const unsubscribe = licenseManager.onStateChanged(() => {
    if (!account && !loginJob) return;
    try {
      if (sameScope(account?.scope, getScope())) return;
    } catch {
      invalidate();
      return;
    }
    invalidate();
  });

  async function readState(selected) {
    const state = await selected.store.getAuthState();
    assertCurrent(selected);
    return { ...state, warning: selected.warning };
  }

  function getAuthState() {
    return run(async () => readState(await getAccount()));
  }

  function getContext() {
    return run(async () => {
      const selected = await getAccount();
      const context = await lotterySession.getContext();
      if (logoutJob) fail('LOTTERY_AUTH_BUSY');
      assertCurrent(selected);
      return context;
    });
  }

  function login() {
    if (logoutJob) return Promise.reject(new Error('LOTTERY_AUTH_BUSY'));
    if (loginJob) {
      loginJob.window?.focus();
      return loginJob.promise;
    }
    const job = { abort: new AbortController(), window: null, promise: null };
    loginJob = job;
    job.promise = run(async () => {
      const selected = await getAccount();
      if (job.abort.signal.aborted) fail('LOTTERY_SESSION_CHANGED');
      if (!safeStorage.isEncryptionAvailable()) fail('LOTTERY_AUTH_ENCRYPTION_UNAVAILABLE');
      if ((await readState(selected)).loggedIn) return { selected };
      lotterySession.invalidate();
      const auth = {
        BILIBILI_LOGIN_CONFIG: {
          name: '抽奖专用账号',
          partition: selected.store.partition,
          loginUrl: 'https://passport.bilibili.com/login',
          allowedHosts: ['bilibili.com'],
        },
        getBilibiliAuthState: () => run(() => readState(selected)),
        persistBilibiliCookieSnapshot: () =>
          run(async () => {
            if (job.abort.signal.aborted) return;
            assertCurrent(selected);
            await selected.store.persist();
          }),
      };
      return {
        selected,
        completion: openBilibiliLoginWindow({
          BrowserWindow,
          shell,
          auth,
          mainWindow: getMainWindow(),
          title: '登录抽奖专用账号',
          signal: job.abort.signal,
          onWindowReady: (window) => {
            job.window = window;
          },
          // Never forward an upstream URL, request header or raw error to logs.
          writeLog: () => writeLog('dynamic-lottery-auth', 'LOGIN_WINDOW_EVENT'),
        }),
      };
    })
      .then(async ({ selected, completion }) => {
        if (completion) await completion;
        return run(async () => {
          if (job.abort.signal.aborted) fail('LOTTERY_SESSION_CHANGED');
          assertCurrent(selected);
          await selected.store.persist();
          selected.warning = '';
          return readState(selected);
        });
      })
      .finally(() => {
        if (loginJob === job) loginJob = null;
      });
    return job.promise;
  }

  function logout() {
    if (logoutJob) return logoutJob;
    const expectedScope = getScope();
    const pendingLogin = loginJob?.promise;
    loginJob?.abort.abort();
    lotterySession.invalidate();
    logoutJob = Promise.resolve(pendingLogin)
      .catch(() => {})
      .then(() =>
        run(async () => {
          if (!sameScope(expectedScope, getScope())) fail('LOTTERY_SESSION_CHANGED');
          const selected = await getAccount();
          await selected.store.clear();
          selected.warning = '';
          return readState(selected);
        }),
      )
      .finally(() => {
        logoutJob = null;
      });
    return logoutJob;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    loginJob?.abort.abort();
    lotterySession.dispose();
  }

  async function whenIdle() {
    await Promise.allSettled([loginJob?.promise, logoutJob]);
    await queue;
  }

  return {
    getAuthState,
    getContext,
    getIdentity: getScope,
    login,
    logout,
    dispose,
    whenIdle,
  };
}

module.exports = { createDynamicLotteryAuth };
