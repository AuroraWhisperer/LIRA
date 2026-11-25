'use strict';

const { ADMIN_PAGE_PATHS } = require('../shared/admin-page-paths');

const { isAllowedExternal, isAllowedLocalUrl } = require('./external-url-policy');
const ADMIN_PATHS = new Set(ADMIN_PAGE_PATHS);

function createDesktopRequestAuth({ desktopSession, getMainWindow, getBaseUrl, getToken }) {
  const attachedTokens = new Map();
  let disposed = false;
  let unbindWindow = () => {};

  function isTrustedRequest(details, target) {
    if (!target || target.username || target.password) return false;
    if (!target.pathname.startsWith('/api/') && !(details.resourceType === 'mainFrame' && ADMIN_PATHS.has(target.pathname))
      && !(details.resourceType === 'webSocket' && target.pathname === '/ws')) return false;
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

  function applyHeaders(details, headers, target = URL.parse(details.url)) {
    const attached = attachedTokens.get(details.id);
    const token = disposed ? '' : getToken();
    let trusted;
    try {
      trusted = Boolean(token) && isTrustedRequest(details, target);
    } catch {
      trusted = false; // A frame can disappear while Chromium is dispatching a request.
    }
    let result = headers;
    // A redirect can carry our bearer to an untrusted destination, even after disposal.
    for (const name in headers) {
      if (
        Object.hasOwn(headers, name) && name.toLowerCase() === 'authorization' &&
        (trusted || (attached && headers[name] === `Bearer ${attached}`) || (token && headers[name] === `Bearer ${token}`))
      ) {
        if (result === headers) result = { ...headers };
        delete result[name];
      }
    }
    if (!trusted) return result;
    attachedTokens.set(details.id, token);
    if (result === headers) result = { ...headers };
    result.Authorization = `Bearer ${token}`;
    return result;
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
      const openExternal = (url) => {
        Promise.resolve(shell.openExternal(url)).catch(() => {
          console.warn('[Desktop] failed to open the external browser.');
        });
      };
      const navigate = (event, url) => {
        if (policy.isAllowedNavigation(url)) return;
        event.preventDefault();
        if (isAllowedExternal(url) || isAllowedLocalUrl(url)) openExternal(url);
      };
      const redirect = (event, url) => {
        if (!policy.isAllowedNavigation(url)) event.preventDefault();
      };
      contents.setWindowOpenHandler(({ url }) => {
        if (isAllowedExternal(url) || isAllowedLocalUrl(url)) openExternal(url);
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
