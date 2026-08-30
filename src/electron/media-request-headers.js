'use strict';

function configureMusicMediaRequestHeaders(desktopSession, state) {
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
      if (host.endsWith('music.163.com') || host.endsWith('music.126.net')) {
        if (!headers.Referer && !headers.referer) {
          headers.Referer = 'https://music.163.com/';
        }
      } else if (
        host.endsWith('qqmusic.qq.com') ||
        host.endsWith('gtimg.cn') ||
        host.endsWith('y.qq.com')
      ) {
        if (!headers.Referer && !headers.referer) {
          headers.Referer = 'https://y.qq.com/';
        }
        if (!headers.Origin && !headers.origin) {
          headers.Origin = 'https://y.qq.com';
        }
      }
      callback({ requestHeaders: headers });
    },
  );
}

function configureBilibiliMediaRequestHeaders(desktopSession) {
  desktopSession.webRequest.onBeforeSendHeaders(
    {
      urls: ['*://*.bilibili.com/*', '*://*.hdslb.com/*'],
    },
    function (details, callback) {
      const headers = { ...details.requestHeaders };
      let host = '';
      try {
        host = new URL(details.url).hostname.toLowerCase();
      } catch (_) {
        host = '';
      }
      if (host.endsWith('bilibili.com') || host.endsWith('hdslb.com')) {
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
  configureMusicMediaRequestHeaders,
  configureBilibiliMediaRequestHeaders,
};
