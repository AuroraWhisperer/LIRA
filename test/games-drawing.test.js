'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { createGameSessionService } = require('../src/games/game-session-service');
const { routes } = require('../src/server/routes/game-routes');

async function createDrawingFixture(t) {
  const broadcasts = [];
  const requests = [];
  const responses = [];
  const games = createGameSessionService({
    broadcast: (payload) => {
      if (payload.type === 'game:draw') broadcasts.push(payload.operation);
    },
    drawGuessWords: [{ word: '苹果', category: '食物' }],
    random: () => 0,
    monotonicNow: () => 0,
    wallNow: () => 1000,
    setTimeout: () => 1,
    clearTimeout() {},
  });
  t.after(() => games.dispose());
  games.start({ game: 'draw-guess' });
  for (const [index, color] of ['#222034', '#ef476f'].entries()) {
    assert.equal(games.draw({
      action: 'append', clientId: 'seed', strokeId: `stroke-${index}`,
      color, width: 4,
      points: Array.from({ length: index + 1 }, (_, point) => ({
        x: 0.1 + point * 0.1, y: 0.2,
      })),
    }).accepted, true);
  }
  broadcasts.length = 0;

  async function createPage(clientId) {
    let session = structuredClone(games.getSession());
    const nodes = new Map();
    const keyboard = new Map();
    const painted = [];
    const context = {
      fillRect: () => { painted.length = 0; },
      beginPath() {}, arc() {}, moveTo() {}, lineTo() {},
      fill() { painted.push(this.fillStyle); },
      stroke() { painted.push(this.strokeStyle); },
    };
    function byId(id) {
      if (!nodes.has(id)) nodes.set(id, {
        listeners: new Map(),
        addEventListener(type, listener) { this.listeners.set(type, listener); },
        classList: { toggle() {} },
        setAttribute() {},
        setPointerCapture() {},
        width: 100, height: 100,
        getContext: () => context,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      });
      return nodes.get(id);
    }
    const module = await loadModuleExports(
      path.join(__dirname, '..', 'public', 'js', 'overlays', 'games-drawing.js'),
      {
        document: {
          querySelectorAll: () => [],
          addEventListener: (type, listener) => keyboard.set(type, listener),
        },
        crypto: { randomUUID: () => clientId },
        setTimeout, clearTimeout,
        fetch: async (url, options) => {
          assert.equal(url, '/api/games/session/draw');
          assert.equal(options.method, 'POST');
          const operation = JSON.parse(options.body);
          requests.push(operation);
          let payload;
          await routes['POST /api/games/session/draw'](
            { games }, { body: async () => operation },
            { writeHead() {}, end: (body) => { payload = JSON.parse(body); } },
          );
          responses.push(payload);
          return { json: async () => payload };
        },
      },
    );
    const loadSnapshot = t.mock.fn(() => {
      session = structuredClone(games.getSession());
      controller.redrawCanvas(session.state.canvas);
      controller.setToolsEnabled(true);
    });
    const controller = module.createDrawController({
      byId, getSession: () => session,
      canDraw: () => session.state.phase === 'drawing',
      loadSnapshot, renderDanmaku() {},
    });
    controller.init();
    controller.redrawCanvas(session.state.canvas);
    controller.setToolsEnabled(true);
    t.after(() => controller.setToolsEnabled(false));
    return {
      controller, byId, painted, loadSnapshot,
      canvas: () => structuredClone(session.state.canvas),
      undo: () => byId('drawUndoBtn').listeners.get('click')(),
      shortcut: (modifier) => {
        const preventDefault = t.mock.fn();
        keyboard.get('keydown')({ key: 'z', [modifier]: true, preventDefault });
        assert.equal(preventDefault.mock.callCount(), 1);
      },
      pointer: (type, x) => byId('drawCanvas').listeners.get(type)({
        pointerType: 'mouse', button: 0, pointerId: 1,
        clientX: x, clientY: 20, preventDefault() {},
      }),
    };
  }
  const host = await createPage('host');
  const observer = await createPage('observer');
  return {
    games, host, observer, broadcasts, requests, responses,
    flushRequests: () => new Promise(setImmediate),
    deliver: (operation) => {
      host.controller.applyBroadcast(operation);
      observer.controller.applyBroadcast(operation);
    },
    assertSynchronized: () => {
      const expected = games.getSession().state.canvas;
      for (const page of [host, observer]) {
        assert.deepEqual(page.canvas(), expected);
        assert.deepEqual(page.painted, expected.strokes.map((stroke) => stroke.color));
        assert.equal(page.byId('drawUndoBtn').disabled, expected.strokes.length === 0);
      }
    },
  };
}

test('draw undo confirmation redraws the initiating canvas and other subscribers', async (t) => {
  const fixture = await createDrawingFixture(t);
  fixture.host.undo();
  await fixture.flushRequests();
  assert.deepEqual(fixture.requests, [{ action: 'undo', clientId: 'draw-host' }]);
  assert.deepEqual(fixture.responses, [{ ok: true, data: { revision: 3 } }]);
  assert.equal(fixture.host.canvas().strokes.length, 2);

  fixture.deliver(fixture.broadcasts[0]);

  fixture.assertSynchronized();
  assert.equal(fixture.host.canvas().totalPoints, 1);
  assert.equal(fixture.host.loadSnapshot.mock.callCount(), 0);
  assert.equal(fixture.observer.loadSnapshot.mock.callCount(), 0);
});

test('rapid Ctrl/Cmd+Z undoes successive strokes and duplicate echoes remove no extra stroke', async (t) => {
  const fixture = await createDrawingFixture(t);
  fixture.host.shortcut('ctrlKey');
  fixture.host.shortcut('metaKey');
  await fixture.flushRequests();
  assert.deepEqual(fixture.broadcasts.map((operation) => operation.strokeId), ['stroke-1', 'stroke-0']);
  fixture.deliver(fixture.broadcasts[0]);
  const afterFirst = fixture.host.canvas();
  fixture.deliver(fixture.broadcasts[0]);
  assert.deepEqual(fixture.host.canvas(), afterFirst);
  assert.equal(afterFirst.strokes.length, 1);
  assert.equal(afterFirst.totalPoints, 1);
  fixture.deliver(fixture.broadcasts[1]);
  fixture.assertSynchronized();
  assert.equal(fixture.host.canvas().totalPoints, 0);

  fixture.host.undo();
  fixture.host.shortcut('ctrlKey');
  await fixture.flushRequests();
  assert.equal(fixture.requests.length, 2);
});

test('draw undo uses the server-selected stroke when another page draws before the request arrives', async (t) => {
  const fixture = await createDrawingFixture(t);
  fixture.host.undo();
  assert.equal(fixture.games.draw({
    action: 'append', clientId: 'another-page', strokeId: 'remote-stroke',
    color: '#118ab2', width: 2, points: [{ x: 0.5, y: 0.5 }],
  }).accepted, true);
  await fixture.flushRequests();
  assert.equal(fixture.broadcasts[1].strokeId, 'remote-stroke');
  for (const operation of fixture.broadcasts) fixture.deliver(operation);
  fixture.assertSynchronized();
  assert.deepEqual(fixture.host.canvas().strokes.map((stroke) => stroke.id), ['stroke-0', 'stroke-1']);
});

test('undo finalizes the active stroke before sending and does not duplicate its append echo', async (t) => {
  const fixture = await createDrawingFixture(t);
  fixture.host.pointer('pointerdown', 30);
  fixture.host.pointer('pointermove', 40);
  fixture.host.shortcut('ctrlKey');
  await fixture.flushRequests();
  assert.deepEqual(fixture.requests.map((operation) => operation.action), ['append', 'undo']);
  const beforeEcho = fixture.host.canvas();
  fixture.deliver(fixture.broadcasts[0]);
  assert.deepEqual(fixture.host.canvas().strokes, beforeEcho.strokes);
  assert.equal(fixture.host.canvas().totalPoints, beforeEcho.totalPoints);
  fixture.deliver(fixture.broadcasts[1]);
  fixture.assertSynchronized();
  assert.equal(fixture.host.canvas().strokes.length, 2);
});

test('a rejected undo recovers the initiating canvas from the existing snapshot path', async (t) => {
  const fixture = await createDrawingFixture(t);
  fixture.games.draw({ action: 'clear', clientId: 'another-page' });
  fixture.broadcasts.length = 0;
  fixture.host.undo();
  await fixture.flushRequests();
  assert.equal(fixture.responses[0].ok, false);
  assert.equal(fixture.broadcasts.length, 0);
  assert.equal(fixture.host.loadSnapshot.mock.callCount(), 1);
  assert.deepEqual(fixture.host.canvas(), fixture.games.getSession().state.canvas);
  assert.deepEqual(fixture.host.painted, []);
  assert.equal(fixture.host.byId('drawUndoBtn').disabled, true);
});
