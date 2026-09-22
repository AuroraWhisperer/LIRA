'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { readJsModuleBundle: readRawJsModuleBundle } = require('./helpers/js-module-bundle');

const ROOT_DIR = path.join(__dirname, '..');

function readJsModuleBundle(...relativeSegments) {
  return readRawJsModuleBundle(...relativeSegments).replace(
    /^\s*(?:export\s+)?\{\s*applyTheme,\s*setIdentityRuleThemeVars\s*\}\s+from\s+['"]\.\/queue-theme\.js['"];\s*/gm,
    '',
  );
}

function loadQueueRenderers() {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(source, sandbox);
  return sandbox;
}

test('storybook queue scales complete illustrated rows while identity content stays inside the artwork viewport', () => {
  const html = readAdminHtml();
  const sandbox = loadQueueRenderers();
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const entryCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const adminThemeSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme-style-view.js'), 'utf8');
  const adminStyles = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const framePath = path.join(ROOT_DIR, 'public', 'img', 'overlays', 'song-board-style-3', 'frame.webp');
  const entryPath = path.join(ROOT_DIR, 'public', 'img', 'overlays', 'song-board-style-3', 'entry.webp');
  assert.match(html, /data-overlay-style="storybook"[\s\S]*点歌板风格 3/);
  assert.match(html, /data-identity-only/);
  assert.match(adminThemeSource, /ILLUSTRATED_QUEUE_STYLES[\s\S]*'storybook'/);
  assert.match(adminThemeSource, /if \(nextStyle !== 'classic'\)/);
  assert.match(adminStyles, /\.style-picker\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,/);
  assert.equal(sandbox.normalizeQueueStyle('storybook'), 'storybook');
  assert.equal(sandbox.normalizeQueueStyle('festival'), 'identity');
  assert.equal(sandbox.normalizeQueueStyle('unknown'), 'classic');
  assert.ok(fs.statSync(framePath).size > 0);
  assert.ok(fs.statSync(entryPath).size > 0);
  assert.match(entryCss, /@import url\('\.\/base\/storybook\.css'\);/);
  assert.match(overlayStyles, /\.queue-storybook\s*\{[\s\S]*?aspect-ratio:\s*2\s*\/\s*3/);
  assert.match(overlayStyles, /\.queue-storybook::before\s*\{[\s\S]*?background:\s*#fff/);
  assert.match(overlayStyles, /song-board-style-3\/frame\.webp/);
  assert.match(overlayStyles, /song-board-style-3\/entry\.webp/);
  assert.match(
    overlayStyles,
    /\.queue-storybook \.overlay-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(overlayStyles, /\.queue-storybook \.overlay-title\s*\{[\s\S]*?width:\s*100%/);

  const row = sandbox.renderStorybookRow(
    {
      song_name: '<img src=x onerror=alert(1)>超长歌名',
      requester_name: '<b>点歌人</b>',
      requester_guard_level: 2,
      requester_medal_name: '云朵团',
      requester_medal_level: 26,
    },
    0,
  );
  assert.match(row, /storybook-rank">1<\/span>/);
  assert.match(row, /storybook-info-viewport[\s\S]*storybook-info/);
  assert.match(row, /storybook-song[\s\S]*storybook-requester[\s\S]*storybook-badge[\s\S]*storybook-medal/);
  assert.match(row, /&lt;img src=x onerror=alert\(1\)&gt;超长歌名/);
  assert.match(row, /&lt;b&gt;点歌人&lt;\/b&gt;/);
  assert.doesNotMatch(row, /<img src=x|<b>点歌人/);

  const viewportRule = overlayStyles.match(/\.storybook-info-viewport\s*\{[^}]*\}/)?.[0];
  const rankRule = overlayStyles.match(/\.storybook-rank\s*\{[^}]*\}/)?.[0];
  const rowRule = overlayStyles.match(/\.storybook-row\s*\{[^}]*\}/)?.[0];
  const contentRule = overlayStyles.match(/\.queue-storybook \.overlay-content\s*\{[^}]*\}/)?.[0];
  assert.ok(viewportRule);
  assert.ok(rankRule);
  assert.ok(rowRule);
  assert.ok(contentRule);
  assert.match(viewportRule, /overflow:\s*hidden/);
  assert.match(viewportRule, /min-width:\s*0/);
  assert.match(viewportRule, /right:\s*5\.5%/);
  assert.match(viewportRule, /left:\s*25%/);
  assert.match(viewportRule, /padding:\s*0/);
  assert.doesNotMatch(viewportRule, /background:/);
  assert.match(rankRule, /left:\s*2\.5%/);
  assert.match(contentRule, /--storybook-list-offset-y:\s*10px/);
  assert.match(
    contentRule,
    /inset:\s*calc\(24\.5% - var\(--storybook-list-offset-y\)\)\s+7\.5%\s+calc\(17% \+ var\(--storybook-list-offset-y\)\)\s+12\.5%/,
  );
  assert.match(rowRule, /background-image:\s*url\('\/img\/overlays\/song-board-style-3\/entry\.webp'\)/);
  assert.match(rowRule, /font-size:\s*var\(--identity-queue-font-size,\s*28px\)/);
  const entryBuffer = fs.readFileSync(entryPath);
  assert.equal(entryBuffer.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(
    entryBuffer.subarray(8, 16).toString('ascii'),
    'WEBPVP8L',
    'storybook entry asset should use lossless WebP',
  );
});

test('styles 4 and 5 use supplied art, omit queue ranks, and render all four requested fields', () => {
  const html = readAdminHtml();
  const sandbox = loadQueueRenderers();
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const entryCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const adminThemeSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme-style-view.js'), 'utf8');
  const assetPaths = [
    ['song-board-style-4', 'frame.webp'],
    ['song-board-style-4', 'entry.webp'],
    ['song-board-style-5', 'frame.webp'],
    ['song-board-style-5', 'entry.webp'],
  ].map((parts) => path.join(ROOT_DIR, 'public', 'img', 'overlays', ...parts));
  assert.match(html, /data-overlay-style="neon-vinyl"[\s\S]*点歌板风格 4/);
  assert.match(html, /data-overlay-style="cherry-ribbon"[\s\S]*点歌板风格 5/);
  assert.match(adminThemeSource, /neon-vinyl/);
  assert.match(adminThemeSource, /cherry-ribbon/);
  assert.equal(sandbox.normalizeQueueStyle('neon-vinyl'), 'neon-vinyl');
  assert.equal(sandbox.normalizeQueueStyle('cherry-ribbon'), 'cherry-ribbon');
  assetPaths.forEach((assetPath) => assert.ok(fs.statSync(assetPath).size > 0));

  assert.match(entryCss, /@import url\('\.\/base\/neon-vinyl\.css'\);/);
  assert.match(entryCss, /@import url\('\.\/base\/cherry-ribbon\.css'\);/);
  assert.match(overlayStyles, /song-board-style-4\/frame\.webp/);
  assert.match(overlayStyles, /song-board-style-4\/entry\.webp/);
  assert.match(overlayStyles, /song-board-style-5\/frame\.webp/);
  assert.match(overlayStyles, /song-board-style-5\/entry\.webp/);
  assert.match(
    overlayStyles,
    /\.queue-neon-vinyl \.overlay-header,[\s\S]*\.queue-cherry-ribbon \.overlay-header,[\s\S]*\.queue-golden-lily \.overlay-header\s*\{[\s\S]*display:\s*none/,
  );
  assert.match(overlayStyles, /\.illustrated-info-viewport\s*\{[\s\S]*overflow:\s*hidden/);

  const unsafeItem = {
    song_name: '<img src=x onerror=alert(1)>超长歌名',
    requester_name: '<b>点歌人</b>',
    requester_guard_level: 2,
    requester_medal_name: '<i>灯牌</i>',
    requester_medal_level: 26,
  };
  const neonRow = sandbox.renderNeonVinylRow(unsafeItem, 0);
  const ribbonRow = sandbox.renderCherryRibbonRow(unsafeItem, 1);

  [neonRow, ribbonRow].forEach((row) => {
    assert.doesNotMatch(row, /illustrated-rank/);
    assert.match(row, /提督/);
    assert.match(row, /&lt;img src=x onerror=alert\(1\)&gt;超长歌名/);
    assert.match(row, /&lt;b&gt;点歌人&lt;\/b&gt;/);
    assert.match(row, /&lt;i&gt;灯牌&lt;\/i&gt; · 26/);
    assert.doesNotMatch(row, /<img src=x|<b>点歌人|<i>灯牌/);
  });

  assert.doesNotMatch(neonRow, /illustrated-label/);
  assert.doesNotMatch(ribbonRow, /illustrated-label/);

  const neonRowRule = overlayStyles.match(/\.neon-vinyl-row\s*\{[^}]*\}/)?.[0];
  const neonInfoRule = overlayStyles.match(/\.neon-vinyl-info\.identity-content\s*\{[^}]*\}/)?.[0];
  const neonViewportRule = overlayStyles.match(/\.neon-vinyl-info-viewport\s*\{[^}]*\}/)?.[0];
  const ribbonContentRule = overlayStyles.match(/\.queue-cherry-ribbon \.overlay-content\s*\{[^}]*\}/)?.[0];
  const ribbonRowRule = overlayStyles.match(/\.cherry-ribbon-row\s*\{[^}]*\}/)?.[0];
  const ribbonInfoRule = overlayStyles.match(/\.cherry-ribbon-info\.identity-content\s*\{[^}]*\}/)?.[0];
  const ribbonViewportRule = overlayStyles.match(/\.cherry-ribbon-info-viewport\s*\{[^}]*\}/)?.[0];
  assert.ok(neonRowRule);
  assert.ok(neonInfoRule);
  assert.ok(neonViewportRule);
  assert.ok(ribbonContentRule);
  assert.ok(ribbonRowRule);
  assert.ok(ribbonInfoRule);
  assert.ok(ribbonViewportRule);
  assert.match(neonRowRule, /margin-inline:\s*auto/);
  assert.match(neonRowRule, /font-size:\s*var\(--identity-queue-font-size,\s*28px\)/);
  assert.match(neonInfoRule, /margin-inline:\s*0/);
  assert.match(neonViewportRule, /top:\s*30%/);
  assert.match(neonViewportRule, /right:\s*15%/);
  assert.match(neonViewportRule, /bottom:\s*31%/);
  assert.match(neonViewportRule, /left:\s*25\.5%/);
  assert.match(neonViewportRule, /justify-content:\s*safe center/);
  assert.match(ribbonContentRule, /--cherry-ribbon-top-trim:\s*0px/);
  assert.match(ribbonContentRule, /--cherry-ribbon-bottom-trim:\s*30px/);
  assert.match(
    ribbonContentRule,
    /inset:\s*calc\(15% \+ var\(--cherry-ribbon-top-trim\)\)\s+10%\s+calc\(9\.5% \+ var\(--cherry-ribbon-bottom-trim\)\)/,
  );
  assert.match(ribbonRowRule, /margin-inline:\s*auto/);
  assert.match(ribbonRowRule, /font-size:\s*var\(--identity-queue-font-size,\s*28px\)/);
  assert.match(ribbonInfoRule, /margin-inline:\s*auto/);
  assert.match(ribbonViewportRule, /top:\s*41%/);
  assert.match(ribbonViewportRule, /right:\s*14\.5%/);
  assert.match(ribbonViewportRule, /bottom:\s*33%/);
  assert.match(ribbonViewportRule, /left:\s*22%/);
});

test('style 4 keeps its viewport inside the frame and its scroll endpoint above the foreground', () => {
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const contentRule = overlayStyles.match(/\.queue-neon-vinyl \.overlay-content\s*\{[^}]*\}/)?.[0];
  const frameRule = overlayStyles.match(/\.queue-neon-vinyl::after\s*\{[^}]*\}/)?.[0];

  assert.ok(contentRule);
  assert.ok(frameRule);
  assert.match(contentRule, /inset:\s*23\.5%\s+9\.5%\s/);
  const [, aspectWidth, aspectHeight] = overlayStyles.match(
    /\.queue-neon-vinyl\s*\{\s*aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/,
  );
  const bottomInset = Number(contentRule.match(/inset:\s*[\d.]+%\s+[\d.]+%\s+([\d.]+)%/)?.[1]);
  const frameBottom = Number(frameRule.match(/border-width:\s*[\d.]+px\s+[\d.]+px\s+([\d.]+)px/)?.[1]);
  const canvasHeight = (560 * Number(aspectHeight)) / Number(aspectWidth);
  assert.ok(
    Math.ceil((canvasHeight * bottomInset) / 100) >= frameBottom,
    'the scroll viewport must end above the bottom artwork in design coordinates',
  );
});

test('styles 4-6 give each guard tier one shared guard and medal color', () => {
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const guardColors = {
    1: '#f25f72',
    2: '#8d67e8',
    3: '#4b91e8',
  };

  for (const style of ['neon-vinyl', 'cherry-ribbon', 'golden-lily']) {
    for (const [level, color] of Object.entries(guardColors)) {
      const rule = overlayStyles.match(new RegExp(`\\.${style}-row\\.guard-${level}\\s*\\{[^}]*\\}`))?.[0];
      assert.ok(rule, `${style} guard ${level} rule should exist`);
      assert.match(rule, new RegExp(`--identity-bg:\\s*${color}`));
      assert.match(rule, new RegExp(`--medal-bg:\\s*${color}`));
    }
  }
});

test('style 6 uses supplied golden lily art, shows queue ranks, and renders all four requested fields', () => {
  const html = readAdminHtml();
  const sandbox = loadQueueRenderers();
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const entryCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const adminThemeSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme-style-view.js'), 'utf8');
  const framePath = path.join(ROOT_DIR, 'public', 'img', 'overlays', 'song-board-style-6', 'frame.webp');
  const entryPath = path.join(ROOT_DIR, 'public', 'img', 'overlays', 'song-board-style-6', 'entry.webp');
  assert.match(html, /data-overlay-style="golden-lily"[\s\S]*点歌板风格 6/);
  assert.match(html, /点歌板风格 2 \/ 3 \/ 4 \/ 5 \/ 6/);
  assert.match(adminThemeSource, /golden-lily/);
  assert.equal(sandbox.normalizeQueueStyle('golden-lily'), 'golden-lily');
  assert.ok(fs.statSync(framePath).size > 0);
  assert.ok(fs.statSync(entryPath).size > 0);

  assert.match(entryCss, /@import url\('\.\/base\/golden-lily\.css'\);/);
  assert.match(overlayStyles, /song-board-style-6\/frame\.webp/);
  assert.match(overlayStyles, /song-board-style-6\/entry\.webp/);
  assert.match(overlayStyles, /\.golden-lily-info-viewport\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(
    overlayStyles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.golden-lily-list\.scrolling[\s\S]*animation:\s*none/,
  );

  const row = sandbox.renderGoldenLilyRow(
    {
      song_name: '<img src=x onerror=alert(1)>超长歌名',
      requester_name: '<b>点歌人</b>',
      requester_guard_level: 2,
      requester_medal_name: '<i>灯牌</i>',
      requester_medal_level: 26,
    },
    5,
  );

  assert.match(row, /golden-lily-rank illustrated-rank">6<\/span>/);
  assert.doesNotMatch(row, /illustrated-label/);
  assert.match(row, /提督/);
  assert.match(row, /&lt;img src=x onerror=alert\(1\)&gt;超长歌名/);
  assert.match(row, /&lt;b&gt;点歌人&lt;\/b&gt;/);
  assert.match(row, /&lt;i&gt;灯牌&lt;\/i&gt; · 26/);
  assert.doesNotMatch(row, /<img src=x|<b>点歌人|<i>灯牌/);

  const goldenRowRule = overlayStyles.match(/\.golden-lily-row\s*\{[^}]*\}/)?.[0];
  const goldenRankRule = overlayStyles.match(/\.golden-lily-rank\s*\{[^}]*\}/)?.[0];
  const goldenViewportRule = overlayStyles.match(/\.golden-lily-info-viewport\s*\{[^}]*\}/)?.[0];
  const goldenInfoRule = overlayStyles.match(/\.golden-lily-info\.identity-content\s*\{[^}]*\}/)?.[0];
  assert.ok(goldenRowRule);
  assert.ok(goldenRankRule);
  assert.ok(goldenViewportRule);
  assert.ok(goldenInfoRule);
  assert.match(goldenRowRule, /margin-inline:\s*auto/);
  assert.match(goldenRowRule, /font-size:\s*var\(--identity-queue-font-size,\s*28px\)/);
  assert.match(goldenRankRule, /top:\s*25%/);
  assert.match(goldenRankRule, /bottom:\s*21%/);
  assert.match(goldenRankRule, /left:\s*5\.5%/);
  assert.match(goldenRankRule, /width:\s*18\.5%/);
  assert.match(goldenRankRule, /font-size:\s*1\.5em/);
  assert.match(goldenRankRule, /place-items:\s*center/);
  assert.match(goldenViewportRule, /top:\s*41%/);
  assert.match(goldenViewportRule, /right:\s*11%/);
  assert.match(goldenViewportRule, /bottom:\s*29%/);
  assert.match(goldenViewportRule, /left:\s*32%/);
  assert.match(goldenInfoRule, /margin-inline:\s*auto/);
});

test('styles 5 and 6 expand vertical visibility above their foreground frames', () => {
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const clipPaths = {
    'cherry-ribbon': /clip-path:\s*inset\(0%\s+0\s+-1%\)/,
    'golden-lily': /clip-path:\s*inset\(-5%\s+0\s+0\)/,
  };

  ['cherry-ribbon', 'golden-lily'].forEach((style) => {
    const contentRule = [
      ...overlayStyles.matchAll(new RegExp(`\\.queue-${style} \\.overlay-content\\s*\\{[^}]*\\}`, 'g')),
    ]
      .map((match) => match[0])
      .find((rule) => /inset:/.test(rule));
    const windowRule = [...overlayStyles.matchAll(new RegExp(`\\.${style}-list-window\\s*\\{[^}]*\\}`, 'g'))]
      .map((match) => match[0])
      .find((rule) => /overflow:\s*visible/.test(rule));

    assert.ok(contentRule);
    assert.ok(windowRule);
    assert.match(contentRule, /inset:/);
    assert.match(contentRule, /z-index:\s*4/);
    assert.match(contentRule, /overflow:\s*visible/);
    assert.match(contentRule, clipPaths[style]);
    assert.match(windowRule, /overflow:\s*visible/);
  });
});
