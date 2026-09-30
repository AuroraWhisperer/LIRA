'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readAdminFragment } = require('./admin-page');

const FRAGMENTS = Object.freeze({ danmaku: 'toolbox/danmaku', clock: 'toolbox/clock',
  queue: 'song/queue-theme', overtime: 'toolbox/overtime' });

function composeComponentPreviewHtml(publicDir, component) {
  const shell = fs.readFileSync(path.join(publicDir, 'pages/component-preview.html'), 'utf8');
  const fragment = !component || Object.hasOwn(FRAGMENTS, component)
    ? Object.values(FRAGMENTS).map((name) => readAdminFragment(publicDir, `pages/admin/${name}.html`)).join('\n') : '';
  return shell.replace('<!-- component-preview-template -->', fragment);
}

module.exports = { composeComponentPreviewHtml };
