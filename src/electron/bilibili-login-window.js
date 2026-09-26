'use strict';

const { isAllowedLoginNavigation, isAllowedExternal } = require('./external-url-policy');
const { logBilibiliDiagnostic, summarizeAuthState } = require('../bilibili/diagnostics');

async function openBilibiliLoginWindow(options = {}) {
  const {
    BrowserWindow,
    shell,
    auth,
    mainWindow,
    dataDir,
    writeLog = () => {},
    title = '登录直播账号',
    signal,
    onWindowReady = () => {},
  } = options;
  if (typeof BrowserWindow !== 'function' || !shell || !auth) {
    throw new Error('Bilibili login window dependencies are required.');
  }

  const config = auth.BILIBILI_LOGIN_CONFIG;
  logBilibiliDiagnostic('login-open');
  const loginWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    title,
    parent: mainWindow || undefined,
    modal: false,
    show: true,
    webPreferences: {
      partition: config.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  loginWindow.on('page-title-updated', (event) => event.preventDefault());

  // 登录页(直播首页)可能自动播放带声音的直播流,默认禁音避免打扰
  loginWindow.webContents.setAudioMuted(true);

  const loginSession = loginWindow.webContents.session;
  loginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const openExternal = (url, scope) => {
    if (isAllowedExternal(url)) {
      Promise.resolve(shell.openExternal(url)).catch((error) => writeLog(scope, error));
    }
  };

  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLoginNavigation(url, config.allowedHosts)) {
      loginWindow.loadURL(url).catch((error) => writeLog('bilibili-login-navigation', error));
    } else {
      openExternal(url, 'bilibili-login-external');
    }
    return { action: 'deny' };
  });

  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedLoginNavigation(url, config.allowedHosts)) return;
    event.preventDefault();
    openExternal(url, 'bilibili-login-external');
  });

  let cookieSaveTimer = null;
  let loginCheckTimer = null;
  let loginCheckInFlight = false;
  let loginCloseRequested = false;
  let cookieSaveJob = Promise.resolve();

  const scheduleCookieSave = () => {
    clearTimeout(cookieSaveTimer);
    cookieSaveTimer = setTimeout(() => {
      cookieSaveJob = cookieSaveJob.then(() => auth.persistBilibiliCookieSnapshot(dataDir))
        .catch((error) => writeLog('bilibili-cookie-save', error));
    }, 800);
  };

  const checkLoginComplete = async () => {
    if (loginCheckInFlight || loginCloseRequested || loginWindow.isDestroyed()) return;
    loginCheckInFlight = true;
    try {
      const state = await auth.getBilibiliAuthState(dataDir);
      if (state.loggedIn && !loginWindow.isDestroyed()) {
        loginCloseRequested = true;
        writeLog('bilibili-login-auto-close', `${config.name} 登录成功，自动关闭登录窗口`);
        loginWindow.close();
      }
    } catch (_) {
      // The next cookie change or polling tick retries the auth check.
    } finally {
      loginCheckInFlight = false;
    }
  };

  const onCookieChanged = () => {
    scheduleCookieSave();
    checkLoginComplete();
  };
  loginSession.cookies.on('changed', onCookieChanged);

  const cleanup = () => {
    clearTimeout(cookieSaveTimer);
    clearInterval(loginCheckTimer);
    loginSession.cookies.removeListener('changed', onCookieChanged);
    signal?.removeEventListener('abort', cancel);
  };

  const cancel = () => {
    if (!loginWindow.isDestroyed()) loginWindow.destroy();
  };

  loginWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (isMainFrame === false) return;
    logBilibiliDiagnostic('login-load-failed', { errorCode });
    writeLog('bilibili-login-load-failure', { errorCode, errorDescription });
    cleanup();
    if (!loginWindow.isDestroyed()) {
      loginWindow.destroy();
    }
  });

  const completion = new Promise((resolve) => {
    loginWindow.once('closed', async () => {
      cleanup();
      await cookieSaveJob;
      let snapshot = null;
      try {
        if (!signal?.aborted) snapshot = await auth.persistBilibiliCookieSnapshot(dataDir);
      } catch (error) {
        writeLog('bilibili-cookie-save', error);
      }
      let state = { loggedIn: false };
      try {
        state = await auth.getBilibiliAuthState(dataDir);
      } catch (error) {
        writeLog('bilibili-auth-state', error);
      }
      logBilibiliDiagnostic('login-closed', {
        ...summarizeAuthState(state),
        autoClosed: loginCloseRequested,
        snapshotSaved: snapshot !== null,
      });
      resolve({
        snapshot,
        state,
      });
    });
  });

  signal?.addEventListener('abort', cancel, { once: true });
  onWindowReady(loginWindow);
  if (signal?.aborted) {
    cancel();
    return completion;
  }

  try {
    await loginWindow.loadURL(config.loginUrl);
  } catch (error) {
    logBilibiliDiagnostic('login-navigation-failed');
    cleanup();
    if (!loginWindow.isDestroyed()) loginWindow.destroy();
    await completion;
    if (signal?.aborted) return completion;
    throw error;
  }

  if (!loginWindow.isDestroyed()) {
    loginCheckTimer = setInterval(checkLoginComplete, 1500);
  }
  return completion;
}

module.exports = { openBilibiliLoginWindow };
