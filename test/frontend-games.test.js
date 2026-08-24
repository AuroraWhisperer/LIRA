'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..');

test('games admin groups shared games and the independent wheel', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'toolbox', 'games.html'),
    'utf8'
  );
  const linkPosition = html.indexOf('class="games-link-deck"');
  const sessionPosition = html.indexOf('id="gamesSessionStatus"');
  const catalogPosition = html.indexOf('class="games-catalog"');
  const bombPosition = html.indexOf('data-game-card="number-bomb"');
  const gomokuPosition = html.indexOf('data-game-card="gomoku"');
  const wheelCategoryPosition = html.indexOf('class="games-category games-category-wheel"');
  const wheelPosition = html.indexOf('data-wheel-card');
  const drawPosition = html.indexOf('data-game-card="draw-guess"');

  assert.ok(linkPosition >= 0, 'the overlay link section should be present');
  assert.ok(sessionPosition > linkPosition, 'current session should follow the overlay link');
  assert.ok(catalogPosition > sessionPosition, 'game cards should follow the current session');
  assert.ok(bombPosition > catalogPosition, 'game one should be inside the catalog');
  assert.ok(gomokuPosition > bombPosition, 'game two should follow game one');
  assert.ok(drawPosition > gomokuPosition, 'draw guess should follow the first two games');
  assert.ok(wheelCategoryPosition > drawPosition, 'the independent wheel should follow the shared games');
  assert.ok(wheelPosition > wheelCategoryPosition, 'the wheel card should be inside category two');
  assert.match(html, /id="gamesOverlayUrl"/);
  assert.match(html, /id="gamesCopyBaseUrlBtn"/);
  assert.match(html, /类别 1/);
  assert.match(html, /类别 2/);
  assert.match(html, /id="wheelOverlayUrl"/);
  assert.match(html, /id="wheelCopyUrlBtn"/);
  assert.match(html, /开始数字炸弹/);
  assert.match(html, /开始五子棋/);
  assert.match(html, /开始你画我猜/);
  assert.doesNotMatch(html, /第一步|第二步|1\. 打开固定游戏网页|2\. 开始/);
  assert.match(html, /id="drawCardTrigger"/);
  assert.match(html, /id="drawCardDetails"/);
  assert.match(html, /id="drawHostWord"/);
  assert.match(html, /id="drawFinishRoundBtn"/);
  assert.match(html, /id="drawNextRoundBtn"/);
  assert.match(html, /id="drawTotalRounds"[^>]*min="1"[^>]*max="12"/);
  assert.match(html, /id="drawRoundDuration"[^>]*min="15"[^>]*max="300"/);
  assert.match(html, /id="drawWordCategories"/);
  assert.match(html, /id="drawWordCategoryStatus"/);
  assert.match(html, /id="drawSelectAllCategoriesBtn"/);
  assert.match(html, /id="drawClearCategoriesBtn"/);
  assert.match(html, /本场词库/);
  assert.match(html, /1–12 局/);
  assert.match(html, /15–300 秒/);
  assert.doesNotMatch(html, /你画我猜计分规则|前三名|其余答对|10 · 7 · 5|3 分/);
  assert.match(html, /画板快捷操作：.*B.*画笔.*E.*橡皮擦.*Ctrl\+Z.*撤销/s);
  assert.match(html, /清空画布前会二次确认/);
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

test('games admin dropdowns can escape the first two game cards', () => {
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features', 'games.css'),
    'utf8'
  );

  assert.match(styles, /\.game-admin-card:has\(\.lira-select\.is-open\)\s*\{[^}]*z-index:\s*1;[^}]*overflow:\s*visible;/);
  assert.match(styles, /\.game-admin-card:has\(\.lira-select\.is-open\)\s*>\s*\.game-card-poster\s*\{[^}]*border-radius:\s*17px 0 0 17px;/);
});

test('games admin uses one base URL and never opens a game-specific URL', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), 'utf8');
  assert.doesNotMatch(script, /data-copy-game|overlayUrl\(game\)/);
  assert.match(script, /gamesCopyBaseUrlBtn/);
  assert.match(script, /button\.disabled = Boolean\(session\)/);
  assert.match(script, /card\.classList\.toggle\('is-running'/);
  assert.match(script, /api\/games\/host-state/);
  assert.match(script, /draw-guess/);
  assert.match(script, /totalRounds: Number\(byId\('drawTotalRounds'\)\.value\)/);
  assert.match(script, /roundDurationSeconds: Number\(byId\('drawRoundDuration'\)\.value\)/);
  assert.match(script, /api\/games\/draw-guess\/categories/);
  assert.match(script, /const categoryIds = readSelectedDrawCategoryIds\(\)/);
  assert.match(script, /categoryIds\s*\n/);
  assert.match(script, /function renderDrawCategories\(/);
  assert.match(script, /createElement\('input'\)/);
  assert.match(script, /textContent/);
  assert.match(script, /finish-round/);
  assert.match(script, /next-round/);
  assert.match(script, /toggleDrawDetails/);
});

test('games admin gives the word library a compact selectable shelf', () => {
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features', 'games.css'),
    'utf8'
  );

  assert.match(styles, /\.draw-word-library\s*\{/);
  assert.match(styles, /\.draw-word-categories\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  assert.match(styles, /\.draw-word-category:has\(input:checked\)/);
  assert.match(styles, /\.draw-word-category input:focus-visible/);
});

test('games viewer refresh waits for the live connection and retries an empty startup snapshot', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), 'utf8');

  assert.match(script, /import \{ eventBus, Events \} from '\.\.\/shared\/event-bus\.js';/);
  assert.match(script, /const VIEWER_REFRESH_RETRY_DELAYS_MS = \[/);
  assert.match(script, /let viewerRefreshPromise = null;/);
  assert.match(script, /function requestViewerRefresh\(options = \{\}\)/);
  assert.match(script, /eventBus\.on\(Events\.STATE_LOADED, \(\{ state \}\) =>/);
  assert.match(script, /liveStatus\.connected === true/);
  assert.match(script, /requestViewerRefresh\(\{ notify: false \}\)/);
  assert.match(script, /requestViewerRefresh\(\{ notify: true \}\)/);
  assert.match(script, /fetch\('\/api\/games\/viewers'\)/);
});

test('wheel admin consumes limits from server state', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), 'utf8');

  assert.match(script, /if \(state\?\.limits\) wheelLimits = state\.limits/);
  assert.match(script, /labelInput\.maxLength = wheelLimits\.maxLabelLength/);
  assert.match(script, /weightInput\.max = String\(wheelLimits\.maxWeight\)/);
  assert.match(script, /rows\.length >= wheelLimits\.maxEntries/);
  assert.doesNotMatch(script, /maxLength = 40|weightInput\.max = '100'|rows\.length >= 12/);
});
