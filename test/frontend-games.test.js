'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..');

test('games admin keeps the overlay link and current session above game one', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'toolbox', 'games.html'),
    'utf8'
  );
  const linkPosition = html.indexOf('class="games-link-deck"');
  const sessionPosition = html.indexOf('id="gamesSessionStatus"');
  const catalogPosition = html.indexOf('class="games-catalog"');
  const bombPosition = html.indexOf('data-game-card="number-bomb"');
  const gomokuPosition = html.indexOf('data-game-card="gomoku"');
  const wheelPosition = html.indexOf('data-wheel-card');
  const drawPosition = html.indexOf('data-game-card="draw-guess"');

  assert.ok(linkPosition >= 0, 'the overlay link section should be present');
  assert.ok(sessionPosition > linkPosition, 'current session should follow the overlay link');
  assert.ok(catalogPosition > sessionPosition, 'game cards should follow the current session');
  assert.ok(bombPosition > catalogPosition, 'game one should be inside the catalog');
  assert.ok(gomokuPosition > bombPosition, 'game two should follow game one');
  assert.ok(wheelPosition > gomokuPosition, 'the independent wheel should remain game three');
  assert.ok(drawPosition > wheelPosition, 'draw guess should be the fourth card');
  assert.match(html, /id="gamesOverlayUrl"/);
  assert.match(html, /id="gamesCopyBaseUrlBtn"/);
  assert.match(html, /第一步/);
  assert.match(html, /1\. 打开固定游戏网页/);
  assert.match(html, /2\. 开始数字炸弹/);
  assert.match(html, /2\. 开始五子棋/);
  assert.match(html, /2\. 开始你画我猜/);
  assert.match(html, /id="drawCardTrigger"/);
  assert.match(html, /id="drawCardDetails"/);
  assert.match(html, /id="drawHostWord"/);
  assert.match(html, /id="drawFinishRoundBtn"/);
  assert.match(html, /id="drawNextRoundBtn"/);
  assert.match(html, /5 局/);
  assert.match(html, /90 秒/);
  assert.match(html, /10.*7.*5.*3/s);
  assert.doesNotMatch(html, /data-copy-game/);
});

test('games admin uses the restored single-column card layout', () => {
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features', 'games.css'),
    'utf8'
  );

  assert.match(styles, /\.games-link-deck\s*\{/);
  assert.match(styles, /\.games-catalog\s*\{\s*display:\s*grid;\s*gap:\s*16px;/);
  assert.match(styles, /\.game-admin-card\s*\{[^}]*grid-template-columns:\s*210px/);
  assert.doesNotMatch(styles, /\.games-catalog\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
});

test('games admin uses one base URL and never opens a game-specific URL', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), 'utf8');
  assert.doesNotMatch(script, /data-copy-game|overlayUrl\(game\)/);
  assert.match(script, /gamesCopyBaseUrlBtn/);
  assert.match(script, /button\.disabled = Boolean\(session\)/);
  assert.match(script, /card\.classList\.toggle\('is-running'/);
  assert.match(script, /api\/games\/host-state/);
  assert.match(script, /draw-guess/);
  assert.match(script, /finish-round/);
  assert.match(script, /next-round/);
  assert.match(script, /toggleDrawDetails/);
});

test('wheel admin consumes limits from server state', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), 'utf8');

  assert.match(script, /if \(state\?\.limits\) wheelLimits = state\.limits/);
  assert.match(script, /labelInput\.maxLength = wheelLimits\.maxLabelLength/);
  assert.match(script, /weightInput\.max = String\(wheelLimits\.maxWeight\)/);
  assert.match(script, /rows\.length >= wheelLimits\.maxEntries/);
  assert.doesNotMatch(script, /maxLength = 40|weightInput\.max = '100'|rows\.length >= 12/);
});
