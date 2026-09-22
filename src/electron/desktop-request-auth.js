'use strict';

const { isAllowedExternal, isAllowedLocalUrl } = require('./external-url-policy');
const ADMIN_PATHS = new Set(['/', '/admin', '/settings', '/songs']);

function createDesktopRequestAuth({ desktopSession, getMainWindow, getBaseUrl, getToken }) {
  const attachedTokens = new Map();
  let disposed = false;
  let unbindWindow = () => {};

  function isTrustedRequest(details) {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return false;
    const contents = window.webContents;
    const frame = details.frame;
    const mainFrame = contents.mainFrame;
    if (
      contents.isDestroyed() ||
      details.webContentsId !== contents.id ||
      details.webContents !== contents ||
      contents.session !== desktopSession ||
      !frame ||
      frame.detached ||
      frame.parent ||
      !mainFrame ||
      frame.processId !== mainFrame.processId ||
      !frame.frameToken ||
      frame.frameToken !== mainFrame.frameToken
    )
      return false;

    const base = new URL(getBaseUrl());
    const target = new URL(details.url);
    if (target.username || target.password) return false;
    const sameOrigin = target.origin === base.origin;
    const source = frame.url ? new URL(frame.url) : null;
    const fromAdmin =
      source?.origin === base.origin && frame.origin === base.origin && ADMIN_PATHS.has(source.pathname);
    if (details.resourceType === 'mainFrame') {
      if (sameOrigin && ADMIN_PATHS.has(target.pathname) && (details.method === 'GET' || details.method === 'HEAD')) {
        return (
          fromAdmin ||
          !source ||
          source.href === 'about:blank' ||
          (source.origin === base.origin && frame.origin === base.origin && source.pathname === '/license')
        );
      }
      return fromAdmin && sameOrigin && target.pathname.startsWith('/api/');
    }
    if (!fromAdmin) return false;
    if (sameOrigin && target.pathname.startsWith('/api/')) return true;
    return (
      details.resourceType === 'webSocket' &&
      target.pathname === '/ws' &&
      target.host === base.host &&
      target.protocol === (base.protocol === 'https:' ? 'wss:' : 'ws:')
    );
  }

  function applyHeaders(details, headers) {
    const attached = attachedTokens.get(details.id);
    const token = disposed ? '' : getToken();
    // A redirect can carry the header added to an earlier request leg. Strip
    // it before rechecking the destination and requesting frame, even on dispose.
    for (const name of Object.keys(headers)) {
      if (
        name.toLowerCase() === 'authorization' &&
        ((attached && headers[name] === `Bearer ${attached}`) || (token && headers[name] === `Bearer ${token}`))
      )
        delete headers[name];
    }
    if (!token || disposed) return;
    let trusted = false;
    try {
      trusted = isTrustedRequest(details);
    } catch (error) {
      // A frame can disappear while Chromium is dispatching a request.
      void error;
    }
    if (!trusted) return;
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'authorization') delete headers[name];
    }
    headers.Authorization = `Bearer ${token}`;
    attachedTokens.set(details.id, token);
  }

  const policy = {
    applyHeaders,
    completeRequest: (details) => attachedTokens.delete(details.id),
    isAllowedNavigation(url) {
      try {
        const base = new URL(getBaseUrl());
        const target = new URL(url);
        if (target.origin !== base.origin || target.username || target.password) return false;
        if (ADMIN_PATHS.has(target.pathname) || target.pathname === '/license') return true;
        const source = new URL(getMainWindow().webContents.mainFrame.url);
        return source.origin === base.origin && ADMIN_PATHS.has(source.pathname) && target.pathname.startsWith('/api/');
      } catch (error) {
        void error;
        return false;
      }
    },
    bindWindow(window, shell) {
      unbindWindow();
      const contents = window.webContents;
      const navigate = (event, url) => {
        if (policy.isAllowedNavigation(url)) return;
        event.preventDefault();
        if (isAllowedExternal(url) || isAllowedLocalUrl(url)) shell.openExternal(url);
      };
      const redirect = (event, url) => {
        if (!policy.isAllowedNavigation(url)) event.preventDefault();
      };
      contents.setWindowOpenHandler(({ url }) => {
        if (isAllowedExternal(url) || isAllowedLocalUrl(url)) shell.openExternal(url);
        return { action: 'deny' };
      });
      contents.on('will-navigate', navigate);
      contents.on('will-redirect', redirect);
      unbindWindow = () => {
        contents.removeListener('will-navigate', navigate);
        contents.removeListener('will-redirect', redirect);
        if (!contents.isDestroyed()) contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      };
    },
    dispose() {
      disposed = true;
      unbindWindow();
    },
  };
  return policy;
}

module.exports = { createDesktopRequestAuth };
