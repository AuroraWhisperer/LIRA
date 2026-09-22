'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('./helpers/admin-html');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('礼物姬 owns frame toggle, threshold, motion controls, preview, and overlay address', () => {
  const html = readAdminHtml();
  const moduleSource = read('public/js/admin/gift-frame.js');
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(html, /id="otherGiftFeature"[^>]+data-other-feature-panel[\s\S]*?id="giftFrameEnabled"/);
  assert.match(html, /id="giftFrameThresholdRmb"[^>]+type="number"/);
  assert.match(html, /id="giftFrameTheme"/);
  assert.match(html, /id="giftFrameMotionMode"/);
  assert.match(html, /id="giftFramePreviewBtn"/);
  assert.match(html, /id="giftFrameOverlayUrl"/);
  assert.match(moduleSource, /\/api\/settings/);
  assert.match(moduleSource, /\/api\/gifts\/frame\/preview/);
  assert.match(moduleSource, /app:settings-state/);
  assert.match(moduleSource, /giftFrameEnabled/);
  assert.match(styles, /\.gift-frame-settings-card/);
});
