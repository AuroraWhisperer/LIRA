'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readAdminFragment } = require('./admin-page');
const { SCENE_EXTRA_COMPONENTS } = require('../../public/js/shared/scene-extra-components.js');

const COMPONENT_PREVIEW_FRAGMENTS = Object.freeze({ danmaku: 'live-components/danmaku', clock: 'toolbox/clock',
  queue: 'song/queue-theme', overtime: 'toolbox/overtime',
  ...Object.fromEntries(Object.keys(SCENE_EXTRA_COMPONENTS).map((type) => [type, null])), 'text-box': null, browser: null });
let composed;

function composeComponentPreviewHtml(publicDir, component) {
  const includeFragments = !component || Object.hasOwn(COMPONENT_PREVIEW_FRAGMENTS, component);
  if (composed?.publicDir === publicDir && includeFragments) return composed.html;
  const shell = fs.readFileSync(path.join(publicDir, 'pages/component-preview.html'), 'utf8');
  const fragment = includeFragments
    ? Object.values(COMPONENT_PREVIEW_FRAGMENTS).filter(Boolean).map((name) => readAdminFragment(publicDir, `pages/admin/${name}.html`)).join('\n') : '';
  const html = shell.replace('<!-- component-preview-template -->', fragment);
  if (includeFragments) composed = { publicDir, html };
  return html;
}

module.exports = { composeComponentPreviewHtml, COMPONENT_PREVIEW_FRAGMENTS };
