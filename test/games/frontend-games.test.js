'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '../..');

test('games admin exposes source actions and controls for shared games and the independent wheel', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin', 'toolbox', 'games.html'), 'utf8');
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
  for (const id of ['gamesOverlayUrl', 'wheelOverlayUrl', 'interactionsUrl']) {
    const matches = buttons.filter((tag) => new RegExp('\\sid="' + id + '"').test(tag));
    assert.equal(matches.length, 1, id + ' must be a unique source action');
    assert.match(matches[0], /\stype="button"/);
    assert.doesNotMatch(matches[0], /\shidden(?:\s|=|>)/);
  }
  for (const game of ['number-bomb', 'gomoku', 'draw-guess']) {
    assert.ok(html.includes('data-game-card="' + game + '"'));
  }
  assert.match(html, /\sdata-wheel-card(?:\s|=|>)/);
  assert.match(html, /\sid="gamesSessionStatus"/);
  assert.doesNotMatch(html, /gamesCopyBaseUrlBtn|wheelCopyUrlBtn|interactionsCopy|interactionsSourceToggle/);
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
  assert.match(html, /画板快捷操作：.*B.*画笔.*E.*橡皮擦.*Ctrl\+Z.*撤销/s);
  assert.match(html, /清空画布前会二次确认/);
  assert.doesNotMatch(html, /data-copy-game/);
});

test('admin game styles keep shared, wheel, draw, and responsive ownership', () => {
  const readGameStyle = (name) =>
    fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'toolbox', name), 'utf8');
  const entry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'toolbox.css'), 'utf8');
  const imports = [
    "@import url('./toolbox/games.css');",
    "@import url('./toolbox/games-wheel.css');",
    "@import url('./toolbox/games-draw.css');",
    "@import url('./toolbox/games-responsive.css');",
    "@import url('./toolbox/start-animation.css');",
  ];
  const positions = imports.map((statement) => entry.indexOf(statement));

  assert.equal(
    positions.every((position) => position >= 0),
    true,
    'the admin entry should import every game style owner',
  );
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );

  const shared = readGameStyle('games.css');
  const wheel = readGameStyle('games-wheel.css');
  const draw = readGameStyle('games-draw.css');
  const responsive = readGameStyle('games-responsive.css');

  assert.match(shared, /\.game-admin-card\s*\{/);
  assert.doesNotMatch(shared, /\.wheel-card-trigger\s*\{/);
  assert.doesNotMatch(shared, /\.draw-word-library\s*\{/);
  assert.doesNotMatch(shared, /@media/);
  assert.match(wheel, /\.wheel-card-trigger\s*\{/);
  assert.doesNotMatch(wheel, /\.draw-card-trigger\s*\{/);
  assert.match(draw, /\.draw-card-trigger\s*\{/);
  assert.match(draw, /\.draw-word-library\s*\{/);
  assert.doesNotMatch(draw, /\.wheel-card-trigger\s*\{/);
  assert.match(responsive, /\.wheel-card-trigger\s*\{/);
  assert.match(responsive, /\.draw-card-trigger\s*\{/);
  assert.match(responsive, /\.games-category\s*\{/);
});

test('games admin uses one base URL and never opens a game-specific URL', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), 'utf8');
  assert.doesNotMatch(script, /data-copy-game|overlayUrl\(game\)/);
  assert.match(script, /byId\('gamesOverlayUrl'\)\.addEventListener\('click', \(\) => copyUrl\(overlayBaseUrl\(\)\)/);
  assert.match(script, /button\.disabled = Boolean\(session\)/);
  assert.match(script, /card\.classList\.toggle\(\s*["']is-running["']/);
  assert.match(script, /api\/games\/host-state/);
  assert.match(script, /draw-guess/);
  assert.match(script, /totalRounds: Number\(byId\(["']drawTotalRounds["']\)\.value\)/);
  assert.match(script, /roundDurationSeconds: Number\(byId\(["']drawRoundDuration["']\)\.value\)/);
  assert.match(script, /api\/games\/draw-guess\/categories/);
  assert.match(script, /function renderDrawCategories\(/);
  assert.match(script, /createElement\(["']input["']\)/);
  assert.match(script, /textContent/);
  assert.match(script, /finish-round/);
  assert.match(script, /next-round/);
  assert.match(script, /toggleDrawDetails/);
});

test('games word library styles expose selected and keyboard focus states', () => {
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'toolbox', 'games-draw.css'), 'utf8');

  assert.match(styles, /\.draw-word-category:has\(input:checked\)/);
  assert.match(styles, /\.draw-word-category input:focus-visible/);
});

test('games viewer refresh waits for the live connection and retries an empty startup snapshot', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), 'utf8');

  assert.match(script, /import \{ eventBus, Events \} from ["']\.\.\/shared\/event-bus\.js["'];/);
  assert.match(script, /function requestViewerRefresh\(options = \{\}\)/);
  assert.match(script, /eventBus\.on\(Events\.STATE_LOADED, \(\{ state \}\) =>/);
  assert.match(script, /liveStatus\.connected === true/);
  assert.match(script, /requestViewerRefresh\(\{ notify: false \}\)/);
  assert.match(script, /requestViewerRefresh\(\{ notify: true \}\)/);
  assert.match(script, /fetch\(["']\/api\/games\/viewers["']\)/);
});

test('wheel admin consumes limits from server state', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games-wheel.js'), 'utf8');

  assert.match(script, /if \(state\?\.limits\) wheelLimits = state\.limits/);
  assert.match(script, /labelInput\.maxLength = wheelLimits\.maxLabelLength/);
  assert.match(script, /weightInput\.max = String\(wheelLimits\.maxWeight\)/);
  assert.match(script, /rows\.length >= wheelLimits\.maxEntries/);
  assert.doesNotMatch(script, /maxLength = 40|weightInput\.max = ["']100["']|rows\.length >= 12/);
});
