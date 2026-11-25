'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { servePageOrAsset } = require('../../src/server/page-assets');
const { DEFAULT_CLIENT_THEME_ID } = require('../../src/shared/client-theme');

function createDesktopEditorPage(directory, body, editorStyles) {
  const styles = [
    'styles-base', 'components/drawer', 'admin/layout', 'components/confirmation-dialog',
    'components/select-menu', 'components/contextual-help', 'components/color-control',
    'components/parameter-range', 'components/switch-control', 'admin/toasts/system', 'admin/rich-text-toolbar',
    'admin/toolbox/shell', 'admin/toolbox/danmaku-tool', ...editorStyles,
  ];
  const links = styles.map(name => `<link rel="stylesheet" href="/css/${name}.css">`).join('\n');
  fs.writeFileSync(path.join(directory, 'editor.html'), `<!doctype html>
    <html lang="zh-CN" data-client-theme="${DEFAULT_CLIENT_THEME_ID}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">${links}</head>
    <body style="display:block;overflow:auto;padding:24px">${body}
    <script type="module" src="/js/admin/index.js"></script></body></html>`);
  // Serve only this document at /admin, through the production HTML auth and frame policy.
  return (req, res, url, token) => servePageOrAsset(directory, req, res, new URL('/editor.html', url), token);
}

module.exports = { createDesktopEditorPage };
