'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readCssBundle } = require('../helpers/css-bundle');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('toolbox styles load feature-owned stylesheets in order', () => {
  const entry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'toolbox.css'), 'utf8');

  assert.match(entry, /@import url\('\.\/toolbox\/streamer-planner\.css'\);/);
});

test('toolbox defers offscreen rendering in its heaviest panels', () => {
  const usageGuideStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'toolbox', 'usage-guide.css'),
    'utf8',
  );
  const overtimeStyles = readCssBundle('public', 'css', 'admin', 'overtime.css');
  const usageGuideScript = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'usage-guide.js'), 'utf8');

  assert.match(usageGuideStyles, /\.usage-guide-section\s*\{[^}]*content-visibility:\s*auto/);
  assert.match(
    usageGuideStyles,
    /\.usage-guide-render-all \.usage-guide-section\s*\{[^}]*content-visibility:\s*visible/,
  );
  assert.match(usageGuideScript, /panel\.classList\.add\('usage-guide-render-all'\)/);
  assert.match(overtimeStyles, /\.overtime-admin > \.overtime-admin-section\s*\{[^}]*content-visibility:\s*auto/);
});

test('toolbox sidebar exposes an accessible collapse control and reduced-motion fallback', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'toolbox.css');
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\sdata-other-sidebar-toggle(?:\s|>)/.test(tag));
  assert.equal(buttons.length, 1);
  assert.match(buttons[0], /\stype=["']button["']/);
  assert.match(buttons[0], /\saria-expanded=["']true["']/);
  assert.match(buttons[0], /\saria-label=["'][^"']+["']/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.other-sidebar-toggle-state\s*\{[^}]*transition:\s*none/,
  );
});

test('toolbox sidebar groups remaining tools by entertainment, management and support', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'toolbox.css');
  const navigation = html.match(/<nav\b[^>]*class=["']other-feature-menu["'][^>]*>([\s\S]*?)<\/nav\s*>/)?.[1];
  const expectedGroups = [
    [
      'live-interaction',
      '互动娱乐',
      ['otherDanmakuFeature', 'otherDynamicLotteryFeature', 'otherGamesFeature', 'otherGiftEffectsFeature'],
    ],
    ['streamer-work', '日常管理', ['otherFanProfilesFeature', 'otherDailyTodoFeature']],
    [
      'software-help',
      '应用支持',
      ['otherSettingsFeature', 'otherPerformanceFeature', 'otherUsageGuideFeature', 'otherDesktopUpdateFeature'],
    ],
  ];

  assert.ok(navigation, 'toolbox navigation should remain present');
  assert.deepEqual(
    [...navigation.matchAll(/data-other-feature="([^"]+)"/g)].map(([, featureId]) => featureId),
    expectedGroups.flatMap(([, , featureIds]) => featureIds),
    'each remaining tool should appear exactly once in its intended group',
  );

  const headingPositions = expectedGroups.map(([groupId]) =>
    navigation.indexOf(`data-other-feature-group="${groupId}"`),
  );
  assert.deepEqual(
    [...headingPositions].sort((left, right) => left - right),
    headingPositions,
    'workflow groups should keep their intended order',
  );
  assert.ok(
    headingPositions.every((position) => position >= 0),
    'every workflow group should be labeled',
  );

  expectedGroups.forEach(([groupId, label, featureIds], groupIndex) => {
    const groupStart = headingPositions[groupIndex];
    const groupEnd = headingPositions[groupIndex + 1] ?? navigation.length;
    const groupHtml = navigation.slice(groupStart, groupEnd);

    assert.match(groupHtml, new RegExp(`<strong>${label}<\\/strong>`), `${label} should label its workflow group`);
    const featurePositions = featureIds.map((featureId) => groupHtml.indexOf(`data-other-feature="${featureId}"`));
    assert.ok(
      featurePositions.every((position) => position >= 0),
      `${label} should contain its assigned features`,
    );
    assert.deepEqual(
      [...featurePositions].sort((left, right) => left - right),
      featurePositions,
      `${label} features should keep their intended order`,
    );

    for (const [otherGroupId, , otherFeatureIds] of expectedGroups) {
      if (otherGroupId === groupId) continue;
      for (const featureId of otherFeatureIds) {
        assert.doesNotMatch(groupHtml, new RegExp(`data-other-feature="${featureId}"`));
      }
    }
  });

  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-group-heading\s*\{[^}]*overflow:\s*hidden/);
});

test('toolbox group headings remain accessible collapsible buttons', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'toolbox.css');
  const navigation = html.match(/<nav\b[^>]*class=["']other-feature-menu["'][^>]*>([\s\S]*?)<\/nav\s*>/)?.[1];
  const groups = [
    ['live-interaction', '互动娱乐'],
    ['streamer-work', '日常管理'],
    ['software-help', '应用支持'],
  ];

  assert.ok(navigation, 'toolbox navigation should remain present');
  assert.equal((navigation.match(/data-other-feature-group=/g) || []).length, groups.length);

  groups.forEach(([groupId, label]) => {
    const heading = navigation.match(
      new RegExp(
        `<button\\b(?=[^>]*\\sdata-other-feature-group=["']${groupId}["'])[^>]*>`,
      ),
    )?.[0];
    assert.ok(heading, `${label} should use a real button heading`);
    assert.match(heading, /type="button"/);
    assert.match(heading, /aria-expanded="true"/);
    assert.match(heading, new RegExp(`aria-label="收起${label}"`));
    assert.match(heading, new RegExp(`title="收起${label}"`));
  });

  assert.match(styles, /\.other-feature-group-heading:focus-visible\s*\{/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.other-feature-group-arrow\s*\{[^}]*transition:\s*none/,
  );
});
