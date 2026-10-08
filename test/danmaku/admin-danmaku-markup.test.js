'use strict';

// Static Admin markup checks for the danmaku tool. Interaction runs in the
// browser group (frontend-admin-danmaku.test.js); these unique entries, form
// semantics and composition boundaries need no browser and run offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { DANMAKU_STYLE_OPTIONS } = require('../../src/shared/danmaku-style-options');

const ROOT_DIR = path.join(__dirname, '../..');
const toolSource = () => fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'), 'utf8');

test('admin danmaku input has no fixed character limit and reply bot toggles are labelled', () => {
  const html = readAdminFragmentHtml('pages/admin/toolbox/danmaku.html');
  assert.doesNotMatch(html, /id="danmakuMessage"[^>]*maxlength=/);
  for (const name of ['Reply', 'Checkin', 'Fortune', 'CustomReply']) {
    assert.match(html, new RegExp(`id="danmaku${name}Toggle"[^>]*aria-labelledby="danmaku${name}Title"`));
  }
  assert.match(html, /id="dailyBotRefresh"/);
  assert.match(toolSource(), /initDanmakuDailyBots/, 'daily check-in and fortune controls mount from the danmaku tool');
});

test('danmaku tool separates the fixed live overlay from the sender and reply groups', () => {
  const html = readAdminFragmentHtml('pages/admin/toolbox/danmaku.html');
  const source = toolSource();
  const connectionSection =
    html.match(/<section\b[^>]*class="danmaku-feature-section danmaku-connection-section"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(connectionSection, /id="danmakuConnectionTitle"/);
  assert.match(connectionSection, /id="danmakuRefreshBtn"/);
  const headingHtml = html.replace(/<svg\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>/g, '');
  assert.ok(/id="danmakuStyleTitle">[^<]*<lira-help/.test(headingHtml), 'the overlay title carries its help entry');
  for (const id of ['danmakuOverlayUrl', 'danmakuCopyOverlayUrlBtn', 'danmakuOpenOverlayBtn', 'danmakuPreviewOverlayBtn',
    'danmakuApplyOverlayBtn', 'danmakuReloadOverlayBtn']) {
    assert.equal(html.split(`id="${id}"`).length, 2, `${id} is one unique entry`);
  }
  const styleOptions = [...html.matchAll(/<button\b[^>]*\sdata-danmaku-style="([^"]+)"[^>]*>/g)].map(([, style]) => style);
  // Moonlit is retained for imported/legacy scenes, outside the built-in picker.
  const builtInStyles = Object.keys(DANMAKU_STYLE_OPTIONS).filter((style) => style !== 'moonlit');
  assert.deepEqual(styleOptions.sort(), builtInStyles.sort());
  assert.match(html, /<button\b(?=[^>]*\sdata-danmaku-style="signal")(?=[^>]*\saria-pressed="true")[^>]*>/);
  for (const group of ['Fixed', 'Random', 'Floating']) {
    const tab = `danmaku${group}StyleTab`;
    const panel = `danmaku${group}Styles`;
    assert.match(html, new RegExp(`<button\\b[^>]*id="${tab}"[^>]*role="tab"[^>]*aria-controls="${panel}"`));
    assert.match(html, new RegExp(`<section\\b[^>]*id="${panel}"[^>]*role="tabpanel"[^>]*aria-labelledby="${tab}"`));
  }
  assert.match(html, /id="danmakuStyleSaveState"[^>]+role="status"[^>]+aria-live="polite"[^>]*><\/p>/);
  assert.match(html, /id="danmakuFullscreenDurationSeconds"[^>]+type="number"[^>]+min="2"[^>]+max="30"[^>]+step="1"/);
  assert.match(html, /id="danmakuFullscreenDurationField"[^>]+hidden/);
  assert.doesNotMatch(html, /id="danmakuStylePreview(?:Frame)?"/);

  const styleSectionStart = html.indexOf('class="danmaku-feature-section danmaku-style-section"');
  const composeSectionStart = html.indexOf('class="danmaku-feature-section danmaku-compose-section"');
  assert.ok(styleSectionStart >= 0 && html.indexOf('</section>', styleSectionStart) < composeSectionStart);
  const aiSection = html.indexOf('id="xiaomiAiSection"');
  assert.ok(html.indexOf('id="danmakuStyleTitle"') < aiSection);
  assert.ok(html.indexOf('id="danmakuSendForm"') < aiSection, 'the AI assistant follows the sender');
  assert.ok(aiSection < html.indexOf('id="danmakuFixedReplyTitle"'));
  assert.ok(aiSection < html.indexOf('id="danmakuCustomRepliesPanel"'), 'the AI assistant precedes fixed replies');
  const fixedReplySectionStart = html.indexOf('class="danmaku-feature-section danmaku-fixed-reply-section"');
  assert.ok(fixedReplySectionStart < html.indexOf('id="danmakuReplyTitle"'));
  assert.ok(html.indexOf('id="danmakuReplyTitle"') < html.indexOf('</section>', fixedReplySectionStart));
  assert.match(html,
    /class="danmaku-feature-section danmaku-connection-section"[\s\S]*?id="danmakuAccountState"[\s\S]*?id="danmakuRoomState"[\s\S]*?id="danmakuToolStatus"/);
  assert.match(html, /class="danmaku-feature-section danmaku-compose-section"[\s\S]*?id="danmakuSendForm"[\s\S]*?id="danmakuSendResult"/);
  assert.match(html, /id="danmakuCounter"[\s\S]*?id="danmakuAutoBtn"[\s\S]*?id="danmakuSendBtn"/);

  // The Admin tool configures the server-owned overlay; it never renders or saves the style locally.
  assert.doesNotMatch(source, /createDanmakuFeed/);
  assert.match(source, /initDanmakuOverlaySettings/);
  assert.doesNotMatch(source, /localOverlayOrigin/);
  assert.doesNotMatch(source, /saveSetting\('danmakuOverlayStyle'/);
});
