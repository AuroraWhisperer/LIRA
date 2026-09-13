'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readZIndex(relativePath, selector) {
  const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = source.match(
    new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`),
  )?.[0];
  const value = rule?.match(/z-index:\s*(\d+)/)?.[1];

  assert.ok(value, `${selector} should define a numeric z-index`);
  return Number(value);
}

test('playback queue appears above fullscreen player and below playback controls', () => {
  const fullscreen = readZIndex(
    'public/css/playback/fullscreen.css',
    '.player-fullscreen',
  );
  const queueBackdrop = readZIndex(
    'public/css/playback/queue-modal.css',
    '.queue-popup-backdrop',
  );
  const queuePopup = readZIndex(
    'public/css/playback/queue-modal.css',
    '.queue-popup',
  );
  const playbackControls = readZIndex(
    'public/css/playback/player.css',
    '.playback-player-panel',
  );

  assert.ok(fullscreen < queueBackdrop);
  assert.ok(queueBackdrop < queuePopup);
  assert.ok(queuePopup < playbackControls);
});

test('playback control styles keep focused ownership and responsive cascade order', () => {
  const readCss = (relativePath) =>
    fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
  const entry = readCss('public/css/styles-playback.css');
  const imports = [
    "@import url('./playback/player.css');",
    "@import url('./playback/quality-control.css');",
    "@import url('./playback/volume-control.css');",
    "@import url('./playback/drawer.css');",
    "@import url('./playback/responsive.css');",
  ];
  const positions = imports.map((statement) => entry.indexOf(statement));

  assert.equal(
    positions.every((position) => position >= 0),
    true,
    'playback entry should import every control owner',
  );
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );

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
  assert.match(
    player,
    /\.playback-player-panel\.is-external-source \.playback-quality-wrap/,
  );
});

test('fullscreen visuals keep artwork ownership and load before responsive overrides', () => {
  const readCss = (relativePath) =>
    fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
  const entry = readCss('public/css/styles-playback.css');
  const imports = [
    "@import url('./playback/fullscreen.css');",
    "@import url('./playback/fullscreen-visuals.css');",
    "@import url('./playback/responsive.css');",
  ];
  const positions = imports.map((statement) => entry.indexOf(statement));

  assert.equal(
    positions.every((position) => position >= 0),
    true,
    'playback entry should import the fullscreen visual owner',
  );
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );

  const fullscreen = readCss('public/css/playback/fullscreen.css');
  const visuals = readCss('public/css/playback/fullscreen-visuals.css');

  for (const selector of [
    /\.player-fs-bg\s*\{/,
    /\.player-fs-vinyl\s*\{/,
    /\.player-fs-tonearm\s*\{/,
  ]) {
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
  assert.match(
    visuals,
    /url\('\/img\/playback\/player-turntable-chassis\.webp'\)/,
  );
  assert.equal(
    fs.existsSync(
      path.join(ROOT_DIR, 'public/img/playback/player-turntable-chassis.webp'),
    ),
    true,
  );
});
