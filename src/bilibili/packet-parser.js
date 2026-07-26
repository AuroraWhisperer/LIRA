'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {
  cleanText,
  normalizeTimestampMs,
  normalizeGuardLevel,
  normalizePositiveInteger,
  normalizeMoney,
  normalizeSuperChatPrice,
  safeJsonStringify,
  readObjectValue,
  parseBooleanLike
} = require('../shared/utils');

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

function splitJsonObjects(text) {
  if (!text) return [];
  const chunks = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        chunks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return chunks;
}

function normalizeBilibiliGiftCoin(value) {
  if (typeof value === 'string') {
    const match = value.match(/[\d.]+/);
    return match ? Number(match[0]) : 0;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeBilibiliCoinRmb(value) {
  const amount = normalizeBilibiliGiftCoin(value);
  return amount > 0 ? normalizeMoney(amount / 1000) : 0;
}

function guardLevelName(level) {
  if (Number(level) === 3) return '舰长';
  if (Number(level) === 2) return '提督';
  if (Number(level) === 1) return '总督';
  return '';
}

function buildBilibiliFallbackGiftId(packet, data) {
  return crypto.createHash('sha1')
    .update([
      cleanText(packet && packet.cmd),
      cleanText(readObjectValue(data, ['uid', 'mid', 'username', 'uname'])),
      cleanText(readObjectValue(data, ['gift_name', 'giftName', 'role_name', 'roleName'])),
      cleanText(readObjectValue(data, ['price', 'gift_price', 'giftPrice', 'total_price', 'totalPrice'])),
      cleanText(readObjectValue(data, ['timestamp', 'ts', 'time', 'start_time', 'startTime'])) || Math.floor(Date.now() / 1000)
    ].join('|'))
    .digest('hex');
}

function logUnparsedGiftLikeCommand(message, reason) {
  const cmd = cleanText(message && message.cmd);
  const data = message && message.data && typeof message.data === 'object' ? message.data : {};
  const keys = Object.keys(data).slice(0, 30).join(',');
  const preview = safeJsonStringify(data).slice(0, 260);
  console.warn(`[Bilibili] unparsed gift-like command: reason=${reason} cmd=${cmd} dataKeys=${keys} data=${preview}`);
}

function readMedalName(medalInfo) {
  if (Array.isArray(medalInfo)) {
    return cleanText(medalInfo[1]);
  }
  return cleanText(readObjectValue(medalInfo, ['medal_name', 'medalName', 'name']));
}

function readMedalLevel(medalInfo) {
  if (Array.isArray(medalInfo)) {
    return normalizePositiveInteger(medalInfo[0]);
  }
  return normalizePositiveInteger(readObjectValue(medalInfo, ['medal_level', 'medalLevel', 'level']));
}

function readFirstObject(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (value[key] && typeof value[key] === 'object') {
      return value[key];
    }
  }
  return null;
}

function firstProtoScalar(values) {
  if (!Array.isArray(values)) return '';
  const value = values.find((item) => item !== null && item !== undefined && typeof item !== 'object');
  return value === undefined ? '' : value;
}

function firstProtoObject(values) {
  if (!Array.isArray(values)) return null;
  return values.find((item) => item && typeof item === 'object' && !Buffer.isBuffer(item)) || null;
}

function decodeBilibiliProtoFields(buffer, depth = 0) {
  let offset = 0;
  const fields = {};

  while (offset < buffer.length) {
    const keyResult = readBilibiliProtoVarint(buffer, offset);
    if (!keyResult) return null;
    offset = keyResult.offset;

    const key = Number(keyResult.value);
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (!field || ![0, 1, 2, 5].includes(wireType)) return null;

    let value;
    if (wireType === 0) {
      const result = readBilibiliProtoVarint(buffer, offset);
      if (!result) return null;
      value = result.value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result.value) : result.value.toString();
      offset = result.offset;
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length) return null;
      value = buffer.subarray(offset, offset + 8);
      offset += 8;
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length) return null;
      value = buffer.subarray(offset, offset + 4);
      offset += 4;
    } else {
      const lengthResult = readBilibiliProtoVarint(buffer, offset);
      if (!lengthResult) return null;
      const length = Number(lengthResult.value);
      offset = lengthResult.offset;
      if (!Number.isFinite(length) || length < 0 || offset + length > buffer.length) return null;

      const chunk = buffer.subarray(offset, offset + length);
      offset += length;
      const nested = depth < 5 ? decodeBilibiliProtoFields(chunk, depth + 1) : null;
      value = nested && Object.keys(nested).length > 0 ? nested : chunk.toString('utf8');
    }

    if (!fields[field]) fields[field] = [];
    fields[field].push(value);
  }

  return fields;
}

// ---------------------------------------------------------------------------
// 1. parseBilibiliPackets
// ---------------------------------------------------------------------------

function parseBilibiliPackets(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 16 <= buffer.length) {
    const packetLength = buffer.readUInt32BE(offset);
    const headerLength = buffer.readUInt16BE(offset + 4);
    const protocolVersion = buffer.readUInt16BE(offset + 6);
    const operation = buffer.readUInt32BE(offset + 8);
    const bodyStart = offset + headerLength;
    const bodyEnd = offset + packetLength;
    const body = buffer.subarray(bodyStart, bodyEnd);

    if (operation === 5) {
      if (protocolVersion === 3) {
        try {
          messages.push(...parseBilibiliPackets(zlib.brotliDecompressSync(body)));
        } catch (error) {
          console.warn(`Bilibili brotli decode failed: ${error.message}`);
        }
      } else if (protocolVersion === 2) {
        try {
          messages.push(...parseBilibiliPackets(zlib.inflateSync(body)));
        } catch (error) {
          console.warn(`Bilibili zlib decode failed: ${error.message}`);
        }
      } else {
        const text = body.toString('utf8').trim();
        for (const chunk of splitJsonObjects(text)) {
          try {
            messages.push(JSON.parse(chunk));
          } catch (_) {
            // Ignore non-message packets.
          }
        }
      }
    }

    offset += packetLength > 0 ? packetLength : buffer.length;
  }
  return messages;
}

// ---------------------------------------------------------------------------
// 2. extractBilibiliDanmakuTimestamp
// ---------------------------------------------------------------------------

function extractBilibiliDanmakuTimestamp(info) {
  const metadata = Array.isArray(info) && Array.isArray(info[0]) ? info[0] : [];
  const candidates = [metadata[4], metadata[5], metadata[6]];
  const nowMs = Date.now();
  for (const candidate of candidates) {
    const timestamp = normalizeTimestampMs(candidate);
    if (timestamp && Math.abs(timestamp - nowMs) < 30 * 24 * 60 * 60 * 1000) {
      return timestamp;
    }
  }
  return nowMs;
}

// ---------------------------------------------------------------------------
// 3. extractBilibiliDanmakuUserMeta
// ---------------------------------------------------------------------------

function extractBilibiliDanmakuUserMeta(info) {
  const medalInfo = Array.isArray(info) ? info[3] : null;
  const extraInfo = Array.isArray(info) ? info[9] : null;
  return {
    guardLevel: normalizeGuardLevel(
      readObjectValue(extraInfo, ['guard_level', 'guardLevel'])
      || (Array.isArray(info) ? info[7] : 0)
    ),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo)
  };
}

// ---------------------------------------------------------------------------
// 4. extractBilibiliHistoryUserMeta
// ---------------------------------------------------------------------------

function extractBilibiliHistoryUserMeta(item) {
  const medalInfo = item && (item.medal || item.fans_medal || item.fansMedal || item.medal_info || item.medalInfo);
  return {
    guardLevel: normalizeGuardLevel(readObjectValue(item, ['guard_level', 'guardLevel', 'guard_level_v2'])),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo)
  };
}

// ---------------------------------------------------------------------------
// 5. extractBilibiliSuperChatMessage
// ---------------------------------------------------------------------------

function extractBilibiliSuperChatMessage(packet) {
  const data = packet && packet.data && typeof packet.data === 'object' ? packet.data : {};
  const userInfo = data.user_info || data.userInfo || {};
  const medalInfo = data.medal_info || data.medalInfo || userInfo.medal_info || userInfo.medalInfo;
  const messageTimestamp = normalizeTimestampMs(
    readObjectValue(data, ['start_time', 'startTime', 'ts', 'time', 'timestamp'])
  ) || Date.now();

  return {
    id: cleanText(readObjectValue(data, ['id', 'message_id', 'messageId', 'token'])),
    message: cleanText(readObjectValue(data, ['message', 'message_trans', 'messageTrans'])),
    price: normalizeSuperChatPrice(readObjectValue(data, ['price', 'rmb', 'price_text', 'priceText'])),
    uid: cleanText(readObjectValue(data, ['uid', 'mid']) || readObjectValue(userInfo, ['uid', 'mid'])),
    userName: cleanText(
      readObjectValue(userInfo, ['uname', 'name', 'user_name', 'userName'])
      || readObjectValue(data, ['uname', 'name', 'nickname'])
    ) || '观众',
    guardLevel: normalizeGuardLevel(
      readObjectValue(medalInfo, ['guard_level', 'guardLevel'])
      || readObjectValue(userInfo, ['guard_level', 'guardLevel'])
      || readObjectValue(data, ['guard_level', 'guardLevel'])
    ),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo),
    messageTimestamp
  };
}

// ---------------------------------------------------------------------------
// 6. extractBilibiliGiftMessage
// ---------------------------------------------------------------------------

function extractBilibiliGiftMessage(packet) {
  const data = packet && packet.data && typeof packet.data === 'object' ? packet.data : {};
  if (!data || Object.keys(data).length === 0) return null;

  const cmd = cleanText(packet && packet.cmd);
  if (cmd.startsWith('LIVE_OPEN_PLATFORM_SEND_GIFT')) {
    return extractBilibiliOpenLiveGiftMessage(packet, data);
  }

  if (cmd.startsWith('LIVE_OPEN_PLATFORM_GUARD')) {
    return extractBilibiliOpenLiveGuardGiftMessage(packet, data);
  }

  if (cmd.startsWith('GUARD_BUY') || cmd.startsWith('USER_TOAST_MSG')) {
    const guardGift = extractBilibiliWebGuardGiftMessage(packet, data);
    if (guardGift) return guardGift;
  }

  if (cmd.startsWith('SEND_GIFT_V2') && data.pb) {
    const parsedV2 = extractBilibiliGiftV2Message(packet, data);
    if (parsedV2) return parsedV2;
    logUnparsedGiftLikeCommand(packet, 'send-gift-v2-proto');
    return null;
  }

  return extractBilibiliWebGiftMessage(packet, data);
}

// ---------------------------------------------------------------------------
// 7. extractBilibiliGiftV2Message
// ---------------------------------------------------------------------------

function extractBilibiliGiftV2Message(packet, data) {
  const root = decodeBilibiliGiftV2Proto(data.pb);
  if (!root) return null;

  const giftInfo = firstProtoObject(root[10]);
  if (!giftInfo) return null;

  const cmd = cleanText(packet && packet.cmd);
  const giftId = cleanText(firstProtoScalar(giftInfo[1]));
  const giftName = cleanText(firstProtoScalar(giftInfo[2])) || '未知礼物';
  const num = Math.max(
    normalizePositiveInteger(firstProtoScalar(giftInfo[3])),
    normalizePositiveInteger(firstProtoScalar(giftInfo[4])),
    1
  );
  const coinType = cleanText(firstProtoScalar(giftInfo[8])).toLowerCase();
  const paid = coinType === 'gold';
  const unitCoin = normalizeBilibiliGiftCoin(
    firstProtoScalar(giftInfo[5])
    || firstProtoScalar(giftInfo[6])
  );
  const totalCoin = normalizeBilibiliGiftCoin(
    firstProtoScalar(giftInfo[7])
    || firstProtoScalar(giftInfo[14])
  );
  const unitPrice = paid ? normalizeMoney(unitCoin / 1000) : 0;
  const totalPrice = paid ? normalizeMoney(Math.max(totalCoin, unitCoin * num) / 1000) : 0;
  const timestamp = firstProtoScalar(giftInfo[10]);
  const comboId = cleanText(firstProtoScalar(giftInfo[12]));
  const tid = cleanText(firstProtoScalar(giftInfo[9]));

  return {
    platformId: tid || comboId,
    cmd,
    giftId,
    giftName,
    uid: cleanText(firstProtoScalar(root[1])),
    userName: cleanText(firstProtoScalar(root[2])) || '观众',
    num,
    unitPrice,
    totalPrice,
    coinType,
    isBlindBox: false,
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(timestamp) || Date.now()
  };
}

// ---------------------------------------------------------------------------
// 8. extractBilibiliOpenLiveGiftMessage
// ---------------------------------------------------------------------------

function extractBilibiliOpenLiveGiftMessage(packet, data) {
  const giftNum = normalizePositiveInteger(readObjectValue(data, ['gift_num', 'giftNum'])) || 1;
  const paid = parseBooleanLike(readObjectValue(data, ['paid', 'is_paid', 'isPaid']));
  const unitCoin = normalizeBilibiliGiftCoin(
    readObjectValue(data, ['r_price', 'rPrice'])
    || readObjectValue(data, ['price'])
  );
  const totalPrice = paid ? normalizeMoney(unitCoin * giftNum / 1000) : 0;

  return {
    platformId: cleanText(readObjectValue(data, ['msg_id', 'msgId'])) || buildBilibiliFallbackGiftId(packet, data),
    cmd: cleanText(packet && packet.cmd),
    giftId: cleanText(readObjectValue(data, ['gift_id', 'giftId'])),
    giftName: cleanText(readObjectValue(data, ['gift_name', 'giftName'])) || '未知礼物',
    uid: cleanText(readObjectValue(data, ['open_id', 'openId', 'uid', 'mid'])),
    userName: cleanText(readObjectValue(data, ['uname', 'user_name', 'userName', 'nickname'])) || '观众',
    num: giftNum,
    unitPrice: paid ? normalizeMoney(unitCoin / 1000) : 0,
    totalPrice,
    coinType: paid ? 'gold' : 'free',
    isBlindBox: Boolean(readObjectValue(data, ['blind_gift', 'blindGift', 'combo_gift', 'comboGift'])),
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(readObjectValue(data, ['timestamp', 'ts', 'time'])) || Date.now()
  };
}

// ---------------------------------------------------------------------------
// 9. extractBilibiliOpenLiveGuardGiftMessage
// ---------------------------------------------------------------------------

function extractBilibiliOpenLiveGuardGiftMessage(packet, data) {
  const userInfo = readFirstObject(data, ['user_info', 'userInfo']) || {};
  const guardLevel = normalizeGuardLevel(readObjectValue(data, ['guard_level', 'guardLevel']));
  const num = normalizePositiveInteger(readObjectValue(data, ['guard_num', 'guardNum', 'num'])) || 1;
  const totalCoin = normalizeBilibiliGiftCoin(readObjectValue(data, ['price']));
  const totalPrice = normalizeBilibiliCoinRmb(totalCoin);

  return {
    platformId: cleanText(readObjectValue(data, ['msg_id', 'msgId'])) || buildBilibiliFallbackGiftId(packet, data),
    cmd: cleanText(packet && packet.cmd),
    giftId: `guard-${guardLevel || 'unknown'}`,
    giftName: guardLevelName(guardLevel) || '大航海',
    uid: cleanText(readObjectValue(userInfo, ['open_id', 'openId', 'uid', 'mid'])),
    userName: cleanText(readObjectValue(userInfo, ['uname', 'user_name', 'userName', 'nickname'])) || '观众',
    num,
    unitPrice: num > 0 ? normalizeMoney(totalPrice / num) : totalPrice,
    totalPrice,
    coinType: 'gold',
    isBlindBox: false,
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(readObjectValue(data, ['timestamp', 'ts', 'time'])) || Date.now()
  };
}

// ---------------------------------------------------------------------------
// 10. extractBilibiliWebGiftMessage
// ---------------------------------------------------------------------------

function extractBilibiliWebGiftMessage(packet, data) {
  const cmd = cleanText(packet && packet.cmd);
  const blindInfo = readFirstObject(data, ['blind_gift', 'blindGift', 'blind_box', 'blindBox', 'origin_info', 'originInfo']);
  const num = normalizePositiveInteger(readObjectValue(data, ['num', 'gift_num', 'giftNum', 'combo_num', 'comboNum'])) || 1;
  const coinType = cleanText(readObjectValue(data, ['coin_type', 'coinType', 'coin'])).toLowerCase();
  const paid = coinType === 'gold' || parseBooleanLike(readObjectValue(data, ['paid', 'is_paid', 'isPaid']));
  const unitCoin = normalizeBilibiliGiftCoin(readObjectValue(data, [
    'price',
    'gift_price',
    'giftPrice',
    'discount_price',
    'discountPrice'
  ]));
  const totalCoin = normalizeBilibiliGiftCoin(readObjectValue(data, [
    'total_coin',
    'totalCoin',
    'total_price',
    'totalPrice',
    'combo_total_coin',
    'comboTotalCoin'
  ]));
  const unitPrice = paid ? normalizeMoney(unitCoin / 1000) : 0;
  const totalPrice = paid ? normalizeMoney((totalCoin > 0 ? totalCoin : unitCoin * num) / 1000) : 0;
  const blindBoxCoin = normalizeBilibiliGiftCoin(
    readObjectValue(blindInfo, [
      'original_gift_price',
      'originalGiftPrice',
      'price',
      'gift_price',
      'giftPrice',
      'original_price',
      'originalPrice'
    ])
    || readObjectValue(data, [
      'blind_original_gift_price',
      'blindOriginalGiftPrice',
      'blind_price',
      'blindPrice',
      'blind_box_price',
      'blindBoxPrice',
      'original_gift_price',
      'originalGiftPrice',
      'original_price',
      'originalPrice'
    ])
  );
  const blindBoxPrice = blindBoxCoin > 0 ? normalizeMoney(blindBoxCoin * num / 1000) : null;
  const isBlindBox = cmd.startsWith('BLIND_GIFT')
    || Boolean(blindInfo && Object.keys(blindInfo).length > 0)
    || Boolean(readObjectValue(data, ['blind_gift_id', 'blindGiftId', 'blind_box_id', 'blindBoxId']));

  return {
    platformId: cleanText(readObjectValue(data, [
      'msg_id',
      'msgId',
      'tid',
      'gift_tid',
      'giftTid',
      'rnd',
      'batch_combo_id',
      'batchComboId',
      'combo_id',
      'comboId'
    ])) || buildBilibiliFallbackGiftId(packet, data),
    cmd,
    giftId: cleanText(readObjectValue(data, ['giftId', 'gift_id', 'giftid'])),
    giftName: cleanText(readObjectValue(data, ['giftName', 'gift_name'])) || '未知礼物',
    uid: cleanText(readObjectValue(data, ['uid', 'mid', 'sender_uid', 'senderUid'])),
    userName: cleanText(readObjectValue(data, ['uname', 'user_name', 'userName', 'nickname'])) || '观众',
    num,
    unitPrice,
    totalPrice,
    coinType,
    isBlindBox,
    blindBoxName: cleanText(
      readObjectValue(blindInfo, [
        'original_gift_name',
        'originalGiftName',
        'gift_name',
        'giftName',
        'name'
      ])
      || readObjectValue(data, [
        'blind_original_gift_name',
        'blindOriginalGiftName',
        'blind_gift_name',
        'blindGiftName',
        'blind_box_name',
        'blindBoxName'
      ])
    ),
    blindBoxPrice,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(readObjectValue(data, ['timestamp', 'ts', 'time'])) || Date.now()
  };
}

// ---------------------------------------------------------------------------
// 11. extractBilibiliWebGuardGiftMessage
// ---------------------------------------------------------------------------

function extractBilibiliWebGuardGiftMessage(packet, data) {
  const cmd = cleanText(packet && packet.cmd);
  const senderInfo = readFirstObject(data, ['sender_uinfo', 'senderUinfo']) || {};
  const senderBase = readFirstObject(senderInfo, ['base']) || {};
  const guardInfo = readFirstObject(data, ['guard_info', 'guardInfo']) || data;
  const payInfo = readFirstObject(data, ['pay_info', 'payInfo']) || data;
  const giftInfo = readFirstObject(data, ['gift_info', 'giftInfo']) || data;
  const guardLevel = normalizeGuardLevel(readObjectValue(guardInfo, ['guard_level', 'guardLevel']) || readObjectValue(data, ['guard_level', 'guardLevel']));
  const giftName = cleanText(
    readObjectValue(giftInfo, ['gift_name', 'giftName', 'role_name', 'roleName', 'role'])
    || readObjectValue(data, ['gift_name', 'giftName', 'role_name', 'roleName', 'role'])
  ) || guardLevelName(guardLevel) || '大航海';
  const num = normalizePositiveInteger(readObjectValue(payInfo, ['num']) || readObjectValue(data, ['num', 'gift_num', 'giftNum'])) || 1;
  const explicitTotalCoin = normalizeBilibiliGiftCoin(readObjectValue(data, ['total_price', 'totalPrice', 'total_coin', 'totalCoin']));
  const unitCoin = normalizeBilibiliGiftCoin(readObjectValue(payInfo, ['price']) || readObjectValue(data, ['price', 'gift_price', 'giftPrice']));
  const totalPrice = normalizeBilibiliCoinRmb(explicitTotalCoin || unitCoin * num);
  const unitPrice = num > 0 ? normalizeMoney(totalPrice / num) : totalPrice;

  return {
    platformId: cleanText(readObjectValue(data, [
      'id',
      'tid',
      'gift_tid',
      'giftTid',
      'order_id',
      'orderId',
      'toast_msg_id',
      'toastMsgId',
      'msg_id',
      'msgId'
    ])) || buildBilibiliFallbackGiftId(packet, data),
    cmd,
    giftId: cleanText(readObjectValue(giftInfo, ['gift_id', 'giftId', 'giftid']) || readObjectValue(data, ['gift_id', 'giftId', 'giftid'])) || `guard-${guardLevel || 'unknown'}`,
    giftName,
    uid: cleanText(readObjectValue(senderInfo, ['uid', 'mid']) || readObjectValue(data, ['uid', 'mid'])),
    userName: cleanText(
      readObjectValue(senderBase, ['name', 'uname', 'user_name', 'userName'])
      || readObjectValue(senderInfo, ['username', 'user_name', 'userName', 'uname', 'nickname'])
      || readObjectValue(data, ['username', 'user_name', 'userName', 'uname', 'nickname'])
    ) || '观众',
    num,
    unitPrice,
    totalPrice,
    coinType: 'guard',
    isBlindBox: false,
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(readObjectValue(data, ['timestamp', 'ts', 'time', 'start_time', 'startTime'])) || Date.now()
  };
}

// ---------------------------------------------------------------------------
// 12. extractBilibiliOnlineRankUserMeta
// ---------------------------------------------------------------------------

function extractBilibiliOnlineRankUserMeta(item) {
  const medalInfo = item && (
    item.medalInfo
    || item.medal_info
    || item.medal
    || item.fans_medal
    || item.fansMedal
    || item.uinfo_medal
  );
  const guardInfo = item && (item.guard || item.guard_info || item.guardInfo);
  return {
    uid: cleanText(readObjectValue(item, ['uid', 'mid'])),
    userName: cleanText(readObjectValue(item, ['name', 'uname', 'nickname'])),
    guardLevel: normalizeGuardLevel(
      readObjectValue(medalInfo, ['guardLevel', 'guard_level'])
      || readObjectValue(item, ['guard_level', 'guardLevel'])
      || readObjectValue(guardInfo, ['level', 'guardLevel', 'guard_level'])
    ),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo)
  };
}

// ---------------------------------------------------------------------------
// 13. isBilibiliGiftCommand
// ---------------------------------------------------------------------------

function isBilibiliGiftCommand(cmd, runtimeGiftPrefixes) {
  const text = String(cmd || '');
  if (runtimeGiftPrefixes.has(text)) return true;
  for (const prefix of runtimeGiftPrefixes) {
    if (text.startsWith(`${prefix}_`)) return true;
  }
  return text.startsWith('SEND_GIFT')
    || text.startsWith('BLIND_GIFT')
    || text.startsWith('COMBO_SEND')
    || text.startsWith('GUARD_BUY')
    || text.startsWith('USER_TOAST_MSG')
    || text.startsWith('LIVE_OPEN_PLATFORM_SEND_GIFT')
    || text.startsWith('LIVE_OPEN_PLATFORM_GUARD');
}

// ---------------------------------------------------------------------------
// 14. isBilibiliGiftLikeCommand
// ---------------------------------------------------------------------------

function isBilibiliGiftLikeCommand(cmd, runtimeGiftPrefixes) {
  const text = String(cmd || '');
  return isBilibiliGiftCommand(text, runtimeGiftPrefixes)
    || text.includes('GIFT')
    || text.includes('COMBO')
    || text.includes('GUARD');
}

// ---------------------------------------------------------------------------
// 15. readBilibiliProtoVarint
// ---------------------------------------------------------------------------

function readBilibiliProtoVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  let index = offset;

  while (index < buffer.length && shift <= 63n) {
    const byte = BigInt(buffer[index]);
    index += 1;
    value |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) {
      return { value, offset: index };
    }
    shift += 7n;
  }

  return null;
}

// ---------------------------------------------------------------------------
// 16. decodeBilibiliGiftV2Proto
// ---------------------------------------------------------------------------

function decodeBilibiliGiftV2Proto(value) {
  try {
    const buffer = Buffer.from(cleanText(value), 'base64');
    if (buffer.length === 0) return null;
    return decodeBilibiliProtoFields(buffer, 0);
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parseBilibiliPackets,
  extractBilibiliDanmakuTimestamp,
  extractBilibiliDanmakuUserMeta,
  extractBilibiliHistoryUserMeta,
  extractBilibiliSuperChatMessage,
  extractBilibiliGiftMessage,
  extractBilibiliGiftV2Message,
  extractBilibiliOpenLiveGiftMessage,
  extractBilibiliOpenLiveGuardGiftMessage,
  extractBilibiliWebGiftMessage,
  extractBilibiliWebGuardGiftMessage,
  extractBilibiliOnlineRankUserMeta,
  isBilibiliGiftCommand,
  isBilibiliGiftLikeCommand,
  readBilibiliProtoVarint,
  decodeBilibiliGiftV2Proto
};
