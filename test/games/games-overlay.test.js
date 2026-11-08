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
  const resultModule = read('js', 'overlays', 'games-result.js');
  for (const source of [script, drawingModule, resultModule]) {
    assert.doesNotMatch(source, /innerHTML/);
  }
  assert.doesNotMatch(script, /URLSearchParams|params\.get\(['"]game/, 'the server session selects the game, not the URL');
  assert.match(resultModule, /loadWinnerProfile[\s\S]+Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(script, /api\/bilibili\/avatar\?url=/);
});

function createGameOverlayFixture(fetchResult) {
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
      removeEventListener(type, listener) {
        this.handlers.set(type, (this.handlers.get(type) || []).filter(item => item !== listener));
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
  const context = vm.createContext({ document, window: node(), URL, URLSearchParams,
    location: new URL('http://127.0.0.1/games'), setTimeout, clearTimeout,
    fetch: async (url, options) => {
      if (!url.endsWith('/move')) return fetchResult ? fetchResult(url, options) : { json: async () => ({ ok: false }) };
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
  return { nodes, requests, context, receive, created: () => created };
}

test('game snapshots retain unchanged boards and refresh moves, turns, results and resets', async () => {
  const { nodes, requests, receive, created } = createGameOverlayFixture();
  const { createNumberBombState, publicNumberBombState } = require('../../src/games/number-bomb');
  const { createGomokuState } = require('../../src/games/gomoku');
  for (const [game, state, rootId] of [
    ['number-bomb', publicNumberBombState(createNumberBombState(() => 0.5)), 'bombNumbers'],
    ['gomoku', createGomokuState(), 'gomokuBoard'],
  ]) {
    receive(game, state);
    const root = nodes.get(rootId);
    const first = root.children[0];
    const count = created();
    for (let index = 0; index < 60; index++) receive(game, state);
    assert.equal(root.children[0], first);
    assert.equal(created(), count, 'repeated full snapshots must not create board or coordinate nodes');
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

test('scene drawing retains painted history until its revision, session, round or canvas size changes', () => {
  const { context, nodes } = createGameOverlayFixture();
  let clears = 0;
  let segments = 0;
  const drawing = { fillRect() { clears++; }, beginPath() {}, moveTo() {},
    lineTo() { segments++; }, stroke() {} };
  const canvas = context.document.getElementById('drawCanvas');
  Object.assign(canvas, { width: 800, height: 600, getContext: () => drawing });
  canvas.classList.toggle = () => {};
  context.document.querySelectorAll = () => [];
  Object.assign(context, { crypto: require('node:crypto'), performance });
  context.next = { game: 'draw-guess', sessionId: 'one', state: {
    phase: 'round-result', round: 1, totalRounds: 3, correct: [], scores: [], answerRevealed: true,
    canvas: { revision: 1, strokes: [{ color: 'black', width: 4, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] },
  } };
  vm.runInContext('drawController = createDrawController({ byId, canDraw: () => false, getSession: () => session, renderDanmaku() {} }); componentConfig = { game: "draw-guess" }', context);
  const render = () => vm.runInContext('componentData = { session: next }; renderComponent()', context);
  render();
  for (let index = 0; index < 20; index++) render();
  assert.equal(clears, 1, 'disabled tools do not clear an unchanged canvas again');
  assert.equal(segments, 1);
  context.next.state.canvas = { revision: 2, strokes: [] };
  render();
  assert.equal(clears, 2, 'clear and undo revisions replace the painted history');
  assert.equal(segments, 1);
  context.next.state.round++;
  render();
  assert.equal(clears, 3);
  context.next.sessionId = 'two';
  render();
  assert.equal(clears, 4);
  canvas.width = 1000;
  render();
  assert.equal(clears, 5);
  vm.runInContext('componentData = null; renderComponent()', context);
  render();
  assert.equal(clears, 6, 'restoring a session restores its drawing baseline');
  assert.equal(nodes.get('drawGuessView').hidden, false);
});

test('result actions and late winner profiles follow the current game session', async () => {
  const profiles = [];
  const actions = [];
  const snapshots = [];
  const { nodes, context, receive } = createGameOverlayFixture((url, options) => new Promise(resolve => {
    const request = { options, resolve: (data, ok = true) => resolve({ ok, json: async () => ({ ok, data }) }) };
    if (url === '/api/games/winner-profile') profiles.push(request);
    else if (url === '/api/games/session' && options.method === 'POST') actions.push(request);
    else if (url === '/api/games/session') snapshots.push(request);
    else assert.fail(`Unexpected request: ${url}`);
  }));
  vm.runInContext('window.__API_TOKEN__ = "result-test-token"; gameResult.bind()', context);
  const { createNumberBombState, publicNumberBombState } = require('../../src/games/number-bomb');
  const state = publicNumberBombState(createNumberBombState(() => 0.5));
  const flush = () => new Promise(setImmediate);
  const result = () => nodes.get('gameResult');
  const avatar = () => nodes.get('gameResultAvatar');
  const click = id => nodes.get(id).handlers.get('click')[0]();

  receive('number-bomb', { ...state, winner: 'host' });
  receive('number-bomb', { ...state, winner: 'viewer' });
  profiles[0].resolve({ avatarUrl: 'https://example.test/old.png' });
  await flush();
  assert.equal(avatar().hidden, true, 'a previous winner cannot supply the current avatar');
  profiles[1].resolve({ avatarUrl: 'https://example.test/current.png' });
  await flush();
  assert.equal(avatar().hidden, false);
  assert.equal(avatar().alt, '观众头像');
  assert.match(avatar().src, /current\.png/);
  assert.equal(profiles[1].options.headers.Authorization, 'Bearer result-test-token');

  const stop = click('gameResultExit');
  assert.equal(nodes.get('gameResultExit').disabled, true);
  assert.equal(nodes.get('gameResultNext').disabled, true);
  assert.equal(actions.length, 1, 'one click sends one action');
  assert.deepEqual(JSON.parse(actions[0].options.body), { action: 'stop' });
  assert.equal(actions[0].options.headers.Authorization, 'Bearer result-test-token');
  actions[0].resolve(null);
  await stop;
  assert.equal(result().hidden, true);

  receive('number-bomb', { ...state, winner: 'host' });
  const restart = click('gameResultNext');
  assert.deepEqual(JSON.parse(actions[1].options.body), { action: 'restart' });
  actions[1].resolve(null, false);
  await restart;
  assert.equal(nodes.get('gameResultActionStatus').hidden, false);
  assert.equal(nodes.get('gameResultNext').disabled, false);
  assert.equal(snapshots.length, 1, 'a failed current action starts one snapshot recovery');
  snapshots[0].resolve({ ...context.incoming.session, state });
  await flush();
  assert.equal(result().hidden, true);

  receive('number-bomb', { ...state, winner: 'host' });
  const stale = click('gameResultNext');
  receive('number-bomb', null);
  actions[2].resolve(null, false);
  await stale;
  assert.equal(snapshots.length, 1, 'a superseded action cannot recover over a newer snapshot');
  assert.equal(nodes.get('gameResultActionStatus').hidden, true);
  profiles.slice(2).forEach(request => request.resolve({ avatarUrl: 'https://example.test/late.png' }));
  await flush();
  assert.equal(avatar().hidden, true);
  vm.runInContext('gameResult.dispose()', context);
  assert.equal(nodes.get('gameResultNext').handlers.get('click').length, 0);
  assert.equal(context.window.handlers.get('resize').length, 0);
});
