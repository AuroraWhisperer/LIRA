'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('games overlay is mapped and uses DOM-safe rendering hooks', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', 'overlays', 'games.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'overlays', 'games.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'overlays', 'games.css'), 'utf8');
  assert.match(html, /id="gameStage"/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);

  assert.match(html, /直播小游戏/);
  assert.doesNotMatch(html, /THE HIDDEN SPARK|BLACK × WHITE|LIVE ARCADE/);
  assert.doesNotMatch(html, /bomb-range-visual|game-atmosphere/);
  assert.doesNotMatch(script, /URLSearchParams|params\.get\(['"]game/);
  assert.match(script, /(?:nextSession|session)\?\.game/);
  assert.match(html, /id="gomokuColumnLabels"/);
  assert.match(html, /id="gomokuRowLabels"/);
  assert.doesNotMatch(html, /gomoku-legend|gomokuHint|gomokuLastMove/);
  assert.match(script, /renderGomokuCoordinates\(state\.size\)/);
  assert.match(script, /cache:\s*['"]no-store['"]/);
  assert.match(script, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(script, /INITIAL_SNAPSHOT_RETRIES/);
  assert.match(script, /scheduleSnapshotRetry/);
  assert.match(styles, /\.game-result\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(styles, /--gomoku-size:\s*min\(56vh, 520px/);
  assert.match(styles, /\.gomoku-cell::before/);
  assert.match(styles, /\.gomoku-cell:nth-child\(15n \+ 1\)/);
});
