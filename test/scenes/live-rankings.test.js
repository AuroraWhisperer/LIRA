'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRankingRows } = require('../../public/js/shared/live-rankings.js');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { createSceneExtraDisplay } = require('../../src/server/scene-extra-display');

test('nearby mode uses absolute ranks and never fabricates neighbors outside the returned list', () => {
  const board = { current: { rank: 5 }, rows: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, roomId: String(i + 1) })) };
  assert.deepEqual(selectRankingRows(board, { range: 'nearby', nearby: 2 }).map(row => row.rank), [3, 4, 5, 6, 7]);
  assert.deepEqual(selectRankingRows({ ...board, current: { rank: null } }, { range: 'nearby' }), []);
  assert.deepEqual(selectRankingRows({ ...board, eligible: false }, { range: 'nearby' }), []);
  assert.deepEqual(selectRankingRows(board, { range: 'all', pageSize: 4 }, 2).map(row => row.rank), [9, 10]);
});

test('ranking display configuration follows scene validation and data versions avoid duplicate payloads', () => {
  const config = normalizeSceneConfig('live-rankings', { ...createSceneExtraDefaults('live-rankings'), nearby: 0, columns: '4' });
  assert.equal(config.nearby, 0);
  assert.throws(() => normalizeSceneConfig('live-rankings', { ...config, nearby: 1000 }));
  const snapshot = { version: 'one', room: { roomId: '8' }, boards: [] };
  const display = createSceneExtraDisplay({ displayPorts: { liveRankings: { getSnapshot: () => snapshot } } });
  const versions = { known: {}, current: {} };
  assert.equal(display('live-rankings', null, { dataVersions: versions }).room.roomId, '8');
  assert.equal(display('live-rankings', null, { dataVersions: { known: versions.current, current: {} } }), undefined);
});

test('height-based nearby rows keep the current room visible and use available neighbors at either end', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ rank: index + 1 }));
  const board = { current: { rank: 6 }, rows };
  const ranks = (current, capacity) => selectRankingRows({ ...board, current: { rank: current } }, { range: 'nearby' }, 0, capacity).map(row => row.rank);
  assert.deepEqual(ranks(6, 4), [5, 6, 7, 8]);
  assert.deepEqual(ranks(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(ranks(12, 4), [9, 10, 11, 12]);
  assert.deepEqual(ranks(20, 4), []);
});

test('height-based pagination covers every rank once and wraps after the last partial page', () => {
  const rows = Array.from({ length: 11 }, (_, index) => ({ rank: index + 1 }));
  const read = page => selectRankingRows({ rows }, { range: 'all', pageSize: 5 }, page, 4).map(row => row.rank);
  assert.deepEqual([0, 1, 2].flatMap(read), rows.map(row => row.rank));
  assert.deepEqual(read(3), read(0));
  assert.deepEqual(selectRankingRows({ rows }, { range: 'all' }, 0, 0), []);
});
