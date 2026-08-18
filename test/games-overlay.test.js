'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('games overlay is mapped and uses DOM-safe rendering hooks', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', 'overlays', 'games.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'overlays', 'games.js'), 'utf8');
  assert.match(html, /id="gameStage"/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);

  assert.match(html, /直播小游戏/);
});
