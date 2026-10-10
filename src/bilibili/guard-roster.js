'use strict';

const { BilibiliApiClient } = require('./danmaku/api-client');
const { readResponseText } = require('../shared/response-body');

const { positiveId, readGuardRoster } = require('../shared/bilibili-guard-roster');

async function fetchGuardRoster(roomInput, { signal, fetchImpl = fetch } = {}) {
  const input = positiveId(roomInput);
  if (!input) throw new Error('请先在连接设置中填写直播间号。');
  const headers = new BilibiliApiClient(input).requestHeaders();
  async function read(path, params) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(12000);
    const response = await fetchImpl(`https://api.live.bilibili.com${path}?${new URLSearchParams(params)}`, {
      headers,
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error('B站暂时无法读取名单，请稍后重试。');
    const payload = JSON.parse(await readResponseText(response, 4 * 1024 * 1024, () => new Error('B站名单响应过大。')));
    if (payload?.code !== 0 || !payload.data) throw new Error('B站未返回有效名单，请稍后重试。');
    return payload.data;
  }

  const room = await read('/room/v1/Room/room_init', { id: input });
  const roomId = positiveId(room.room_id);
  const ownerUid = positiveId(room.uid);
  if (!roomId || !ownerUid) throw new Error('无法确认房间及房主，请检查直播间号。');
  return readGuardRoster(read, roomId, ownerUid, signal);
}

module.exports = { fetchGuardRoster };
