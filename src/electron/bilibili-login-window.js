'use strict';

async function openBilibiliLoginWindow(options = {}) {
  const {
    BrowserWindow,
    shell,
    auth,
    mainWindow,
    dataDir,
    writeLog = () => {}
  } = options;
  if (typeof BrowserWindow !== 'function' || !shell || !auth) {
    throw new Error('Bilibili login window dependencies are required.');
  }

  const config = auth.BILIBILI_LOGIN_CONFIG;
  const loginWindow = new BrowserWindow({
    width: 1000, height: 720,
    title: `登录${config.name}`,
    parent: mainWindow || undefined,
    modal: false, show: true,
    webPreferences: {
      partition: config.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  const loginSession = loginWindow.webContents.session;
  loginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const openExternal = (url, scope) => {
    Promise.resolve(shell.openExternal(url)).catch((error) => writeLog(scope, error));
  };

  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (auth.isAllowedBilibiliLoginUrl(url)) {
      loginWindow.loadURL(url).catch((error) => writeLog('bilibili-login-navigation', error));
    } else {
      openExternal(url, 'bilibili-login-external');
    }
    return { action: 'deny' };
  });

  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (auth.isAllowedBilibiliLoginUrl(url)) return;
    event.preventDefault();
    openExternal(url, 'bilibili-login-external');
  });

  let cookieSaveTimer = null;
  let loginCheckTimer = null;
  let loginCheckInFlight = false;
  let loginCloseRequested = false;

  const scheduleCookieSave = () => {
    clearTimeout(cookieSaveTimer);
    cookieSaveTimer = setTimeout(() => {
      auth.persistBilibiliCookieSnapshot(dataDir)
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
  };

  const completion = new Promise((resolve) => {
    loginWindow.once('closed', async () => {
      cleanup();
      let snapshot = null;
      try {
        snapshot = await auth.persistBilibiliCookieSnapshot(dataDir);
      } catch (error) {
        writeLog('bilibili-cookie-save', error);
      }
      let state = { loggedIn: false };
      try {
        state = await auth.getBilibiliAuthState(dataDir);
      } catch (error) {
        writeLog('bilibili-auth-state', error);
      }
      resolve({
        snapshot,
        state
      });
    });
  });

  try {
    await loginWindow.loadURL(config.loginUrl);
  } catch (error) {
    cleanup();
    if (!loginWindow.isDestroyed()) loginWindow.destroy();
    throw error;
  }

  if (!loginWindow.isDestroyed()) {
    loginCheckTimer = setInterval(checkLoginComplete, 1500);
  }
  return completion;
}

module.exports = { openBilibiliLoginWindow };
