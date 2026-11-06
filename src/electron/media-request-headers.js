'use strict';

const registrations = new WeakMap();

function configureMediaRequestHeaders(desktopSession, requestAuth = null) {
  const previous = registrations.get(desktopSession);
  if (previous?.requestAuth === requestAuth) return previous.dispose;
  previous?.dispose();
  desktopSession.webRequest.onBeforeSendHeaders(
    {
      urls: requestAuth
        ? ['<all_urls>']
        : [
            '*://*.music.163.com/*',
            '*://*.music.126.net/*',
            '*://*.qqmusic.qq.com/*',
            '*://*.gtimg.cn/*',
            '*://*.y.qq.com/*',
            '*://*.bilibili.com/*',
            '*://*.hdslb.com/*',
          ],
    },
    function (details, callback) {
      const headers = { ...details.requestHeaders };
      let host = '';
      try {
        host = new URL(details.url).hostname.toLowerCase();
      } catch (_) {
        host = '';
      }
      const matches = (domain) => host === domain || host.endsWith(`.${domain}`);
      if (matches('music.163.com') || matches('music.126.net')) {
        if (!headers.Referer && !headers.referer) {
          headers.Referer = 'https://music.163.com/';
        }
      } else if (matches('qqmusic.qq.com') || matches('gtimg.cn') || matches('y.qq.com')) {
        if (!headers.Referer && !headers.referer) {
          headers.Referer = 'https://y.qq.com/';
        }
        if (!headers.Origin && !headers.origin) {
          headers.Origin = 'https://y.qq.com';
        }
      } else if (matches('bilibili.com') || matches('hdslb.com')) {
        if (!headers.Referer && !headers.referer) {
          headers.Referer = 'https://www.bilibili.com/';
        }
        if (!headers.Origin && !headers.origin) {
          headers.Origin = 'https://www.bilibili.com';
        }
      }
      requestAuth?.applyHeaders(details, headers);
      callback({ requestHeaders: headers });
    },
  );
  if (requestAuth) {
    desktopSession.webRequest.onCompleted(requestAuth.completeRequest);
    desktopSession.webRequest.onErrorOccurred(requestAuth.completeRequest);
  }
  function dispose() {
    if (registrations.get(desktopSession)?.dispose !== dispose) return;
    registrations.delete(desktopSession);
    desktopSession.webRequest.onBeforeSendHeaders(null);
    if (requestAuth) {
      desktopSession.webRequest.onCompleted(null);
      desktopSession.webRequest.onErrorOccurred(null);
    }
  }
  registrations.set(desktopSession, { requestAuth, dispose });
  return dispose;
}

module.exports = {
  configureMediaRequestHeaders,
};
