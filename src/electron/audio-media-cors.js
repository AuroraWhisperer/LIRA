'use strict';

const { hasExactOrigin } = require('./local-media-access');
const MEDIA_DOMAINS = ['qqmusic.qq.com', 'music.tc.qq.com', 'aqqmusic.tc.qq.com', 'music.126.net', 'music.163.com'];

function configureAudioMediaCors(desktopSession, { getMainWindow, getDesktopBaseUrl }) {
  desktopSession.webRequest.onHeadersReceived({ urls: MEDIA_DOMAINS.map(domain => `*://*.${domain}/*`) }, (details, callback) => {
    const window = getMainWindow();
    let target;
    try { target = new URL(details.url); } catch { callback({}); return; }
    if (!window || window.isDestroyed() || details.webContentsId !== window.webContents.id
      || details.frame !== window.webContents.mainFrame || !hasExactOrigin(details.frame?.url, getDesktopBaseUrl())
      || details.resourceType !== 'media' || details.method !== 'GET'
      || !MEDIA_DOMAINS.some(domain => target.hostname === domain || target.hostname.endsWith(`.${domain}`))) {
      callback({});
      return;
    }
    const headers = Object.fromEntries(Object.entries(details.responseHeaders || {})
      .filter(([key]) => key.toLowerCase() !== 'access-control-allow-origin'));
    headers['Access-Control-Allow-Origin'] = [new URL(getDesktopBaseUrl()).origin];
    callback({ responseHeaders: headers });
  });
}

module.exports = { configureAudioMediaCors };
