'use strict';

const { BilibiliApiClient } = require('./danmaku/api-client');

function positiveId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  const id = String(value ?? '');
  return /^[1-9]\d{0,19}$/.test(id) ? id : '';
}

async function fetchGuardRoster(roomInput, { signal, fetchImpl = fetch } = {}) {
  const input = positiveId(roomInput);
  if (!input) throw new Error('请先在连接设置中填写直播间号。');
  const headers = new BilibiliApiClient(input).requestHeaders();
  async function read(path, params) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(12000);
    const response = await fetchImpl(
      `https://api.live.bilibili.com${path}?${new URLSearchParams(params)}`,
      {
        headers,
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    if (!response.ok) throw new Error('B站暂时无法读取名单，请稍后重试。');
    const payload = await response.json();
    if (payload?.code !== 0 || !payload.data)
      throw new Error('B站未返回有效名单，请稍后重试。');
    return payload.data;
  }

  const room = await read('/room/v1/Room/room_init', { id: input });
  const roomId = positiveId(room.room_id);
  const ownerUid = positiveId(room.uid);
  if (!roomId || !ownerUid)
    throw new Error('无法确认房间及房主，请检查直播间号。');
  const members = new Map();
  const seen = new Set();
  let total;
  let skipped = 0;
  for (let page = 1; page <= 1000; page++) {
    const data = await read('/xlive/app-room/v2/guardTab/topListNew', {
      roomid: roomId,
      ruid: ownerUid,
      page: String(page),
      page_size: '30',
    });
    const count = data.info?.num;
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 10000 ||
      (total !== undefined && total !== count) ||
      !Array.isArray(data.list) ||
      (page === 1 && !Array.isArray(data.top3))
    )
      throw new Error('大航海名单不完整或正在变化，请重新同步。');
    total = count;
    const before = seen.size;
    const rows = [...(page === 1 ? data.top3 : []), ...data.list];
    for (const item of rows) {
      if (positiveId(item?.ruid) !== ownerUid)
        throw new Error('大航海名单的房主不匹配，请重新同步。');
      const user = item.uinfo;
      const uid = positiveId(user?.uid);
      const hidden = user?.base?.is_mystery === true;
      const key =
        uid && !hidden ? `uid:${uid}` : `rank:${positiveId(item.rank)}`;
      if (key === 'rank:') throw new Error('大航海名单缺少可靠身份。');
      if (seen.has(key)) continue;
      seen.add(key);
      if (!uid || hidden) {
        skipped++;
        continue;
      }
      const level =
        user?.guard?.level ??
        (positiveId(user?.medal?.ruid) === ownerUid
          ? user.medal.guard_level
          : null);
      if (![1, 2, 3].includes(level))
        throw new Error('大航海名单等级无效，请重新同步。');
      const rawName =
        typeof user.base?.name === 'string' ? user.base.name.trim() : '';
      const name = /[＊*]|\.\.\.|…|^(神秘人|神秘用户|用户|观众)$/.test(rawName)
        ? ''
        : rawName;
      const avatar =
        typeof user.base?.face === 'string' &&
        /^https:\/\//.test(user.base.face)
          ? user.base.face
          : '';
      members.set(uid, { uid, name, avatar, level });
    }
    if (seen.size === total) {
      signal?.throwIfAborted();
      return {
        roomId,
        ownerUid,
        observedAt: new Date().toISOString(),
        members: [...members.values()],
        skipped,
      };
    }
    if (seen.size > total || seen.size === before)
      throw new Error('大航海名单未完整读取，请重新同步。');
  }
  throw new Error('大航海名单页数超出限制，本次没有导入。');
}

module.exports = { fetchGuardRoster };
