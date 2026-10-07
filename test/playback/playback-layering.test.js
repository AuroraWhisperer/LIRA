'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readCssBundle } = require('../helpers/css-bundle');

const ROOT_DIR = path.resolve(__dirname, '../..');
const readCss = (relativePath) => fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');

function readZIndex(relativePath, selector) {
  const source = readCss(relativePath);
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = source.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0];
  const value = rule?.match(/z-index:\s*(\d+)/)?.[1];

  assert.ok(value, `${selector} should define a numeric z-index`);
  return Number(value);
}

test('playback queue appears above fullscreen player and below playback controls', () => {
  const fullscreen = readZIndex('public/css/playback/fullscreen.css', '.player-fullscreen');
  const queueBackdrop = readZIndex('public/css/playback/queue-modal.css', '.queue-popup-backdrop');
  const queuePopup = readZIndex('public/css/playback/queue-modal.css', '.queue-popup');
  const playbackControls = readZIndex('public/css/playback/player.css', '.playback-player-panel');

  assert.ok(fullscreen < queueBackdrop);
  assert.ok(queueBackdrop < queuePopup);
  assert.ok(queuePopup < playbackControls);
});

test('playback stylesheets import existing feature owners in cascade order', () => {
  for (const [entry, orderedImports] of [
    ['public/css/playback/panels.css', ['./panels/search.css']],
    [
      'public/css/styles-playback.css',
      [
        './playback/player.css',
        './playback/quality-control.css',
        './playback/volume-control.css',
        './playback/drawer.css',
        './playback/responsive.css',
      ],
    ],
    [
      'public/css/styles-playback.css',
      ['./playback/fullscreen.css', './playback/fullscreen-visuals.css', './playback/responsive.css'],
    ],
  ]) {
    const imports = Array.from(readCss(entry).matchAll(/@import url\('([^']+)'\);/g), (match) => match[1]);
    for (const imported of imports) {
      assert.ok(fs.existsSync(path.join(ROOT_DIR, path.dirname(entry), imported)), `${entry} imports missing ${imported}`);
    }
    const positions = orderedImports.map((imported) => imports.indexOf(imported));
    assert.ok(positions.every((position) => position >= 0), `${entry} must import ${orderedImports.join(', ')}`);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), `${entry} cascade order`);
  }
});

test('an open track menu keeps its song row above hovered siblings', () => {
  const styles = readCssBundle('public', 'css', 'playback', 'panels.css');

  assert.match(styles, /\.playback-home-row:has\(\.track-menu:not\(\[hidden\]\)\)\s*\{[^}]*z-index:\s*[1-9]\d*;/);
});

test('playback control styles keep focused ownership', () => {
  const player = readCss('public/css/playback/player.css');
  const quality = readCss('public/css/playback/quality-control.css');
  const volume = readCss('public/css/playback/volume-control.css');

  assert.doesNotMatch(player, /\.playback-quality-btn\s*\{/);
  assert.doesNotMatch(player, /\.playback-volume-panel\s*\{/);
  assert.match(quality, /\.playback-quality-btn\s*\{/);
  assert.doesNotMatch(quality, /\.playback-volume-panel\s*\{/);
  assert.match(volume, /\.playback-volume-panel\s*\{/);
  assert.doesNotMatch(volume, /\.playback-quality-btn\s*\{/);
  assert.match(player, /\.playback-controls-divider\s*\{/);
  assert.match(player, /#playbackQueueBtn\.active\s*\{/);
  assert.match(player, /\.playback-player-panel\.is-external-source \.playback-quality-wrap/);
});

test('fullscreen visuals keep artwork ownership', () => {
  const fullscreen = readCss('public/css/playback/fullscreen.css');
  const visuals = readCss('public/css/playback/fullscreen-visuals.css');

  for (const selector of [/\.player-fs-bg\s*\{/, /\.player-fs-vinyl\s*\{/, /\.player-fs-tonearm\s*\{/]) {
    assert.doesNotMatch(fullscreen, selector);
    assert.match(visuals, selector);
  }
  for (const selector of [
    /\.player-fullscreen\s*\{/,
    /\.player-fs-content\s*\{/,
    /\.player-fs-panel\s*\{/,
    /\.player-fs-lyrics\s*\{/,
  ]) {
    assert.match(fullscreen, selector);
    assert.doesNotMatch(visuals, selector);
  }
  assert.match(visuals, /url\('\/img\/playback\/player-turntable-chassis\.webp'\)/);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'public/img/playback/player-turntable-chassis.webp')), true);
});
