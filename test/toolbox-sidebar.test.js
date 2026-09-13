'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.resolve(__dirname, '..');

test('toolbox styles load feature-owned stylesheets in order', () => {
  const entry = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features.css'),
    'utf8',
  );

  assert.match(
    entry,
    /@import url\('\.\/other-features\/streamer-planner\.css'\);/,
  );
});

test('toolbox defers offscreen rendering in its heaviest panels', () => {
  const usageGuideStyles = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'css',
      'admin',
      'other-features',
      'usage-guide.css',
    ),
    'utf8',
  );
  const overtimeStyles = readCssBundle(
    'public',
    'css',
    'admin',
    'overtime.css',
  );
  const usageGuideScript = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'usage-guide.js'),
    'utf8',
  );

  assert.match(
    usageGuideStyles,
    /\.usage-guide-section\s*\{[^}]*content-visibility:\s*auto/,
  );
  assert.match(
    usageGuideStyles,
    /\.usage-guide-section\s*\{[^}]*contain-intrinsic-size:\s*auto 720px/,
  );
  assert.match(
    usageGuideStyles,
    /\.usage-guide-render-all \.usage-guide-section\s*\{[^}]*content-visibility:\s*visible/,
  );
  assert.match(
    usageGuideScript,
    /panel\.classList\.add\('usage-guide-render-all'\)/,
  );
  assert.match(
    overtimeStyles,
    /\.overtime-admin > \.overtime-admin-section\s*\{[^}]*content-visibility:\s*auto/,
  );
  assert.match(
    overtimeStyles,
    /\.overtime-admin > \.overtime-admin-section\s*\{[^}]*contain-intrinsic-size:\s*auto 260px/,
  );
});

test('toolbox sidebar switches between labeled and icon-only layouts', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(html, /data-other-sidebar-toggle/);
  assert.match(
    html,
    /class="other-sidebar-toggle-state other-sidebar-toggle-collapse"/,
  );
  assert.match(
    html,
    /class="other-sidebar-toggle-state other-sidebar-toggle-expand"/,
  );
  assert.match(
    html,
    /data-other-feature="otherDanmakuFeature"[^>]*>[\s\S]*?弹幕姬[\s\S]*?class="other-feature-arrow"[\s\S]*?<\/button>/,
  );
  assert.match(
    html,
    /data-other-feature="otherGiftFeature"[^>]*>[\s\S]*?礼物姬[\s\S]*?class="other-feature-arrow"[\s\S]*?<\/button>/,
  );
  assert.match(
    html,
    /data-other-feature="otherOvertimeMachineFeature"[^>]*>[\s\S]*?<strong>加班机<\/strong>\s*<small>用礼物延长直播倒计时<\/small>/,
  );
  assert.match(html, /aria-expanded="true"/);
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-workspace\s*\{[^}]*grid-template-columns:\s*76px/,
  );
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-label/);
  assert.match(
    styles,
    /\.other-sidebar-toolbar\s*\{[^}]*justify-content:\s*flex-start[^}]*padding:\s*10px 10px 2px/,
  );
  assert.match(
    styles,
    /\.other-sidebar-toggle\s*\{[^}]*flex:\s*0 0 42px[^}]*width:\s*42px[^}]*height:\s*34px[^}]*border-radius:\s*9px/,
  );
  assert.doesNotMatch(
    styles,
    /\.other-page\.sidebar-collapsed \.other-sidebar-toggle\s*\{/,
  );
  assert.match(
    styles,
    /\.other-sidebar-toggle-state\s*\{[^}]*transition:\s*opacity\s+140ms\s+ease,\s*transform\s+220ms\s+cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-sidebar-toggle-collapse\s*\{[^}]*opacity:\s*0[^}]*translateX\(-3px\) scale\(0\.94\)/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-sidebar-toggle-expand\s*\{[^}]*opacity:\s*1[^}]*translateX\(0\) scale\(1\)/,
  );
  assert.match(
    styles,
    /\.other-feature-button\s*\{[^}]*height:\s*56px[^}]*min-height:\s*56px[^}]*padding:\s*8px 10px/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-feature-button\s*\{[^}]*grid-template-columns:\s*38px minmax\(0, 1fr\) 16px[^}]*justify-content:\s*initial[^}]*min-height:\s*56px/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-feature-label\s*\{[^}]*visibility 0s linear 260ms/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-feature-arrow\s*\{[^}]*visibility 0s linear 180ms/,
  );
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*?\.other-sidebar-toolbar\s*\{[^}]*display:\s*none/,
  );
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*?\.other-page\.sidebar-collapsed \.other-feature-label\s*\{[^}]*display:\s*grid/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.other-sidebar-toggle-state\s*\{[^}]*transition:\s*none/,
  );
});

test('toolbox sidebar groups features by live and local workflows', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const navigation = html.match(
    /<nav\b[^>]*class=["']other-feature-menu["'][^>]*>([\s\S]*?)<\/nav\s*>/,
  )?.[1];
  const expectedGroups = [
    [
      'live-interaction',
      '直播互动',
      ['otherDanmakuFeature', 'otherGiftFeature', 'otherGamesFeature'],
    ],
    [
      'live-scene',
      '直播画面',
      [
        'otherOvertimeMachineFeature',
        'otherGiftEffectsFeature',
        'otherStartAnimationFeature',
        'otherClockFeature',
      ],
    ],
    ['streamer-work', '主播工作', ['otherDailyTodoFeature']],
    [
      'software-help',
      '软件与帮助',
      [
        'otherPerformanceFeature',
        'otherUsageGuideFeature',
        'otherDesktopUpdateFeature',
      ],
    ],
  ];

  assert.ok(navigation, 'toolbox navigation should remain present');

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

    assert.match(
      groupHtml,
      new RegExp(`<strong>${label}<\\/strong>`),
      `${label} should label its workflow group`,
    );
    const featurePositions = featureIds.map((featureId) =>
      groupHtml.indexOf(`data-other-feature="${featureId}"`),
    );
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
        assert.doesNotMatch(
          groupHtml,
          new RegExp(`data-other-feature="${featureId}"`),
        );
      }
    }
  });

  assert.match(
    styles,
    /\.other-feature-group-heading\s*\{[^}]*border-top:\s*1px solid var\(--border\)/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-feature-group-heading\s*\{[^}]*overflow:\s*hidden/,
  );
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*?\.other-feature-group-heading\s*\{[^}]*grid-column:\s*1 \/ -1/,
  );
});

test('toolbox group headings are collapsible buttons with the intended type scale', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const navigation = html.match(
    /<nav\b[^>]*class=["']other-feature-menu["'][^>]*>([\s\S]*?)<\/nav\s*>/,
  )?.[1];
  const groups = [
    ['live-interaction', '直播互动'],
    ['live-scene', '直播画面'],
    ['streamer-work', '主播工作'],
    ['software-help', '软件与帮助'],
  ];

  assert.ok(navigation, 'toolbox navigation should remain present');
  assert.equal(
    (navigation.match(/data-other-feature-group=/g) || []).length,
    groups.length,
  );

  groups.forEach(([groupId, label]) => {
    const heading = navigation.match(
      new RegExp(
        `<button\\s+class="other-feature-group-heading"[\\s\\S]*?data-other-feature-group="${groupId}"[\\s\\S]*?<\\/button>`,
      ),
    )?.[0];
    assert.ok(heading, `${label} should use a real button heading`);
    assert.match(heading, /type="button"/);
    assert.match(heading, /aria-expanded="true"/);
    assert.match(heading, new RegExp(`aria-label="收起${label}"`));
    assert.match(heading, new RegExp(`title="收起${label}"`));
  });

  assert.match(
    styles,
    /\.other-feature-group-heading strong\s*\{[^}]*font-size:\s*var\(--type-size-card-title\)/,
  );
  assert.match(
    styles,
    /\.other-feature-group-heading small\s*\{[^}]*font-size:\s*var\(--type-size-caption\)/,
  );
  assert.match(
    styles,
    /\.other-feature-label strong\s*\{[^}]*font-size:\s*var\(--type-size-control\)/,
  );
  assert.match(
    styles,
    /\.other-feature-label small\s*\{[^}]*font-size:\s*var\(--type-size-caption\)/,
  );
  assert.match(styles, /\.other-feature-group-heading:focus-visible\s*\{/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.other-feature-group-arrow\s*\{[^}]*transition:\s*none/,
  );
});
