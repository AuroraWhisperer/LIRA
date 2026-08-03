'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('an open track menu keeps its song row above hovered siblings', () => {
  const styles = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'playback', 'panels.css'),
    'utf8'
  );

  assert.match(
    styles,
    /\.playback-home-row:has\(\.track-menu:not\(\[hidden\]\)\)\s*\{[^}]*z-index:\s*[1-9]\d*;/
  );
});
