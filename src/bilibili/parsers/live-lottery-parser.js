'use strict';

const COMMANDS = new Map([
  ['ANCHOR_LOT_START', ['anchor-lottery', 'start']],
  ['ANCHOR_LOT_END', ['anchor-lottery', 'end']],
  ['ANCHOR_LOT_AWARD', ['anchor-lottery', 'award']],
  ['RED_POCKET_START', ['red-pocket', 'start']],
  ['POPULARITY_RED_POCKET_NEW', ['red-pocket', 'new']],
  ['POPULARITY_RED_POCKET_START', ['red-pocket', 'start']],
  ['POPULARITY_RED_POCKET_WINNER_LIST', ['red-pocket', 'award']],
  ['POPULARITY_RED_POCKET_V2_NEW', ['red-pocket', 'new']],
  ['POPULARITY_RED_POCKET_V2_START', ['red-pocket', 'start']],
  ['POPULARITY_RED_POCKET_V2_WINNER_LIST', ['red-pocket', 'award']],
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readId(value) {
  if (typeof value !== 'string' && !(Number.isSafeInteger(value) && value > 0)) return '';
  const id = String(value).trim();
  return /^[1-9]\d*$/u.test(id) ? id : '';
}

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readUser(uinfo, uid, userName, isMystery) {
  const identity = {
    uid: readId(uinfo?.uid) || readId(uid),
    userName: readText(uinfo?.base?.name) || readText(userName),
    isMystery: [true, 1].includes(uinfo?.base?.is_mystery ?? isMystery),
  };
  return identity.uid || identity.userName ? identity : null;
}

function readWinners(data, kind) {
  const entries = kind === 'anchor-lottery' ? data.award_users : data.winner_info;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    // Versioned red-pocket results use positional rows and a gift-ID keyed award table.
    const compact = kind === 'red-pocket' && readCount(data.version) > 0 && Array.isArray(entry);
    if (!compact && !isRecord(entry)) return [];
    const identity = compact
      ? readUser(entry[8], entry[0], entry[1], entry[4])
      : readUser(entry.uinfo, entry.uid, entry.uname ?? entry.name, entry.is_mystery);
    if (!identity) return [];
    const giftId = readId(compact ? entry[3] : entry.gift_id);
    const award = compact ? data.awards?.[giftId] : entry;
    return [{
      ...identity,
      giftId,
      giftCount: compact ? 1 : readCount(entry.gift_num),
      awardName: readText(award?.award_name),
      awardType: readCount(award?.award_type),
    }];
  });
}

/**
 * Convert one Bilibili JSON message into room-scoped lottery events.
 * `data` is an independent copy of the platform fields; times retain their upstream units.
 * NEW is a queue announcement, END closes entry, and AWARD carries the published result.
 * This parser has no network, persistence, participation or deduplication side effects.
 */
function extractBilibiliLiveLotteryEvents(message, { roomId = '' } = {}) {
  const command = typeof message?.cmd === 'string' ? message.cmd.trim().split(':')[0] : '';
  const route = COMMANDS.get(command);
  if (!route) return [];
  const [kind, phase] = route;
  const data = message.data;
  let entries = [data];
  if (kind === 'red-pocket' && phase === 'start') {
    if (Array.isArray(data)) entries = data;
    else if (Array.isArray(data?.list)) entries = data.list;
    else if (Array.isArray(data?.lot_info)) entries = data.lot_info;
  }
  const sourceRoomId = readId(roomId);
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const rawId = kind === 'anchor-lottery' ? entry.id : entry.lot_id ?? entry.id;
    const id = readId(rawId);
    const explicitRoomId = entry.room_id ?? entry.roomid;
    const eventRoomId = explicitRoomId === undefined ? sourceRoomId : readId(explicitRoomId);
    const sender = kind === 'red-pocket'
      ? readUser(entry.sender_uinfo ?? entry.sender_info, entry.sender_uid ?? entry.uid,
        entry.sender_name ?? entry.uname, entry.is_mystery)
      : null;
    // NEW may contain only the queue count/sender; it does not always identify a lottery.
    const announcement = phase === 'new' && rawId === undefined &&
      (sender !== null || readCount(entry.wait_num_v2 ?? entry.wait_num) !== null);
    if ((!id && !announcement) || !eventRoomId) return [];
    return [{
      kind,
      phase,
      command,
      id,
      roomId: eventRoomId,
      sourceRoomId,
      sender,
      winners: phase === 'award' ? readWinners(entry, kind) : [],
      data: structuredClone(entry),
    }];
  });
}

module.exports = { extractBilibiliLiveLotteryEvents };
