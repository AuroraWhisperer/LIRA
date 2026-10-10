'use strict';

function positiveId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  const id = String(value ?? '');
  return /^[1-9]\d{0,19}$/.test(id) ? id : '';
}

async function readGuardRoster(read, roomId, ownerUid, signal) {
  if (!positiveId(roomId) || !positiveId(ownerUid)) throw new Error('无法确认房间及房主。');
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
      if (positiveId(item?.ruid) !== ownerUid) throw new Error('大航海名单的房主不匹配，请重新同步。');
      const user = item.uinfo;
      const uid = positiveId(user?.uid);
      const hidden = user?.base?.is_mystery === true;
      const key = uid && !hidden ? `uid:${uid}` : `rank:${positiveId(item.rank)}`;
      if (key === 'rank:') throw new Error('大航海名单缺少可靠身份。');
      if (seen.has(key)) continue;
      seen.add(key);
      if (!uid || hidden) {
        skipped++;
        continue;
      }
      const level = user?.guard?.level ?? (positiveId(user?.medal?.ruid) === ownerUid ? user.medal.guard_level : null);
      if (![1, 2, 3].includes(level)) throw new Error('大航海名单等级无效，请重新同步。');
      const rawName = typeof user.base?.name === 'string' ? user.base.name.trim() : '';
      const name = /[＊*]|\.\.\.|…|^(神秘人|神秘用户|用户|观众)$/.test(rawName) ? '' : rawName;
      const avatar = typeof user.base?.face === 'string' && /^https:\/\//.test(user.base.face) ? user.base.face : '';
      const medalLevel =
        positiveId(user?.medal?.ruid) === ownerUid && Number.isSafeInteger(user.medal.level) && user.medal.level >= 0
          ? user.medal.level
          : null;
      const accompanyDays = Number.isSafeInteger(item.accompany) && item.accompany >= 0 ? item.accompany : null;
      members.set(uid, { uid, name, avatar, level, medalLevel, ...(accompanyDays === null ? {} : { accompanyDays }) });
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
    if (seen.size > total || seen.size === before) throw new Error('大航海名单未完整读取，请重新同步。');
  }
  throw new Error('大航海名单页数超出限制，本次没有导入。');
}

module.exports = { positiveId, readGuardRoster };
