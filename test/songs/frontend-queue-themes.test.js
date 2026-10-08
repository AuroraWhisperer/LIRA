'use strict';

const { readAdminFragmentHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('../helpers/css-bundle');

const ROOT_DIR = path.join(__dirname, '../..');

// Rendering, escaping and rank rules for these styles run through the real module graph in queue-overlay-esm.test.js.
const ILLUSTRATED_STYLES = [
  { style: 'storybook', folder: 'song-board-style-3', css: 'storybook', viewport: 'storybook-info-viewport' },
  { style: 'neon-vinyl', folder: 'song-board-style-4', css: 'neon-vinyl', viewport: 'illustrated-info-viewport' },
  { style: 'cherry-ribbon', folder: 'song-board-style-5', css: 'cherry-ribbon', viewport: 'illustrated-info-viewport' },
  { style: 'golden-lily', folder: 'song-board-style-6', css: 'golden-lily', viewport: 'golden-lily-info-viewport' },
];

function webpSize(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.subarray(0, 4).toString('ascii'), 'RIFF', `${file} must be a WebP file`);
  const format = buffer.subarray(12, 16).toString('ascii');
  if (format === 'VP8X') return [1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3)];
  if (format === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
}

test('illustrated queue styles 3-6 ship their artwork, stylesheets and admin options', () => {
  const html = readAdminFragmentHtml('pages/admin/song/queue-theme.html');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const entryCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');

  for (const { style, folder, css, viewport } of ILLUSTRATED_STYLES) {
    assert.match(html, new RegExp(String.raw`\sdata-overlay-style\s*=\s*["']${style}["']`), `${style} admin option`);
    assert.ok(entryCss.includes(`@import url('./base/${css}.css');`), `${style} stylesheet`);
    for (const asset of ['frame.webp', 'entry.webp']) {
      assert.ok(fs.statSync(path.join(ROOT_DIR, 'public', 'img', 'overlays', folder, asset)).size > 0);
      assert.ok(overlayStyles.includes(`${folder}/${asset}`), `${style} uses ${asset}`);
    }

    const panelRatios = [
      ...overlayStyles.matchAll(
        new RegExp(String.raw`\.queue-${style}\s*\{[^}]*aspect-ratio:\s*([\d.]+)\s*/\s*([\d.]+)`, 'g'),
      ),
    ];
    const [, ratioWidth, ratioHeight] = panelRatios.at(-1);
    const [frameWidth, frameHeight] = webpSize(path.join(ROOT_DIR, 'public', 'img', 'overlays', folder, 'frame.webp'));
    assert.ok(
      Math.abs(Number(ratioWidth) / Number(ratioHeight) - frameWidth / frameHeight) < 0.001,
      `${style} panel must keep its frame artwork proportions`,
    );

    const rowRule = overlayStyles.match(new RegExp(String.raw`\.${style}-row\s*\{[^}]*\}`))?.[0];
    assert.ok(rowRule, `${style} row rule`);
    assert.match(rowRule, /font-size:\s*var\(--identity-queue-font-size\b/, `${style} applies the content font size`);
    assert.match(
      overlayStyles,
      new RegExp(String.raw`\.${viewport}\s*\{[^}]*overflow:\s*hidden`),
      `${style} clips long text`,
    );
  }

  assert.match(
    overlayStyles,
    /\.queue-neon-vinyl \.overlay-header,[\s\S]*\.queue-cherry-ribbon \.overlay-header,[\s\S]*\.queue-golden-lily \.overlay-header\s*\{[\s\S]*display:\s*none/,
  );
  assert.match(
    overlayStyles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.golden-lily-list\.scrolling[\s\S]*animation:\s*none/,
  );
  const storybookEntry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'img', 'overlays', 'song-board-style-3', 'entry.webp'));
  assert.equal(storybookEntry.subarray(8, 16).toString('ascii'), 'WEBPVP8L', 'storybook entry asset should use lossless WebP');
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
