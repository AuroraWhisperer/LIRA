'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeClientThemeId } = require('../shared/client-theme');
const { composeAdminHtml, isAdminPageRoute } = require('./admin-page');
const { composeComponentPreviewHtml } = require('./component-preview-page');
const { OVERLAY_PAGES, getOverlayScope, createOverlayToken } = require('./access-policy');
const { createOverlayBootstrap } = require('./overlay-bootstrap');
const { serveStaticVideo } = require('./static-video');
const { sendJson, contentType, verifyToken } = require('./http-utils');

function servePageOrAsset(publicDir, req, res, requestUrl, sessionToken, beginPlaybackSnapshotSession, getClientTheme) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, {
      ok: false,
      error: '请求方法不支持',
      details: '静态资源仅支持 GET 请求',
    });
    return;
  }

  const isAdminPage = isAdminPageRoute(requestUrl.pathname);
  const pageMap = new Map([
    ['/license', 'pages/license.html'],
    ['/scene', 'pages/overlays/scene.html'],
    ['/text-box', 'pages/overlays/text-box.html'],
    ['/background', 'pages/overlays/background.html'],
    ['/imported-danmaku', 'pages/overlays/imported-danmaku.html'],
    ['/component-preview', 'pages/component-preview.html'],
    ['/c', 'pages/component-preview.html'],
    ...Object.entries(OVERLAY_PAGES).map(([scope, file]) => [`/${scope}`, `pages/overlays/${file}`]),
  ]);
  const assetPath = pageMap.get(requestUrl.pathname) || requestUrl.pathname.replace(/^\/+/, '');
  const resolvedPath = isAdminPage
    ? path.join(publicDir, 'pages', 'admin', 'shell-start.html')
    : path.resolve(publicDir, assetPath);
  if (
    assetPath.includes(':') ||
    (!isAdminPage && resolvedPath !== publicDir && !resolvedPath.startsWith(publicDir + path.sep))
  ) {
    sendJson(res, 403, { ok: false, error: 'Forbidden.' });
    return;
  }

  const relativePath = path.relative(publicDir, resolvedPath).replaceAll('\\', '/').toLowerCase();
  const isHtml = path.extname(resolvedPath).toLowerCase() === '.html';
  const overlayScope = getOverlayScope(`/${relativePath}`);
  if (
    isHtml &&
    !overlayScope &&
    relativePath !== 'pages/overlays/scene.html' &&
    relativePath !== 'pages/overlays/text-box.html' &&
    relativePath !== 'pages/overlays/background.html' &&
    relativePath !== 'pages/overlays/imported-danmaku.html' &&
    relativePath !== 'pages/component-preview.html' &&
    relativePath !== 'pages/license.html' &&
    !verifyToken({ sessionToken }, req, requestUrl)
  ) {
    sendJson(res, 401, { ok: false, error: '请从桌面应用打开管理页面。' });
    return;
  }

  const sendContent = (error, content) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: 'Not found.' });
      return;
    }
    let body = content;
    if (isAdminPage || relativePath === 'pages/component-preview.html' || relativePath === 'pages/gift-audit.html') {
      const themeId = normalizeClientThemeId(getClientTheme?.());
      body = Buffer.from(body.toString('utf8').replace(/<html\b([^>]*)>/i, (_tag, attributes) =>
        `<html${attributes.replace(/\sdata-client-theme\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')} data-client-theme="${themeId}">`));
    }
    if (isAdminPage && req.method === 'GET' && beginPlaybackSnapshotSession) {
      const writer = beginPlaybackSnapshotSession();
      const headEnd = body.indexOf(Buffer.from('</head>'));
      const bootstrap = Buffer.from(
        `<script>window.__PLAYBACK_SNAPSHOT_WRITER__=${JSON.stringify(writer)};</script>\n`,
      );
      body = Buffer.concat([body.subarray(0, headEnd), bootstrap, body.subarray(headEnd)]);
    }
    if (overlayScope && sessionToken && requestUrl.searchParams.get('componentPreview') !== '1') {
      const bootstrap = Buffer.from(createOverlayBootstrap(createOverlayToken(sessionToken, overlayScope)));
      const headEnd = body.indexOf(Buffer.from('</head>'));
      if (headEnd !== -1) {
        body = Buffer.concat([body.subarray(0, headEnd), bootstrap, body.subarray(headEnd)]);
      }
    }

    if (isHtml) {
      addFrameProtectionHeaders(res, relativePath === 'pages/overlays/scene.html' ? '/scene'
        : relativePath === 'pages/overlays/text-box.html' ? '/text-box'
        : relativePath === 'pages/overlays/background.html' ? '/background' : overlayScope ? `/${overlayScope}` : requestUrl.pathname);
    } else {
      // Sandboxed overlays have opaque origins. Only public static assets may
      // be read cross-origin; API data and HTML use their own access policy.
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.writeHead(200, {
      'Content-Type': contentType(resolvedPath),
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(body);
    }
  };

  if (relativePath === 'pages/component-preview.html') {
    try {
      sendContent(null, Buffer.from(composeComponentPreviewHtml(publicDir, requestUrl.searchParams.get('component'))));
    } catch (error) {
      sendContent(error);
    }
    return;
  }

  if (isAdminPage) {
    try {
      sendContent(null, Buffer.from(composeAdminHtml(publicDir)));
    } catch (error) {
      sendContent(error);
    }
    return;
  }

  if (path.extname(resolvedPath).toLowerCase() === '.webm') {
    serveStaticVideo(resolvedPath, req, res);
    return;
  }
  fs.readFile(resolvedPath, sendContent);
}

function addFrameProtectionHeaders(res, pathname) {
  if (getOverlayScope(pathname) || ['/scene', '/text-box', '/background', '/imported-danmaku', '/pages/overlays/imported-danmaku.html'].includes(pathname)) {
    // Do not add allow-same-origin: an embedded overlay must not call the
    // privileged parent frame or inherit its credentials.
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
  } else {
    // Chromium can attribute a dedicated worker's fetch to its owning main
    // frame. Management pages have no workers; block their creation explicitly.
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; worker-src 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
  }
}

module.exports = { servePageOrAsset, addFrameProtectionHeaders };
