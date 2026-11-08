'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRankingRows, rankingCountdown } = require('../../public/js/shared/live-rankings.js');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { createSceneExtraDisplay } = require('../../src/server/scene-extra-display');

test('nearby mode uses absolute ranks and never fabricates neighbors outside the returned list', () => {
  const board = { current: { rank: 5 }, rows: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, roomId: String(i + 1) })) };
  assert.deepEqual(selectRankingRows(board, { range: 'nearby', nearby: 2 }).map(row => row.rank), [3, 4, 5, 6, 7]);
  assert.deepEqual(selectRankingRows({ ...board, current: { rank: null } }, { range: 'nearby' }), []);
  assert.deepEqual(selectRankingRows({ ...board, eligible: false }, { range: 'nearby' }), []);
  assert.deepEqual(selectRankingRows(board, { range: 'all', pageSize: 4 }, 2).map(row => row.rank), [9, 10]);
  assert.equal(rankingCountdown({ endsAt: 3000 }, 3001), '等待新一轮榜单');
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
