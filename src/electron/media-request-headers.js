'use strict';

function configureMediaRequestHeaders(desktopSession, state) {
  if (state.headersConfigured) return;
  state.headersConfigured = true;
  desktopSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
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
      } else if (
        matches('qqmusic.qq.com') ||
        matches('gtimg.cn') ||
        matches('y.qq.com')
      ) {
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
      callback({ requestHeaders: headers });
    },
  );
}

module.exports = {
  configureMediaRequestHeaders,
};
