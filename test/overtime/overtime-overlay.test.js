'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '../..');

test('overtime overlay has independent layers and responsive container scaling', () => {
  const html = read('public/pages/overlays/overtime.html');
  const css = read('public/css/overlays/overtime.css');

  assert.match(html, /<script type="module" src="\/js\/overlays\/overtime\.js\?v=[^"]+"><\/script>/);
  assert.equal(require('../../src/server/access-policy').getOverlayScope('/overtime'), 'overtime');
  assert.match(html, /id="overtimeMachine"/);
  assert.match(html, /id="overtimeBackground"/);
  assert.match(html, /id="overtimeClock"/);
  assert.match(html, /id="overtimeTickets"/);
  assert.match(html, /id="overtimeAdjustmentStage"/);
  assert.match(css, /container-type:\s*size/);
  assert.match(css, /cqmin/);
  assert.match(css, /\.overtime-machine\s*\{[^}]*height:\s*var\(--component-height, 100vh\);\s*height:\s*var\(--component-height, 100dvh\);/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /\.overtime-gift-guide/);
  assert.match(css, /\.overtime-ticket-effect/);
  assert.match(css, /\.overtime-ticket\.is-positive/);
  assert.match(css, /\.overtime-ticket\.is-negative/);
  assert.match(css, /\.overtime-ticket\.is-random/);
  assert.match(css, /\.overtime-ticket\.is-display/);
  assert.match(css, /repeat\(var\(--ticket-wide-columns/);
  assert.match(css, /repeat\(\s*var\(--ticket-narrow-columns/);
});

test('overtime overlay anchors server time and bounds animation work', () => {
  const source = read('public/js/overlays/overtime.js');

  assert.match(source, /performance\.now\(\)/);
  assert.match(source, /serverNowMs/);
  assert.match(source, /MAX_ANIMATION_QUEUE\s*=\s*5/);
  assert.match(source, /按数量结算/);
  assert.match(source, /applicationCount/);
  assert.match(source, /quality.*low/);
  assert.doesNotMatch(source, /setInterval\([^,]+,\s*1000\s*\)/);
});

test('overtime clock uses bounded calendar tiers for large durations', async () => {
  const source = read('public/js/shared/overtime-time-format.js');
  const helpers = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

  assert.equal(helpers.formatClock(23 * 60 * 60 * 1000 + 59_000), '23:00:59');
  assert.equal(helpers.formatClock(24 * 60 * 60 * 1000), '1天 00:00');
  assert.equal(helpers.formatClock(365 * 24 * 60 * 60 * 1000), '1年 0天 0小时');
  assert.equal(helpers.formatClock(9_999 * 365 * 24 * 60 * 60 * 1000), '9999年 0天 0小时');
  assert.equal(helpers.formatClockDisplay(0, 'paused'), '00:00:00');
  assert.equal(helpers.formatClockDisplay(0, 'running'), '该下播了');
  assert.equal(helpers.formatClockDisplay(0, 'finished'), '该下播了');
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}
