'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('../helpers/admin-html');

const ROOT_DIR = path.join(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('礼物姬 owns effect 1 trigger settings and opens its canvas preview', () => {
  const html = readAdminHtml();
  const moduleSource = read('public/js/admin/gift-frame.js');

  assert.match(html, /id="otherGiftFeature"[^>]+data-other-feature-panel[\s\S]*?id="giftFrameEnabled"/);
  assert.match(html, /<input\b(?=[^>]*\sid="giftFrameThresholdRmb")(?=[^>]*\stype="number")[^>]*>/);
  assert.match(html, /特效 1 · 林间花信/);
  assert.match(html, /最多等待 50 条/);
  assert.doesNotMatch(html, /id="giftFrame(?:Theme|MotionMode|PreviewAmount)"/);
  assert.match(html, /id="giftFramePreviewBtn"/);
  for (const field of ['PreviewUser', 'PreviewGift', 'PreviewNum']) {
    assert.match(html, new RegExp(`id="giftFrame${field}"`));
  }
  assert.doesNotMatch(html, /id="giftFrame(?:OverlayUrl|OpenBtn|CopyBtn)"/);
  assert.match(moduleSource, /\/api\/settings/);
  assert.match(moduleSource, /openComponentPreview\(\{ id: 'gift-frame', previewData \}\)/);
  assert.doesNotMatch(moduleSource, /\/api\/gifts\/frame\/preview/);
  assert.match(moduleSource, /app:settings-state/);
  assert.match(moduleSource, /giftFrameEnabled/);
});

test('礼物姬 hosts effect 2 beside effect 1 with its own switch, threshold and preview', () => {
  const html = readAdminHtml();
  const moduleSource = read('public/js/admin/gift-frame.js');

  assert.match(html, /id="giftFramePanel"[^>]+class="gift-frame-effects"[^>]*>[\s\S]*?data-gift-frame-effect="woodland-bloom"/);
  assert.match(html, /特效 2 · 缎带礼笺/);
  assert.match(html, /data-gift-frame-effect="satin-ribbon"/);
  assert.match(html, /<input\b(?=[^>]*\sid="giftFrameRibbonEnabled")(?=[^>]*\stype="checkbox")[^>]*>/);
  assert.match(html, /<input\b(?=[^>]*\sid="giftFrameRibbonThresholdRmb")(?=[^>]*\stype="number")[^>]*>/);
  assert.match(html, /id="giftFrameRibbonSaveBtn"/);
  assert.match(html, /id="giftFrameRibbonPreviewBtn"/);
  assert.match(html, /id="giftFrameRibbonSaveState"/);
  for (const field of ['PreviewUser', 'PreviewGift', 'PreviewNum']) {
    assert.match(html, new RegExp(`id="giftFrameRibbon${field}"`));
  }
  // 分档规则写在帮助提示里，两个特效各自独立保存。
  assert.match(html, /只播放触发金额更高的那个/);
  for (const key of ['giftFrameRibbonEnabled', 'giftFrameRibbonThresholdRmb', "themeId: 'satin-ribbon'"]) {
    assert.match(moduleSource, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
