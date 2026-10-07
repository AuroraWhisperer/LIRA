'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('games overlay styles keep shared, board, drawing, result, responsive, and late drawing ownership', () => {
  const styleRoot = path.join(__dirname, '../..', 'public', 'css', 'overlays');
  const entry = fs.readFileSync(path.join(styleRoot, 'games.css'), 'utf8');
  const expectedImports = [
    "@import url('./games/shared.css');",
    "@import url('./games/board.css');",
    "@import url('./games/drawing.css');",
    "@import url('./games/result.css');",
    "@import url('./games/responsive.css');",
    "@import url('./games/drawing-live.css');",
  ];
  assert.deepEqual(entry.match(/@import url\('[^']+'\);/g), expectedImports);

  const owners = Object.fromEntries(
    ['shared', 'board', 'drawing', 'result', 'responsive', 'drawing-live'].map((name) => [
      name,
      fs.readFileSync(path.join(styleRoot, 'games', `${name}.css`), 'utf8'),
    ]),
  );

  assert.match(owners.shared, /\.game-stage\s*\{/);
  assert.doesNotMatch(owners.shared, /\.bomb-numbers\s*\{/);
  assert.match(owners.board, /\.bomb-numbers\s*\{/);
  assert.match(owners.board, /\.gomoku-board\s*\{/);
  assert.doesNotMatch(owners.board, /\.draw-canvas\s*\{/);
  assert.match(owners.drawing, /\.draw-canvas\s*\{/);
  assert.match(owners.drawing, /\.draw-scoreboard/);
  assert.doesNotMatch(owners.drawing, /\.game-result\s*\{/);
  assert.match(owners.result, /\.game-empty\s*\{/);
  assert.match(owners.result, /\.game-result\s*\{/);
  assert.doesNotMatch(owners.result, /\.draw-danmaku-feed\s*\{/);
  assert.match(owners.responsive, /\.bomb-number\s*\{/);
  assert.match(owners.responsive, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(owners.responsive, /\.draw-danmaku-feed\s*\{/);
  assert.match(owners['drawing-live'], /body\[data-game='draw-guess'\] \.draw-layout\s*\{/);
  assert.match(owners['drawing-live'], /\.draw-danmaku-feed\s*\{/);
});

// Drawing shortcuts, tools, shape geometry and the color picker run in
// games-drawing.test.js; the danmaku feed bound runs below. These checks keep
// the page's unique entries, accessible tool labels and the overlay's
// request/protocol boundaries, which have no offline runtime harness.
test('games overlay is mapped and uses DOM-safe rendering hooks', () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '../..', 'public', ...parts), 'utf8');
  const html = read('pages', 'overlays', 'games.html');
  const script = read('js', 'overlays', 'games.js');
  const drawingModule = read('js', 'overlays', 'games-drawing.js');
  for (const id of ['gameStage', 'gomokuColumnLabels', 'gomokuRowLabels', 'gameResultAvatar', 'drawGuessView', 'drawCanvas',
    'drawCountdown', 'drawScoreboard', 'drawCorrectFeed']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  for (const id of ['gameResultExit', 'gameResultNext', 'drawClearBtn', 'drawUndoBtn']) {
    assert.match(html, new RegExp(`<button\\b[^>]*\\sid="${id}"`), id);
  }
  assert.match(html, /id="drawDanmakuFeed"[^>]+data-style="bubble"/);
  for (const [id, label] of [['drawPenBtn', '画笔'], ['drawEraserBtn', '橡皮擦'], ['drawLineBtn', '直线'],
    ['drawRectangleBtn', '矩形'], ['drawEllipseBtn', '圆形'], ['drawPickerBtn', '取色器']]) {
    assert.match(html, new RegExp(`id="${id}"[^>]+aria-label="${label}"`), id);
  }
  for (const source of [script, drawingModule, read('js', 'overlays', 'danmaku-message-renderer.js')]) {
    assert.doesNotMatch(source, /innerHTML/);
  }
  assert.doesNotMatch(script, /\$\{state\.category\}/);
  assert.doesNotMatch(script, /URLSearchParams|params\.get\(['"]game/, 'the server session selects the game, not the URL');
  assert.match(script, /(?:nextSession|session)\?\.game/);
  assert.match(script, /cache:\s*['"]no-store['"]/);
  assert.match(script, /loadWinnerProfile[\s\S]+Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(script, /api\/games\/winner-profile/);
  assert.match(script, /api\/bilibili\/avatar\?url=/);
  assert.match(script, /submitGameResultAction\(["']stop["']\)/);
  assert.match(script, /submitGameResultAction\(["']restart["']\)/);
  assert.match(script, /game:draw/);
  assert.match(script, /Object\.prototype\.hasOwnProperty\.call\(payload\.state, ['"]games['"]\)/,
    'an absent games field keeps the current session; only an explicit null clears it');
  assert.doesNotMatch(script, /payload\.state\?\.games \|\| null/);
  assert.match(script, /createDanmakuFeed\(byId\(["']drawDanmakuFeed["']\)/);
});

test('draw guess danmaku feed bounds retained nodes and follows the latest message', async () => {
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
      const heights = this.children.map((child) => Number.parseFloat(child.style.values.get('--danmaku-height')) || 0);
      return heights.reduce((total, height) => total + height, 22 + Math.max(0, heights.length - 1) * 11);
    }
  }

  const root = new FakeNode();
  root.clientHeight = 100;
  const module = await loadModuleExports(path.join(__dirname, '../..', 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: {
      createElement: () => new FakeNode(),
      createDocumentFragment: () => new FakeNode(true),
    },
  });
  const feed = module.createDanmakuFeed(root);

  feed.render(Array.from({ length: 30 }, (_, index) => ({ message: `消息 ${index}` })));

  assert.ok(root.children.length < 30);
  assert.ok(root.children.length <= 10, `expected at most ten bubbles, got ${root.children.length}`);
  assert.equal(root.scrollTop, root.scrollHeight);
});
