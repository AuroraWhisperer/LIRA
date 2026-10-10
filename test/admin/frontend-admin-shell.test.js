'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '../..');

test('toast stack stays below the top application bar', () => {
  const layoutStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'layout.css'), 'utf8');
  const toastStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'toasts', 'system.css'), 'utf8');
  const topbarHeight = Number(layoutStyles.match(/\.topbar\s*\{[\s\S]*?min-height:\s*(\d+)px/)?.[1]);
  const toastOffset = Number(toastStyles.match(/\.toast-stack\s*\{[\s\S]*?top:\s*(\d+)px/)?.[1]);

  assert.ok(topbarHeight > 0, 'top application bar height should remain defined');
  assert.ok(toastOffset > topbarHeight, 'toast stack should clear the top application bar');
});

test('queue headers expose one count for each queue', () => {
  const html = readAdminHtml();
  const tags = [...html.matchAll(/<[^/!][^>]*>/g)].map(([tag]) => tag);
  for (const counterId of ['superChatSize', 'queueSize']) {
    assert.equal(tags.filter((tag) => new RegExp(`\\sid\\s*=\\s*["']${counterId}["']`).test(tag)).length, 1);
  }
});

test('point-song subviews rely on tabs instead of repeated page headings', () => {
  const html = readAdminHtml();
  const views = [
    'songsPage',
    'settingsPage',
    'themePage',
    'displayPage',
    'overlayPage',
    'importPage',
    'desktopLyricPage',
  ];

  for (const id of views) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /class="song-subview-header"/);
  assert.doesNotMatch(html, /<h2 class="ui-page-title">(?:歌库|设置|点歌板|展示板|浏览器源|歌单导入导出|桌面歌词)<\/h2>/);
});

test('SuperChat clear control lives in the SC queue header', () => {
  const queueShell = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'song', 'shell-start.html'),
    'utf8',
  );
  const importPage = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'song', 'import-export.html'),
    'utf8',
  );
  const scPanel = queueShell.match(/<section\b(?=[^>]*\sclass=["'][^"']*\bsc-queue-panel\b)[^>]*>[\s\S]*?<\/section>/)?.[0];

  assert.ok(scPanel, 'SC queue panel should remain present');
  const buttons = [...scPanel.matchAll(/<button\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\sid=["']clearSuperChatsBtn["']/.test(tag));
  assert.equal(buttons.length, 1);
  assert.match(buttons[0], /\stype=["']button["']/);
  assert.doesNotMatch(importPage, /id="clearSuperChatsBtn"/);
});

test('toolbox features and performance controls remain connected to the actual page', () => {
  const html = readAdminHtml();
  const performanceHtml = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'toolbox', 'performance.html'),
    'utf8',
  );

  assert.doesNotMatch(html, /data-tab="performancePage"/);
  assert.doesNotMatch(html, /id="performancePage"/);
  const tags = [...html.matchAll(/<[^/!][^>]*>/g)].map(([tag]) => tag);
  for (const featureId of [
    'otherOvertimeMachineFeature', 'otherDailyTodoFeature', 'otherStartAnimationFeature',
    'otherPerformanceFeature', 'otherSettingsFeature', 'otherUsageGuideFeature', 'otherDesktopUpdateFeature',
  ]) {
    const controls = tags.filter((tag) => new RegExp(`\\sdata-other-feature=["']${featureId}["']`).test(tag));
    const panels = tags.filter((tag) => new RegExp(`\\sid=["']${featureId}["']`).test(tag));
    assert.equal(controls.length, 1, featureId);
    assert.match(controls[0], /^<button\b/);
    assert.equal(panels.length, 1, featureId);
    assert.match(panels[0], /\sdata-other-feature-panel(?:\s|>)/);
  }
  assert.match(html, /<[^>]+(?=[^>]*\sid=["']licenseAccountDevice["'])(?=[^>]*\shidden(?:\s|>))[^>]*>/);
  assert.doesNotMatch(performanceHtml, /<input|metricsToggle/);
  assert.match(performanceHtml, /<[^>]+(?=[^>]*\sid=["']metricsCountdown["'])(?=[^>]*\srole=["']timer["'])(?=[^>]*\saria-label=["'][^"']+["'])[^>]*>/);
  for (const id of ['metricsCountdownValue', 'metricsStatus', 'metricsRefreshBtn', 'desktopCheckUpdateBtn', 'desktopVersionPill']) {
    assert.equal(tags.filter((tag) => new RegExp(`\\sid=["']${id}["']`).test(tag)).length, 1, id);
  }
  assert.match(performanceHtml, /<button\b(?=[^>]*\sid=["']metricsRefreshBtn["'])[^>]*>/);
});
