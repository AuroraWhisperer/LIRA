'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');

test('games overlay is mapped and uses DOM-safe rendering hooks', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'pages', 'overlays', 'games.html'),
    'utf8',
  );
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'overlays', 'games.js'),
    'utf8',
  );
  const danmakuModule = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'overlays', 'danmaku-feed.js'),
    'utf8',
  );
  const drawingModule = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'overlays', 'games-drawing.js'),
    'utf8',
  );
  const drawingGeometryModule = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'public',
      'js',
      'overlays',
      'games-drawing-geometry.js',
    ),
    'utf8',
  );
  const styles = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'overlays', 'games.css'),
    'utf8',
  );
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
  assert.match(html, /id="gameResultAvatar"/);
  assert.match(html, /id="gameResultExit"[^>]*>[\s\S]*?退出\s*<\/button>/);
  assert.match(html, /id="gameResultNext"[^>]*>[\s\S]*?下一局\s*<\/button>/);
  assert.match(html, /id="drawGuessView"/);
  assert.match(html, /id="drawCanvas"/);
  assert.match(html, /id="drawCountdown"/);
  assert.match(html, /id="drawScoreboard"/);
  assert.match(html, /id="drawCorrectFeed"/);
  assert.match(html, /id="drawDanmakuFeed"[^>]+data-style="bubble"/);
  assert.match(
    html,
    /id="drawClearBtn"[^>]+class="draw-tool-button draw-clear-button"[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<\/button>/,
  );
  assert.match(
    html,
    /id="drawUndoBtn"[^>]+class="draw-tool-button draw-undo-button"[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<\/button>/,
  );
  assert.match(html, /id="drawPenBtn"[^>]+aria-label="画笔"/);
  assert.match(html, /id="drawEraserBtn"[^>]+aria-label="橡皮擦"/);
  assert.match(html, /id="drawLineBtn"[^>]+aria-label="直线"/);
  assert.match(html, /id="drawRectangleBtn"[^>]+aria-label="矩形"/);
  assert.match(html, /id="drawEllipseBtn"[^>]+aria-label="圆形"/);
  assert.match(html, /id="drawPickerBtn"[^>]+aria-label="取色器"/);
  assert.match(html, /id="drawPenBtn"[^>]+data-tooltip="画笔 \(B\)"/);
  assert.match(html, /data-draw-color="#222034"[^>]+data-tooltip="墨黑"/);
  assert.match(html, /data-draw-width="4"[^>]+data-tooltip="中号"/);
  assert.match(styles, /button\[data-tooltip\]:hover::after/);
  assert.doesNotMatch(html, />橡皮擦</);
  assert.doesNotMatch(html, /drawDanmakuCount|\d+ 条/);
  assert.doesNotMatch(html, /gomoku-legend|gomokuHint|gomokuLastMove/);
  assert.match(script, /renderGomokuCoordinates\(state\.size\)/);
  assert.match(script, /const isPicked = value === state\.lastGuess/);
  assert.match(script, /isPicked \? ["'] is-picked["'] : ["']["']/);
  assert.match(script, /cache:\s*['"]no-store['"]/);
  assert.match(script, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(script, /INITIAL_SNAPSHOT_RETRIES/);
  assert.match(script, /scheduleSnapshotRetry/);
  assert.match(script, /api\/games\/winner-profile/);
  assert.match(script, /submitGameResultAction\(["']stop["']\)/);
  assert.match(script, /submitGameResultAction\(["']restart["']\)/);
  assert.match(
    script,
    /loadWinnerProfile[\s\S]+Authorization:\s*`Bearer \$\{token\}`/,
  );
  assert.match(script, /function avatarSource\(/);
  assert.match(script, /api\/bilibili\/avatar\?url=/);
  assert.match(
    danmakuModule,
    /const source = String\(resolveAvatarUrl\(item\.avatarUrl\)/,
  );
  assert.match(danmakuModule, /image\.src\s*=\s*source/);
  assert.match(drawingModule, /function scheduleDrawDanmakuRender\(/);
  assert.match(drawingModule, /function getDrawDanmakuRenderInterval\(/);
  assert.match(drawingModule, /drawDanmakuLastRenderDurationMs/);
  assert.match(drawingModule, /setTimeout\(flushDrawDanmakuRender/);
  assert.match(script, /function guardLabel\(/);
  assert.match(script, /draw-danmaku-identity/);
  assert.match(script, /draw-danmaku-guard/);
  assert.match(script, /draw-danmaku-medal/);
  assert.match(script, /avatar\.src\s*=\s*avatarSource\(profile\.avatarUrl\)/);
  assert.match(script, /getBoundingClientRect/);
  assert.match(script, /positionGameResult/);
  assert.match(script, /game:draw/);
  assert.match(drawingModule, /pointerdown/);
  assert.match(drawingModule, /pointermove/);
  assert.match(drawingModule, /pointerup/);
  assert.match(drawingModule, /api\/games\/session\/draw/);
  assert.match(drawingModule, /action: ["']undo["']/);
  assert.match(drawingModule, /showConfirmationDialog/);
  assert.match(
    drawingModule,
    /document\.addEventListener\(["']keydown["'], handleDrawShortcut\)/,
  );
  assert.match(drawingModule, /key === ["']b["']/);
  assert.match(drawingModule, /key === ["']e["']/);
  assert.match(drawingModule, /key === ["']\[["']/);
  assert.match(drawingModule, /key === ["']\]["']/);
  assert.match(drawingGeometryModule, /export function createShapePoints\(/);
  assert.match(drawingGeometryModule, /tool === ["']line["']/);
  assert.match(drawingGeometryModule, /tool === ["']rectangle["']/);
  assert.match(drawingGeometryModule, /tool === ["']ellipse["']/);
  assert.match(drawingModule, /function pickDrawColor\(/);
  assert.match(drawingModule, /getImageData/);
  assert.match(drawingModule, /data-draw-color/);
  assert.match(drawingModule, /getContext\(["']2d["']\)/);
  assert.match(script, /renderDrawGuess/);
  assert.match(
    drawingModule,
    /byId\(["']drawCountdown["']\)\.textContent = countdown/,
  );
  assert.match(
    script,
    /Object\.prototype\.hasOwnProperty\.call\(payload\.state, ['"]games['"]\)/,
  );
  assert.doesNotMatch(script, /payload\.state\?\.games \|\| null/);
  assert.match(script, /revealedAnswer/);
  assert.match(drawingModule, /drawClientId/);
  assert.match(
    script,
    /import \{ createDanmakuFeed \} from ["']\.\/danmaku-feed\.js["'];/,
  );
  assert.match(script, /createDanmakuFeed\(byId\(["']drawDanmakuFeed["']\)/);
  assert.match(script, /drawDanmakuFeed\.render\(items\)/);
  assert.match(script, /offscreenViewports:\s*5/);
  assert.match(danmakuModule, /export function createDanmakuFeed\(/);
  assert.match(danmakuModule, /export function measureDanmakuText\(/);
  assert.match(danmakuModule, /--danmaku-width/);
  assert.match(danmakuModule, /--danmaku-height/);
  assert.match(danmakuModule, /--danmaku-lines/);
  assert.match(danmakuModule, /textContent/);
  assert.doesNotMatch(danmakuModule, /innerHTML/);
  assert.match(danmakuModule, /draw-danmaku-bubble/);
  for (const identity of ['viewer', 'fan', 'captain', 'admiral', 'governor']) {
    assert.match(
      styles,
      new RegExp(
        `\\.draw-danmaku-feed\\[data-style=["']bubble["']\\]\\s+\\.draw-danmaku-item\\[data-identity=["']${identity}["']\\]`,
      ),
    );
  }
  assert.doesNotMatch(html, /draw-danmaku-header|弹幕画廊|>LIVE</);
  assert.doesNotMatch(script, /\$\{state\.category\}/);
  assert.match(styles, /\.game-stage-header\s*\{\s*display:\s*none;/);
  assert.match(styles, /\.game-result\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(styles, /\.game-result\s*\{\s*position:\s*absolute/);
  assert.match(
    styles,
    /\.game-result-avatar\s*\{[^}]*width:\s*clamp\(36px,\s*4\.6vw,\s*56px\)/,
  );
  assert.match(styles, /\.game-result-avatar\s*\{[^}]*aspect-ratio:\s*1/);
  assert.match(styles, /\.game-result-avatar\s*\{[^}]*object-fit:\s*cover/);
  assert.match(styles, /\.bomb-number\.is-picked\s*\{/);
  assert.match(styles, /\.bomb-number\.is-picked:disabled\s*\{/);
  assert.match(styles, /--gomoku-size:\s*min\(56vh, 520px/);
  assert.match(styles, /\.gomoku-cell::before/);
  assert.match(styles, /\.gomoku-cell:nth-child\(15n \+ 1\)/);
  assert.match(styles, /\.draw-canvas/);
  assert.match(
    styles,
    /cursor:\s*url\(['"]\/img\/overlays\/draw-pen-cursor\.svg/,
  );
  assert.match(
    styles,
    /\.draw-canvas\.is-eraser\s*\{[^}]*cursor:\s*url\(['"]\/img\/overlays\/draw-eraser-cursor\.svg/,
  );
  assert.match(
    drawingModule,
    /classList\.toggle\(["']is-eraser["'],\s*drawTool === ["']eraser["']\)/,
  );
  assert.match(styles, /\.draw-canvas\.is-shape\s*\{[^}]*cursor:\s*crosshair/);
  assert.match(
    styles,
    /grid-template-columns:\s*clamp\(\s*260px,\s*21vw,\s*340px\s*\)\s+minmax\(0,\s*1fr\)\s+clamp\(\s*308px,\s*28vw,\s*420px\s*\)/,
  );
  assert.match(
    styles,
    /body\[data-game=["']draw-guess["']\]\s+\.draw-canvas-wrap\s*\{[^}]*height:\s*100%/,
  );
  assert.match(
    styles,
    /body\[data-game=["']draw-guess["']\]\s+\.draw-canvas\s*\{[^}]*aspect-ratio:\s*auto/,
  );
  assert.match(styles, /\.draw-scoreboard/);
  assert.match(styles, /\.draw-danmaku-identity/);
  assert.match(styles, /\.draw-danmaku-avatar\s*\{[^}]*overflow:\s*hidden/);
  assert.match(
    styles,
    /\.draw-danmaku-avatar img\s*\{[^}]*object-fit:\s*cover/,
  );
  assert.match(styles, /\.draw-danmaku-guard/);
  assert.match(styles, /\.draw-danmaku-medal/);
  assert.match(styles, /\.draw-danmaku-bubble/);
  assert.match(styles, /width:\s*min\(100%,\s*var\(--danmaku-width\)\)/);
  assert.match(styles, /min-height:\s*var\(--danmaku-height\)/);
  assert.match(styles, /\.draw-danmaku-item:nth-child\(3n \+ 1\)::before/);
  assert.match(styles, /content:\s*['"]✦['"]/);
  assert.match(styles, /--bubble-tail/);
  assert.match(styles, /\.draw-tool-button\[aria-pressed=['"]true['"]\]/);
});

test('draw guess danmaku feed keeps the visible viewport plus five buffered viewports', async () => {
  class FakeNode {
    constructor(isFragment = false) {
      this.children = [];
      this.parentElement = null;
      this.dataset = {};
      this.style = {
        values: new Map(),
        setProperty: (name, value) => this.style.values.set(name, value),
      };
      this.isFragment = isFragment;
    }

    append(...nodes) {
      nodes.forEach((node) => {
        if (node?.isFragment) {
          this.append(...node.children);
          node.children = [];
          return;
        }
        node.parentElement = this;
        this.children.push(node);
      });
    }

    replaceChildren(...nodes) {
      this.children.forEach((child) => {
        child.parentElement = null;
      });
      this.children = [];
      this.append(...nodes);
    }

    addEventListener() {}
    setAttribute() {}

    get scrollHeight() {
      const heights = this.children.map(
        (child) =>
          Number.parseFloat(child.style.values.get('--danmaku-height')) || 0,
      );
      return heights.reduce(
        (total, height) => total + height,
        22 + Math.max(0, heights.length - 1) * 11,
      );
    }
  }

  const root = new FakeNode();
  root.clientHeight = 100;
  const module = await loadModuleExports(
    path.join(__dirname, '..', 'public', 'js', 'overlays', 'danmaku-feed.js'),
    {
      document: {
        createElement: () => new FakeNode(),
        createDocumentFragment: () => new FakeNode(true),
      },
    },
  );
  const feed = module.createDanmakuFeed(root);

  feed.render(
    Array.from({ length: 30 }, (_, index) => ({ message: `消息 ${index}` })),
  );

  assert.ok(root.children.length < 30);
  assert.ok(
    root.children.length <= 10,
    `expected at most ten bubbles, got ${root.children.length}`,
  );
  assert.equal(root.scrollTop, root.scrollHeight);
});
