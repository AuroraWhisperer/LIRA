'use strict';

const { openLoginWindow } = require('./login-window');
const { logBilibiliDiagnostic, summarizeAuthState } = require('../bilibili/diagnostics');

async function openBilibiliLoginWindow(options = {}) {
  const { BrowserWindow, shell, auth, mainWindow, dataDir, writeLog,
    title = '登录直播账号', signal, onWindowReady } = options;
  if (typeof BrowserWindow !== 'function' || !shell || !auth) {
    throw new Error('Bilibili login window dependencies are required.');
  }
  return openLoginWindow({
    BrowserWindow, shell, config: auth.BILIBILI_LOGIN_CONFIG, mainWindow, title,
    signal, onWindowReady, writeLog, scope: 'bilibili', muted: true,
    persistCookies: () => auth.persistBilibiliCookieSnapshot(dataDir),
    getSessionState: () => auth.getBilibiliSessionState
      ? auth.getBilibiliSessionState() : auth.getBilibiliAuthState(dataDir),
    getAuthState: () => auth.getBilibiliAuthState(dataDir),
    onEvent(event, detail = {}) {
      if (event === 'closed') {
        const { state, ...result } = detail;
        logBilibiliDiagnostic('login-closed', { ...summarizeAuthState(state), ...result });
      } else logBilibiliDiagnostic(`login-${event}`, detail);
    },
  });
}

module.exports = { openBilibiliLoginWindow };
