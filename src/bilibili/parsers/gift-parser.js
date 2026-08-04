'use strict';

const {
  cleanText,
  normalizeTimestampMs,
  normalizePositiveInteger,
  normalizeMoney,
  parseBooleanLike,
  readObjectValue,
  safeJsonStringify
} = require('../../shared/utils');
const {
  firstProtoScalar,
  firstProtoObject,
  decodeBilibiliGiftV2Proto
} = require('../protocols/protobuf-decoder');
const {
  normalizeBilibiliGiftCoin,
  normalizeBilibiliCoinRmb,
  guardLevelName,
  detectGuardLevelFromName,
  buildBilibiliFallbackGiftId
} = require('../utils/gift-normalizers');
const { logUnparsedGiftLikeCommand } = require('../helpers');
const { readFirstObject } = require('../utils/user-meta-extractor');

// ---------------------------------------------------------------------------
// Gift message parsing utilities
// ---------------------------------------------------------------------------

function extractBilibiliGiftMessage(packet) {
  const data = packet && packet.data && typeof packet.data === 'object' ? packet.data : {};
  if (!data || Object.keys(data).length === 0) return null;

  const cmd = cleanText(packet && packet.cmd);
  if (cmd.startsWith('COMBO_END')) return null;

  if (cmd.startsWith('LIVE_OPEN_PLATFORM_SEND_GIFT')) {
    return extractBilibiliOpenLiveGiftMessage(packet, data);
  }

  if (cmd.startsWith('LIVE_OPEN_PLATFORM_GUARD')) {
    return extractBilibiliOpenLiveGuardGiftMessage(packet, data);
  }

  // GUARD_BUY carries the list price, not the final paid order amount.
  if (cmd.startsWith('GUARD_BUY')) return null;

  if (cmd.startsWith('USER_TOAST_MSG')) {
    const guardGift = extractBilibiliWebGuardGiftMessage(packet, data);
    if (guardGift) return guardGift;
  }

  if (cmd.startsWith('SEND_GIFT_V2') && data.pb) {
    const parsedV2 = extractBilibiliGiftV2Message(packet, data);
    if (parsedV2) return parsedV2;
    logUnparsedGiftLikeCommand(packet, 'send-gift-v2-proto');
    // 不直接返回 null —— fall through 到 web parser 尝试 JSON 字段提取
  }

  return extractBilibiliWebGiftMessage(packet, data);
}

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

function extractBilibiliOpenLiveGuardGiftMessage(packet, data) {
  const userInfo = readFirstObject(data, ['user_info', 'userInfo']) || {};

  // 大航海等级：优先从 guard_level 取，再从礼物名称反推
  let guardLevel = normalizePositiveInteger(readObjectValue(data, ['guard_level', 'guardLevel']));
  if (!guardLevel) {
    const giftName = cleanText(readObjectValue(data, ['gift_name', 'giftName', 'role_name', 'roleName']));
    guardLevel = detectGuardLevelFromName(giftName);
  }

  const num = normalizePositiveInteger(readObjectValue(data, ['guard_num', 'guardNum', 'num'])) || 1;
  // 价格：协议字段优先，找不到则用硬编码回退
  const totalCoin = normalizeBilibiliGiftCoin(readObjectValue(data, ['price', 'total_price', 'totalPrice', 'amount']));
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
    coinType: 'guard',
    isBlindBox: false,
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(readObjectValue(data, ['timestamp', 'ts', 'time'])) || Date.now()
  };
}

function extractBilibiliWebGiftMessage(packet, data) {
  const cmd = cleanText(packet && packet.cmd);
  const blindInfo = readFirstObject(data, ['blind_gift', 'blindGift', 'blind_box', 'blindBox', 'origin_info', 'originInfo']);
  const batchComboSend = readFirstObject(data, ['batch_combo_send', 'batchComboSend']);
  const comboSend = readFirstObject(data, ['combo_send', 'comboSend']);
  const eventNum = Math.max(
    normalizePositiveInteger(readObjectValue(data, ['num'])),
    normalizePositiveInteger(readObjectValue(data, ['gift_num', 'giftNum']))
  );
  const comboNum = Math.max(
    normalizePositiveInteger(readObjectValue(data, ['batch_combo_num', 'batchComboNum'])),
    normalizePositiveInteger(readObjectValue(data, ['combo_num', 'comboNum'])),
    normalizePositiveInteger(readObjectValue(batchComboSend, ['batch_combo_num', 'batchComboNum'])),
    normalizePositiveInteger(readObjectValue(comboSend, ['combo_num', 'comboNum']))
  );
  const num = eventNum || comboNum || 1;
  const coinType = cleanText(readObjectValue(data, ['coin_type', 'coinType', 'coin'])).toLowerCase();
  const unitCoin = normalizeBilibiliGiftCoin(readObjectValue(data, [
    'price',
    'gift_price',
    'giftPrice',
    'discount_price',
    'discountPrice'
  ]));
  // 注意：combo_total_coin 是连击累计总价，非本次礼物价格，不能作为 totalCoin 回退值
  const totalCoin = normalizeBilibiliGiftCoin(readObjectValue(data, [
    'total_coin',
    'totalCoin',
    'total_price',
    'totalPrice'
  ]));
  const comboTotalCoin = normalizeBilibiliGiftCoin(readObjectValue(data, [
    'combo_total_coin',
    'comboTotalCoin'
  ]));
  // Some COMBO_SEND packets omit coin_type but still carry cumulative paid amount.
  const hasComboAmount = cmd.startsWith('COMBO_SEND')
    && (comboTotalCoin > 0 || totalCoin > 0 || unitCoin > 0);
  const paid = coinType === 'gold'
    || (!coinType && (
      parseBooleanLike(readObjectValue(data, ['paid', 'is_paid', 'isPaid']))
      || hasComboAmount
    ));
  const unitPrice = paid ? normalizeMoney(unitCoin / 1000) : 0;
  const totalPriceCoin = totalCoin > 0
    ? totalCoin
    : cmd.startsWith('COMBO_SEND') && comboTotalCoin > 0
      ? comboTotalCoin
      : unitCoin * num;
  const totalPrice = paid ? normalizeMoney(totalPriceCoin / 1000) : 0;
  const comboTotalPrice = paid ? normalizeMoney(comboTotalCoin / 1000) : 0;
  const comboId = cleanText(readObjectValue(data, [
    'batch_combo_id',
    'batchComboId',
    'combo_id',
    'comboId'
  ]));
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
    comboId,
    cmd,
    giftId: cleanText(readObjectValue(data, ['giftId', 'gift_id', 'giftid'])),
    giftName: cleanText(readObjectValue(data, ['giftName', 'gift_name'])) || '未知礼物',
    uid: cleanText(readObjectValue(data, ['uid', 'mid', 'sender_uid', 'senderUid'])),
    userName: cleanText(readObjectValue(data, ['uname', 'user_name', 'userName', 'nickname'])) || '观众',
    num,
    comboNum,
    unitPrice,
    totalPrice,
    comboTotalPrice,
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

function extractBilibiliWebGuardGiftMessage(packet, data) {
  const cmd = cleanText(packet && packet.cmd);
  const senderInfo = readFirstObject(data, ['sender_uinfo', 'senderUinfo']) || {};
  const senderBase = readFirstObject(senderInfo, ['base']) || {};
  const guardInfo = readFirstObject(data, ['guard_info', 'guardInfo']) || data;
  const payInfo = readFirstObject(data, ['pay_info', 'payInfo']) || data;
  const giftInfo = readFirstObject(data, ['gift_info', 'giftInfo']) || data;

  // 大航海等级：优先从 guard_level 取，再从角色/礼物名称反推
  let guardLevel = normalizePositiveInteger(
    readObjectValue(guardInfo, ['guard_level', 'guardLevel', 'privilege_type', 'privilegeType'])
    || readObjectValue(data, ['guard_level', 'guardLevel', 'privilege_type', 'privilegeType'])
  );

  // 尝试从礼物名称中提取角色名（Bilibili 可能直接把 "舰长" 放在 gift_name / role_name）
  // USER_TOAST_MSG_V2: role_name 在 guard_info 子对象中
  const rawGiftName = cleanText(
    readObjectValue(giftInfo, ['gift_name', 'giftName', 'role_name', 'roleName', 'role'])
    || readObjectValue(guardInfo, ['role_name', 'roleName', 'gift_name', 'giftName', 'role'])
    || readObjectValue(data, ['gift_name', 'giftName', 'role_name', 'roleName', 'role'])
  );

  if (!guardLevel) {
    guardLevel = detectGuardLevelFromName(rawGiftName);
  }

  const giftName = rawGiftName || guardLevelName(guardLevel) || '大航海';
  const num = normalizePositiveInteger(readObjectValue(payInfo, ['num']) || readObjectValue(data, ['num', 'gift_num', 'giftNum'])) || 1;
  const giftId = cleanText(readObjectValue(giftInfo, ['gift_id', 'giftId', 'giftid']) || readObjectValue(data, ['gift_id', 'giftId', 'giftid'])) || `guard-${guardLevel || 'unknown'}`;
  const uid = cleanText(readObjectValue(senderInfo, ['uid', 'mid']) || readObjectValue(data, ['uid', 'mid']));
  const payflowId = cleanText(
    readObjectValue(payInfo, ['payflow_id', 'payflowId'])
    || readObjectValue(data, ['payflow_id', 'payflowId'])
  );
  const guardPurchaseId = buildBilibiliGuardPurchaseId(
    uid,
    giftId,
    readObjectValue(guardInfo, ['start_time', 'startTime']) || readObjectValue(data, ['start_time', 'startTime'])
  );

  // 价格提取：多字段回退 + 硬编码回退
  const explicitTotalCoin = normalizeBilibiliGiftCoin(
    readObjectValue(data, ['total_price', 'totalPrice', 'total_coin', 'totalCoin', 'pay_amount', 'payAmount'])
  );
  const orderCoin = normalizeBilibiliGiftCoin(
    readObjectValue(payInfo, ['price', 'amount'])
    || readObjectValue(data, ['price', 'gift_price', 'giftPrice', 'amount'])
  );
  // Toast price is the final paid order total; num only records the purchased months.
  const totalPrice = normalizeBilibiliCoinRmb(explicitTotalCoin || orderCoin);

  // 大航海的 num 表示购买月数，不是同价礼物数量；不要虚构平均月价。
  const unitPrice = totalPrice;

  return {
    platformId: payflowId ? `guard-order:${payflowId}` : guardPurchaseId || cleanText(readObjectValue(data, [
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
    giftId,
    giftName,
    uid,
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

function buildBilibiliGuardPurchaseId(uid, giftId, startTime) {
  const normalizedUid = cleanText(uid);
  const normalizedGiftId = cleanText(giftId);
  const normalizedStartTime = cleanText(startTime);
  if (!normalizedUid || !normalizedGiftId || !normalizedStartTime) return '';
  return `guard:${normalizedUid}:${normalizedGiftId}:${normalizedStartTime}`;
}

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

function isBilibiliGiftLikeCommand(cmd, runtimeGiftPrefixes) {
  const text = String(cmd || '');
  if (text.startsWith('COMBO_END')) return false;
  return isBilibiliGiftCommand(text, runtimeGiftPrefixes)
    || text.includes('GIFT')
    || text.includes('COMBO')
    || text.includes('GUARD');
}

module.exports = {
  extractBilibiliGiftMessage,
  extractBilibiliGiftV2Message,
  extractBilibiliOpenLiveGiftMessage,
  extractBilibiliOpenLiveGuardGiftMessage,
  extractBilibiliWebGiftMessage,
  extractBilibiliWebGuardGiftMessage,
  isBilibiliGiftCommand,
  isBilibiliGiftLikeCommand
};
