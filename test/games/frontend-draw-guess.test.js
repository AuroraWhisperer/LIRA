'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const { readAdminFragmentHtml } = require('../helpers/admin-html');

const fixture = createUiFixture();

test('an interleaved eraser continuation has identical live and restored crossing pixels', async t => {
  const { createGameSessionService } = require('../../src/games/game-session-service');
  const { chooseGameWord } = require('../helpers/draw-guess');
  const { projectOverlayResponse } = require('../../src/server/overlay-projection');
  const ops = [];
  const games = createGameSessionService({ broadcast: event => { if (event.type === 'game:draw') ops.push(event.operation); } });
  t.after(() => games.dispose());
  games.start({ game: 'draw-guess' });
  chooseGameWord(games);
  const snapshot = () => projectOverlayResponse('games', '/api/games/session', games.getSession());
  const initial = snapshot();
  const append = (id, color, points) => assert.equal(games.draw({
    action: 'append', clientId: id, strokeId: id, color, width: 4, points,
  }).accepted, true);
  append('eraser', '#ffffff', [{ x: 0.1, y: 0.5 }]);
  append('pen', '#222034', [{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.9 }]);
  append('eraser', '#ffffff', [{ x: 0.9, y: 0.5 }]);
  const page = await fixture(t, 'games');
  await page.setContent('<canvas id="drawCanvas" width="100" height="100"></canvas><button id="drawUndoBtn"></button>');
  const pixels = await page.evaluate(async ({ initial, ops, final }) => {
    const { createDrawController } = await import('/js/overlays/games-drawing.js');
    const byId = id => document.getElementById(id);
    const controller = createDrawController({ byId, canDraw: () => true, getSession: () => initial });
    const pixel = () => Array.from(byId('drawCanvas').getContext('2d').getImageData(50, 50, 1, 1).data);
    controller.redrawCanvas(initial.state.canvas);
    const live = ops.map(op => { controller.applyBroadcast(op); return pixel(); });
    controller.redrawCanvas(final.state.canvas);
    return { live, restored: pixel() };
  }, { initial, ops, final: snapshot() });
  assert.deepEqual(pixels.live[1], [34, 32, 52, 255]);
  assert.deepEqual(pixels.live[2], [255, 255, 255, 255]);
  assert.deepEqual(pixels.restored, pixels.live[2]);
});

async function setup(t) {
  const page = await fixture(t, 'games');
  await page.setContent(readAdminFragmentHtml('pages/admin/toolbox/games.html'));
  await page.evaluate(async () => {
    document.getElementById('otherGamesFeature').hidden = false;
    window.game = { game: 'draw-guess', sessionId: 'test-game', state: { phase: 'choosing', round: 1, totalRounds: 3 } };
    window.host = { choices: [
      { word: '苹果', categoryId: 'food', category: '食物' },
      { word: '月亮', categoryId: 'nature', category: '自然' },
      { word: '<img src=x onerror=alert(1)>', categoryId: 'food', category: '食物' },
    ] };
    window.choices = [];
    const { createDrawWordPicker } = await import('/js/admin/games-word-picker.js');
    window.picker = createDrawWordPicker({
      onChoose: value => new Promise((resolve, reject) => window.choices.push({ value, resolve, reject })),
    });
    window.picker.sync(window.game, window.host);
  });
  return page;
}

test('host word picker lists all private choices, searches and submits exactly the chosen round once', async (t) => {
  const page = await setup(t);
  assert.equal(await page.locator('#drawWordChoices button').count(), 3);
  assert.equal(await page.locator('#drawWordChoices img').count(), 0);
  await page.locator('#drawWordSearch').fill('月');
  assert.equal(await page.locator('#drawWordChoices button').count(), 1);
  await page.locator('#drawWordChoices button').click();
  assert.equal(await page.evaluate(() => window.choices.length), 0, 'browsing and selecting does not start the clock');
  await page.locator('#drawChooseWordBtn').click();
  assert.deepEqual(await page.evaluate(() => window.choices[0].value), {
    action: 'choose-word', word: '月亮', sessionId: 'test-game', round: 1,
  });
  await page.locator('#drawChooseWordBtn').dispatchEvent('click');
  assert.equal(await page.evaluate(() => window.choices.length), 1);
  await page.evaluate(() => {
    window.picker.sync({ ...window.game, state: { ...window.game.state, phase: 'drawing' } });
    window.choices[0].resolve();
  });
});

test('host word picker retries the failed choice and ignores its completion in the next round', async (t) => {
  const page = await setup(t);
  await page.locator('#drawWordChoices button').filter({ hasText: /^苹果$/ }).click();
  await page.locator('#drawChooseWordBtn').click();
  await page.evaluate(() => window.choices[0].reject(new Error('临时请求失败')));
  await page.waitForFunction(() => !document.getElementById('drawChooseWordBtn').disabled);
  await page.locator('#drawChooseWordBtn').click();
  assert.equal(await page.evaluate(() => window.choices[1].value.word), '苹果');
  await page.evaluate(() => {
    window.game.state.round = 2;
    window.picker.sync(window.game, { choices: [{ word: '月亮', category: '自然' }] });
    window.choices[1].resolve();
  });
  await page.locator('#drawChooseWordBtn').dispatchEvent('click');
  assert.equal(await page.evaluate(() => window.choices.length), 2, 'a previous choice cannot start the next round');
  await page.locator('#drawWordChoices button').click();
  await page.locator('#drawChooseWordBtn').click();
  assert.deepEqual(await page.evaluate(() => {
    const { word, round } = window.choices[2].value;
    return { word, round };
  }), { word: '月亮', round: 2 });
  await page.evaluate(() => window.choices[2].resolve());
});
