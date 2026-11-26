'use strict';

const { isAllowedLoginNavigation, isAllowedExternal } = require('./external-url-policy');

async function openLoginWindow({
  BrowserWindow, shell, config, mainWindow, title, signal,
  persistCookies, getSessionState, getAuthState, scope,
  writeLog = () => {}, onWindowReady = () => {}, onEvent = () => {}, muted = false,
}) {
  onEvent('open');
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

  if (muted) loginWindow.webContents.setAudioMuted(true);

  const loginSession = loginWindow.webContents.session;
  loginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const openExternal = (url, scope) => {
    if (isAllowedExternal(url)) {
      Promise.resolve(shell.openExternal(url)).catch((error) => writeLog(scope, error));
    }
  };

  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLoginNavigation(url, config.allowedHosts)) {
      loginWindow.loadURL(url).catch((error) => writeLog(`${scope}-login-navigation`, error));
    } else {
      openExternal(url, `${scope}-login-external`);
    }
    return { action: 'deny' };
  });

  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedLoginNavigation(url, config.allowedHosts)) return;
    event.preventDefault();
    openExternal(url, `${scope}-login-external`);
  });
  loginWindow.webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame === false) return;
    if (!isAllowedLoginNavigation(url, config.allowedHosts)) event.preventDefault();
  });

  let cookieSaveTimer = null;
  let loginCheckTimer = null;
  let loginCheckInFlight = false;
  let loginCloseRequested = false;
  let cookieSaveJob = Promise.resolve();

  const scheduleCookieSave = () => {
    clearTimeout(cookieSaveTimer);
    cookieSaveTimer = setTimeout(() => {
      cookieSaveJob = cookieSaveJob
        .then(() => persistCookies())
        .catch((error) => writeLog(`${scope}-cookie-save`, error));
    }, 800);
  };

  const checkLoginComplete = async () => {
    if (loginCheckInFlight || loginCloseRequested || loginWindow.isDestroyed()) return;
    loginCheckInFlight = true;
    try {
      const state = await getSessionState();
      if (state.loggedIn && !loginWindow.isDestroyed()) {
        loginCloseRequested = true;
        writeLog(`${scope}-login-auto-close`, `${config.name} 登录成功，自动关闭登录窗口`);
        loginWindow.close();
      }
    } catch (_) {
      // The next cookie change or polling tick retries the auth check.
      return;
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
    onEvent('load-failed', { errorCode });
    writeLog(`${scope}-login-load-failure`, { errorCode, errorDescription });
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
        if (!signal?.aborted) snapshot = await persistCookies();
      } catch (error) {
        writeLog(`${scope}-cookie-save`, error);
      }
      let state = { loggedIn: false };
      try {
        state = await getAuthState();
      } catch (error) {
        writeLog(`${scope}-auth-state`, error);
      }
      onEvent('closed', {
        state,
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
    cleanup();
    if (!loginWindow.isDestroyed()) loginWindow.destroy();
    const result = await completion;
    if (signal?.aborted || (loginCloseRequested && result.state.loggedIn)) return result;
    onEvent('navigation-failed');
    throw error;
  }

  if (!loginWindow.isDestroyed()) {
    loginCheckTimer = setInterval(checkLoginComplete, 1500);
  }
  return completion;
}

module.exports = { openLoginWindow };
