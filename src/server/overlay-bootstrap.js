'use strict';

// Serialized into overlay HTML only. The supplied capability never authorizes
// administration or another overlay. Keep this function browser self-contained.
function overlayBootstrap(token) {
  window.__API_TOKEN__ = token;
  const originalFetch = window.fetch;
  const NativeWebSocket = window.WebSocket;
  let checking = null;
  let reloading = false;
  let unloading = false;

  function localUrl(input, socket) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url || input.href, location.href);
      const protocol = socket ? (location.protocol === 'https:' ? 'wss:' : 'ws:') : location.protocol;
      return url.host === location.host && url.protocol === protocol &&
        (socket ? url.pathname === '/ws' : url.pathname.startsWith('/api/')) ? url : null;
    } catch (_) { return null; }
  }

  function recoverSession() {
    if (checking || reloading || unloading) return;
    const controller = new AbortController();
    checking = controller;
    const timer = setTimeout(() => controller.abort(), 5000);
    originalFetch.call(window, '/api/state', {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
    }).then((response) => response.status === 401).catch(() => false).then((expired) => {
      if (expired && !unloading) { reloading = true; location.reload(); }
    }).finally(() => { clearTimeout(timer); checking = null; });
  }

  window.addEventListener('pagehide', () => {
    unloading = true;
    checking?.abort();
  }, { once: true });

  window.fetch = function (input, options) {
    const url = localUrl(input, false);
    if (url && url.pathname !== '/api/health') {
      const headers = new Headers(options?.headers || input?.headers);
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      options = { ...options, headers };
    }
    const pending = originalFetch.call(this, input, options);
    return url ? pending.then((response) => {
      if (response.status === 401) recoverSession();
      return response;
    }) : pending;
  };

  window.WebSocket = function (input, protocols) {
    const url = localUrl(input, true);
    if (url && !url.searchParams.has('token')) url.searchParams.set('token', token);
    const socket = protocols === undefined
      ? new NativeWebSocket(url ? url.href : input)
      : new NativeWebSocket(url ? url.href : input, protocols);
    if (url) socket.addEventListener('close', recoverSession);
    return socket;
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
  for (const name of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'])
    window.WebSocket[name] = NativeWebSocket[name];
}

function createOverlayBootstrap(token) {
  return `<script id="lira-overlay-bootstrap">(${overlayBootstrap.toString()})(${JSON.stringify(token)});</script>\n`;
}

module.exports = { createOverlayBootstrap };
