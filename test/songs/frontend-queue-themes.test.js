'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('../helpers/css-bundle');
const { readJsModuleBundle: readRawJsModuleBundle } = require('../helpers/js-module-bundle');

const ROOT_DIR = path.join(__dirname, '../..');

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
  const framePath = path.join(ROOT_DIR, 'public', 'img', 'overlays', 'song-board-style-3', 'frame.webp');
  const entryPath = path.join(ROOT_DIR, 'public', 'img', 'overlays', 'song-board-style-3', 'entry.webp');
  assert.match(html, /\sdata-overlay-style\s*=\s*["']storybook["']/);
  assert.match(html, /data-identity-only/);
  assert.match(adminThemeSource, /ILLUSTRATED_QUEUE_STYLES[\s\S]*'storybook'/);
  assert.match(adminThemeSource, /if \(nextStyle !== 'classic'\)/);
  assert.equal(sandbox.normalizeQueueStyle('storybook'), 'storybook');
  assert.equal(sandbox.normalizeQueueStyle('festival'), 'identity');
  assert.equal(sandbox.normalizeQueueStyle('unknown'), 'classic');
  assert.ok(fs.statSync(framePath).size > 0);
  assert.ok(fs.statSync(entryPath).size > 0);
  assert.match(entryCss, /@import url\('\.\/base\/storybook\.css'\);/);
  assert.match(overlayStyles, /\.queue-storybook\s*\{[\s\S]*?aspect-ratio:\s*2\s*\/\s*3/);
  assert.match(overlayStyles, /song-board-style-3\/frame\.webp/);
  assert.match(overlayStyles, /song-board-style-3\/entry\.webp/);

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
  const rowRule = overlayStyles.match(/\.storybook-row\s*\{[^}]*\}/)?.[0];
  assert.ok(viewportRule);
  assert.ok(rowRule);
  assert.match(viewportRule, /overflow:\s*hidden/);
  assert.match(viewportRule, /min-width:\s*0/);
  assert.match(rowRule, /background-image:\s*url\('\/img\/overlays\/song-board-style-3\/entry\.webp'\)/);
  assert.match(rowRule, /font-size:\s*var\(--identity-queue-font-size\b/);
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
  assert.match(html, /\sdata-overlay-style\s*=\s*["']neon-vinyl["']/);
  assert.match(html, /\sdata-overlay-style\s*=\s*["']cherry-ribbon["']/);
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
  const neonViewportRule = overlayStyles.match(/\.neon-vinyl-info-viewport\s*\{[^}]*\}/)?.[0];
  const ribbonRowRule = overlayStyles.match(/\.cherry-ribbon-row\s*\{[^}]*\}/)?.[0];
  assert.ok(neonRowRule);
  assert.ok(neonViewportRule);
  assert.ok(ribbonRowRule);
  assert.match(neonRowRule, /font-size:\s*var\(--identity-queue-font-size\b/);
  assert.match(neonViewportRule, /justify-content:\s*safe center/);
  assert.match(ribbonRowRule, /font-size:\s*var\(--identity-queue-font-size\b/);
});

test('style 4 keeps its viewport inside the frame and its scroll endpoint above the foreground', () => {
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const contentRule = overlayStyles.match(/\.queue-neon-vinyl \.overlay-content\s*\{[^}]*\}/)?.[0];
  const frameRule = overlayStyles.match(/\.queue-neon-vinyl::after\s*\{[^}]*\}/)?.[0];

  assert.ok(contentRule);
  assert.ok(frameRule);
  const [, aspectWidth, aspectHeight] = overlayStyles.match(
    /\.queue-neon-vinyl\s*\{[^}]*aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/,
  );
  const bottomInset = Number(contentRule.match(/inset:\s*[\d.]+%\s+[\d.]+%\s+([\d.]+)%/)?.[1]);
  const frameBottom = Number(frameRule.match(/border-width:\s*[\d.]+px\s+[\d.]+px\s+([\d.]+)px/)?.[1]);
  const sharedRule = overlayStyles.match(/\.queue-neon-vinyl,\s*\.queue-cherry-ribbon,\s*\.queue-golden-lily\s*\{[^}]*\}/)?.[0];
  const canvasWidth = Number(sharedRule?.match(/\bwidth:\s*([\d.]+)px/)?.[1]);
  assert.ok(canvasWidth > 0);
  const canvasHeight = (canvasWidth * Number(aspectHeight)) / Number(aspectWidth);
  assert.ok(
    Math.ceil((canvasHeight * bottomInset) / 100) >= frameBottom,
    'the scroll viewport must end above the bottom artwork in design coordinates',
  );
});

test('styles 4-6 give each guard tier one shared guard and medal color', () => {
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  for (const style of ['neon-vinyl', 'cherry-ribbon', 'golden-lily']) {
    for (const level of [1, 2, 3]) {
      const rule = overlayStyles.match(new RegExp(`\\.${style}-row\\.guard-${level}\\s*\\{[^}]*\\}`))?.[0];
      assert.ok(rule, `${style} guard ${level} rule should exist`);
      const identityColor = rule.match(/--identity-bg:\s*([^;]+);/)?.[1].trim();
      const medalColor = rule.match(/--medal-bg:\s*([^;]+);/)?.[1].trim();
      assert.ok(identityColor, `${style} guard ${level} needs a color`);
      assert.equal(medalColor, identityColor, `${style} guard ${level} should match its medal`);
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
  assert.match(html, /\sdata-overlay-style\s*=\s*["']golden-lily["']/);
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
  assert.ok(goldenRowRule);
  assert.match(goldenRowRule, /font-size:\s*var\(--identity-queue-font-size\b/);
});

test('styles 5 and 6 expand vertical visibility above their foreground frames', () => {
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const foregroundRule = overlayStyles.match(/\.queue-neon-vinyl::after,\s*\.queue-cherry-ribbon::after,\s*\.queue-golden-lily::after\s*\{[^}]*z-index:[^}]*\}/)?.[0];
  const foregroundZ = Number(foregroundRule?.match(/z-index:\s*(-?\d+)/)?.[1]);
  assert.ok(Number.isFinite(foregroundZ));

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
    assert.ok(Number(contentRule.match(/z-index:\s*(-?\d+)/)?.[1]) > foregroundZ);
    assert.match(contentRule, /overflow:\s*visible/);
    assert.match(windowRule, /overflow:\s*visible/);
  });
});
