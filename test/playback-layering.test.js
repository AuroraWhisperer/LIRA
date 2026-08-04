'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readZIndex(relativePath, selector) {
  const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
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
