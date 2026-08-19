'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

let tour;
test.before(async () => {
  tour = await loadModuleExports(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'interactive-tour.js'),
    { window: {} }
  );
});

test('tour tooltip stays beside a right-edge target by clamping its horizontal position', () => {
  const position = tour.calculateTooltipPosition(
    { top: 20, left: 1480, right: 1560, bottom: 60, width: 80, height: 40 },
    380,
    250,
    'bottom',
    { width: 1600, height: 900 }
  );

  assert.equal(position.position, 'bottom');
  assert.equal(position.left, 1204);
  assert.equal(position.top, 72);
  assert.equal(position.arrowOffset, 316);
});

test('tour tooltip flips to an available side instead of falling back to the viewport center', () => {
  const position = tour.calculateTooltipPosition(
    { top: 740, left: 500, right: 620, bottom: 780, width: 120, height: 40 },
    380,
    250,
    'bottom',
    { width: 1200, height: 900 }
  );

  assert.equal(position.position, 'top');
  assert.equal(position.left, 370);
  assert.equal(position.top, 478);
});

test('tour tooltip uses the viewport center only for steps without a target', () => {
  const position = tour.calculateTooltipPosition(
    null,
    380,
    250,
    'center',
    { width: 1000, height: 600 }
  );

  assert.equal(position.position, 'center');
  assert.equal(position.top, 175);
  assert.equal(position.left, 310);
  assert.equal(position.arrowOffset, null);
});

test('tour styles leave the spotlight interior interactive and point the arrow at its target', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'admin', 'other-features', 'interactive-tour.css'),
    'utf8'
  );
  const backdropRule = css.match(/\.lira-tour-backdrop\s*\{[\s\S]*?\n\}/)?.[0];
  const targetBackdropRule = css.match(/\.lira-tour\.has-target \.lira-tour-backdrop\s*\{[\s\S]*?\n\}/)?.[0];

  assert.match(backdropRule, /pointer-events:\s*none/);
  assert.match(targetBackdropRule, /background:\s*transparent/);
  assert.match(css, /--tour-arrow-offset/);
});
