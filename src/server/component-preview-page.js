'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readAdminFragment } = require('./admin-page');
const { SCENE_EXTRA_COMPONENTS } = require('../../public/js/shared/scene-extra-components.js');

const COMPONENT_PREVIEW_FRAGMENTS = Object.freeze({ danmaku: 'toolbox/danmaku', clock: 'toolbox/clock',
  queue: 'song/queue-theme', overtime: 'toolbox/overtime',
  ...Object.fromEntries(Object.keys(SCENE_EXTRA_COMPONENTS).map((type) => [type, null])), 'text-box': null, browser: null });

function composeComponentPreviewHtml(publicDir, component) {
  const shell = fs.readFileSync(path.join(publicDir, 'pages/component-preview.html'), 'utf8');
  const fragment = !component || Object.hasOwn(COMPONENT_PREVIEW_FRAGMENTS, component)
    ? Object.values(COMPONENT_PREVIEW_FRAGMENTS).filter(Boolean).map((name) => readAdminFragment(publicDir, `pages/admin/${name}.html`)).join('\n') : '';
  return shell.replace('<!-- component-preview-template -->', fragment);
}

module.exports = { composeComponentPreviewHtml, COMPONENT_PREVIEW_FRAGMENTS };
