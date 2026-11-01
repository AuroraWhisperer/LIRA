'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');

// Static checks are limited to the overlay's untrusted-content and request boundaries; drawing tools and
// snapshot behavior run in games-drawing.test.js and below.
test('games overlay avoids HTML injection and lets only the authenticated server session choose the game', () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '../..', 'public', ...parts), 'utf8');
  const script = read('js', 'overlays', 'games.js');
  const drawingModule = read('js', 'overlays', 'games-drawing.js');
  for (const source of [script, drawingModule]) {
    assert.doesNotMatch(source, /innerHTML/);
  }
  assert.doesNotMatch(script, /URLSearchParams|params\.get\(['"]game/, 'the server session selects the game, not the URL');
  assert.match(script, /loadWinnerProfile[\s\S]+Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(script, /api\/bilibili\/avatar\?url=/);
});

test('game snapshots retain unchanged boards and refresh moves, turns, results and resets', async () => {
  const nodes = new Map();
  const requests = [];
  let created = 0;
  function node() {
    return {
      children: [], dataset: {}, style: {}, handlers: new Map(), classList: { add() {} },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { if (name !== 'style') delete this[name]; },
      addEventListener(type, listener) {
        if (!this.handlers.has(type)) this.handlers.set(type, []);
        this.handlers.get(type).push(listener);
      },
      replaceChildren() { this.children = []; },
      append(child) { this.children.push(child); },
      getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100 }; },
    };
  }
  const document = {
    body: node(), addEventListener() {},
    createElement() { created++; return node(); },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
  };
  const context = vm.createContext({ document, window: {}, URL, URLSearchParams,
    location: new URL('http://127.0.0.1/games'), setTimeout, clearTimeout,
    fetch: async (url, options) => {
      if (!url.endsWith('/move')) return { json: async () => ({ ok: false }) };
      requests.push(JSON.parse(options.body));
      return { json: async () => ({ ok: true, data: context.incoming.session }) };
    },
  });
  vm.runInContext(readJsModuleBundle('public', 'js', 'overlays', 'games.js'), context);
  let revision = 0;
  const receive = (game, state) => {
    context.incoming = { type: 'game:update', session: state ? {
      sessionId: 'synthetic-game', eventRevision: ++revision, game, state: structuredClone(state),
    } : null };
    vm.runInContext('gameStream.receive(incoming)', context);
  };
  const { createNumberBombState, publicNumberBombState } = require('../../src/games/number-bomb');
  const { createGomokuState } = require('../../src/games/gomoku');
  for (const [game, state, rootId] of [
    ['number-bomb', publicNumberBombState(createNumberBombState(() => 0.5)), 'bombNumbers'],
    ['gomoku', createGomokuState(), 'gomokuBoard'],
  ]) {
    receive(game, state);
    const root = nodes.get(rootId);
    const first = root.children[0];
    const count = created;
    for (let index = 0; index < 60; index++) receive(game, state);
    assert.equal(root.children[0], first);
    assert.equal(created, count, 'repeated full snapshots must not create board or coordinate nodes');
    receive(game, { ...state, turn: 'viewer' });
    assert.equal(root.children.every(button => button.disabled), true);
    const changed = structuredClone(state);
    if (game === 'number-bomb') Object.assign(changed, { min: 25, max: 90, lastGuess: 24 });
    else changed.board[0][0] = 'black';
    receive(game, changed);
    assert.equal(root.children[0].disabled, true);
    if (game === 'number-bomb') {
      assert.match(root.children[23].className, /is-picked/);
      assert.equal(root.children[24].disabled, false);
      assert.equal(root.children[90].disabled, true);
    } else assert.match(root.children[0].className, /has-black/);
    receive(game, { ...changed, winner: 'draw' });
    assert.equal(root.children.every(button => button.disabled), true);
    assert.equal(nodes.get('gameResultText').textContent, '和棋');
    receive(game, { ...changed, winner: 'viewer' });
    assert.equal(nodes.get('gameResultText').textContent, '观众获胜');
    receive(game, state);
    const reset = root.children[0];
    assert.equal(reset.disabled, false);
    assert.equal(reset.handlers.get('click').length, 1);
    await reset.handlers.get('click')[0]();
    assert.deepEqual(requests.at(-1), { value: game === 'number-bomb' ? 1 : 'A1' });
    receive(game, null);
    receive(game, state);
    assert.equal(root.children[0], reset, 'returning from an empty session reuses the intact board');
    if (game === 'gomoku') {
      receive(game, { ...state, size: 9, board: Array.from({ length: 9 }, () => Array(9).fill(null)) });
      assert.equal(root.children.length, 81);
      assert.equal(nodes.get('gomokuColumnLabels').children.length, 9);
      assert.equal(nodes.get('gomokuRowLabels').children.length, 9);
    }
  }
  assert.equal(requests.length, 2, 'each click sends exactly one move');
  for (const totalRounds of [1, 5, 12]) {
    receive('draw-guess', { phase: 'finished', round: totalRounds, totalRounds,
      correct: [], scores: [], answerRevealed: true, revealedAnswer: '苹果' });
    assert.equal(nodes.get('gameTurn').textContent, `${totalRounds} 局结束 · 最终排行`);
  }
});
