'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveRankProvider, RANK_BOARDS } = require('../../src/bilibili/live-rank-provider');
const signal = () => new AbortController().signal;

test('rank provider uses the room-recommended category and distinct official boards', async () => {
  const requests = [];
  const provider = createLiveRankProvider({ fetch: async url => {
    requests.push(url);
    const data = url.pathname.endsWith('getRankTabConfigWithList') ? {
      popular_rank_tab_list: [{ type: 1, sub_tab_list: [{ type: 1, title: '全站' },
        { type: 3, title: '唱见', parent_area_id: 1, area_id: 21, rank_id: 7 }] }],
    } : { list: [], list_new: [], anchor_permission: false, countdown: 30, data: { countdown: 40 },
      current_room: { room_id: 88, rank: 0, score: 1234, rank_distance_score: 12,
        uinfo: { uid: 9, base: { name: '<b>主播</b>', face: 'https://untrusted.test/a.png' } } } };
    return Response.json({ code: 0, data });
  } });
  const context = await provider.getContext({ roomId: '88', uid: '9' }, signal());
  const boards = await Promise.all(RANK_BOARDS.map(board => provider.getBoard(board, context, signal())));
  assert.equal(requests[1].searchParams.get('sub_rank_type'), '1');
  assert.equal(requests[2].searchParams.get('sub_rank_type'), '2');
  assert.equal(requests[3].searchParams.get('rank_type'), '1');
  assert.equal(requests[4].searchParams.get('rank_type'), '3');
  assert.equal(requests[4].searchParams.get('area_id'), '21');
  assert.equal(boards[3].title, '人气 · 唱见');
  assert.equal(boards[0].current.score, 1234);
  assert.equal(boards[0].current.rank, null);
  assert.equal(boards[0].current.avatarUrl, '');
  assert.equal(boards[1].eligible, false);
});

test('rank provider rejects failed or malformed upstream data instead of publishing an empty success', async () => {
  const context = { room: { roomId: '88', uid: '9' }, area: null };
  let response = Response.json({ code: -400, message: 'upstream detail' });
  const provider = createLiveRankProvider({ fetch: async () => response });
  await assert.rejects(provider.getBoard(RANK_BOARDS[0], context, signal()));
  response = Response.json({ code: 0, data: {} });
  await assert.rejects(provider.getBoard(RANK_BOARDS[0], context, signal()));
  response = new Response('', { status: 429, headers: { 'Retry-After': '8' } });
  await assert.rejects(provider.getBoard(RANK_BOARDS[0], context, signal()), error => error.retryAfterMs === 8000);
  const missing = await provider.getBoard(RANK_BOARDS[3], context, signal());
  assert.equal(missing.status, 'unavailable');
});
