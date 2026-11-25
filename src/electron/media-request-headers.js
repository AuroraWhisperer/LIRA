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
      const target = URL.parse(details.url);
      const host = target?.hostname.toLowerCase() || '';
      const matches = (domain) => host === domain || host.endsWith(`.${domain}`);
      let headers = details.requestHeaders;
      if (matches('music.163.com') || matches('music.126.net')) {
        headers = { ...headers };
        if (!headers.Referer && !headers.referer) {
          headers.Referer = 'https://music.163.com/';
        }
      } else if (matches('qqmusic.qq.com') || matches('gtimg.cn') || matches('y.qq.com')) {
        headers = { ...headers };
        if (!headers.Referer && !headers.referer) {
          headers.Referer = 'https://y.qq.com/';
        }
        if (!headers.Origin && !headers.origin) {
          headers.Origin = 'https://y.qq.com';
        }
      } else if (matches('bilibili.com') || matches('hdslb.com')) {
        headers = { ...headers };
        if (!headers.Referer && !headers.referer) {
          headers.Referer = 'https://www.bilibili.com/';
        }
        if (!headers.Origin && !headers.origin) {
          headers.Origin = 'https://www.bilibili.com';
        }
      }
      callback({ requestHeaders: requestAuth ? requestAuth.applyHeaders(details, headers, target) : headers });
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
