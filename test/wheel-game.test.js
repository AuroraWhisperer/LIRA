'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chooseWeightedEntry,
  createWheelSessionService,
  normalizeWheelEntries
} = require('../src/games/wheel-session-service');
const { createGameSessionService } = require('../src/games/game-session-service');
const { normalizeWheelConfigInput, routes } = require('../src/server/routes/game-routes');

test('wheel validates entries and selects an entry by its configured share count', () => {
  assert.throws(() => normalizeWheelEntries([{ label: '仅一个选项', weight: 1 }]), /2-12/);
  assert.throws(() => normalizeWheelEntries([
    { label: '重复', weight: 1 },
    { label: '重复', weight: 2 }
  ]), /不能重复/);
  assert.throws(() => normalizeWheelEntries([
    { label: 'A', weight: 1 },
    { label: 'B', weight: 0 }
  ]), /1-100/);

  const entries = [
    { label: '一等奖', weight: 1 },
    { label: '谢谢参与', weight: 3 }
  ];
  assert.equal(chooseWeightedEntry(entries, () => 0), 0);
  assert.equal(chooseWeightedEntry(entries, () => 0.25), 1);
  assert.equal(chooseWeightedEntry(entries, () => 0.999), 1);
});

test('wheel configuration and drawing are independent from the two-game session lock', () => {
  const published = [];
  const wheel = createWheelSessionService({ broadcast: payload => published.push(payload), random: () => 0 });
  const games = createGameSessionService();
  games.start({ game: 'number-bomb', mode: 'multi' });

  const configured = wheel.configure([
    { label: '唱一首歌', weight: 2 },
    { label: '再来一次', weight: 1 }
  ]);
  assert.equal(configured.totalWeight, 3);
  assert.equal(games.getSession().game, 'number-bomb');

  const drawn = wheel.spin();
  assert.equal(drawn.lastResult.label, '唱一首歌');
  assert.equal(drawn.spin.index, 0);
  assert.equal(published.at(-1).type, 'wheel:update');
  assert.throws(() => wheel.configure([
    { label: '新选项 A', weight: 1 },
    { label: '新选项 B', weight: 1 }
  ]), error => error.statusCode === 409);
});

test('wheel routes normalize config and return the service state in the standard envelope', async () => {
  assert.deepEqual(normalizeWheelConfigInput({ entries: [{ label: '  A  ', weight: 2 }] }), [{ label: 'A', weight: 2 }]);
  let status;
  let payload;
  const wheel = createWheelSessionService({ random: () => 0 });
  const response = {
    writeHead(nextStatus) { status = nextStatus; },
    end(body) { payload = JSON.parse(body); }
  };

  await routes['POST /api/wheel/config'](
    { wheel },
    { body: async () => ({ entries: [{ label: 'A', weight: 1 }, { label: 'B', weight: 4 }] }) },
    response
  );

  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.totalWeight, 5);
});
