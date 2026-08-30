'use strict';

const {
  cleanText,
  normalizeTimestampMs,
  normalizePositiveInteger,
  normalizeMoney,
  readObjectValue,
  safeJsonStringify,
} = require('../../shared/utils');
const {
  normalizeBilibiliGiftCoin,
  normalizeBilibiliCoinRmb,
  guardLevelName,
  detectGuardLevelFromName,
  buildBilibiliFallbackGiftId,
} = require('../utils/gift-normalizers');
const { readFirstObject } = require('../utils/user-meta-extractor');
const {
  buildBilibiliGuardPurchaseId,
  normalizeBilibiliGuardQuantity,
} = require('./gift-command-utils');

function extractBilibiliOpenLiveGuardGiftMessage(packet, data) {
  const userInfo = readFirstObject(data, ['user_info', 'userInfo']) || {};

  let guardLevel = normalizePositiveInteger(
    readObjectValue(data, ['guard_level', 'guardLevel']),
  );
  if (!guardLevel) {
    const giftName = cleanText(
      readObjectValue(data, ['gift_name', 'giftName', 'role_name', 'roleName']),
    );
    guardLevel = detectGuardLevelFromName(giftName);
  }

  const num = normalizeBilibiliGuardQuantity(
    readObjectValue(data, ['guard_num', 'guardNum', 'num']),
    readObjectValue(data, ['guard_unit', 'guardUnit', 'unit']),
  );
  const totalCoin = normalizeBilibiliGiftCoin(
    readObjectValue(data, ['price', 'total_price', 'totalPrice', 'amount']),
  );
  const totalPrice = normalizeBilibiliCoinRmb(totalCoin);

  return {
    platformId:
      cleanText(readObjectValue(data, ['msg_id', 'msgId'])) ||
      buildBilibiliFallbackGiftId(packet, data),
    cmd: cleanText(packet && packet.cmd),
    giftId: `guard-${guardLevel || 'unknown'}`,
    giftName: guardLevelName(guardLevel) || '大航海',
    uid: cleanText(
      readObjectValue(userInfo, ['open_id', 'openId', 'uid', 'mid']),
    ),
    userName:
      cleanText(
        readObjectValue(userInfo, [
          'uname',
          'user_name',
          'userName',
          'nickname',
        ]),
      ) || '观众',
    num,
    unitPrice: num > 0 ? normalizeMoney(totalPrice / num) : totalPrice,
    totalPrice,
    coinType: 'guard',
    isBlindBox: false,
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp:
      normalizeTimestampMs(
        readObjectValue(data, ['timestamp', 'ts', 'time']),
      ) || Date.now(),
  };
}

function extractBilibiliWebGuardGiftMessage(packet, data) {
  const cmd = cleanText(packet && packet.cmd);
  const senderInfo =
    readFirstObject(data, ['sender_uinfo', 'senderUinfo']) || {};
  const senderBase = readFirstObject(senderInfo, ['base']) || {};
  const guardInfo = readFirstObject(data, ['guard_info', 'guardInfo']) || data;
  const payInfo = readFirstObject(data, ['pay_info', 'payInfo']) || data;
  const giftInfo = readFirstObject(data, ['gift_info', 'giftInfo']) || data;

  let guardLevel = normalizePositiveInteger(
    readObjectValue(guardInfo, [
      'guard_level',
      'guardLevel',
      'privilege_type',
      'privilegeType',
    ]) ||
      readObjectValue(data, [
        'guard_level',
        'guardLevel',
        'privilege_type',
        'privilegeType',
      ]),
  );

  const rawGiftName = cleanText(
    readObjectValue(giftInfo, [
      'gift_name',
      'giftName',
      'role_name',
      'roleName',
      'role',
    ]) ||
      readObjectValue(guardInfo, [
        'role_name',
        'roleName',
        'gift_name',
        'giftName',
        'role',
      ]) ||
      readObjectValue(data, [
        'gift_name',
        'giftName',
        'role_name',
        'roleName',
        'role',
      ]),
  );
  if (!guardLevel) guardLevel = detectGuardLevelFromName(rawGiftName);

  const giftName = rawGiftName || guardLevelName(guardLevel) || '大航海';
  const num = normalizeBilibiliGuardQuantity(
    readObjectValue(payInfo, ['num']) ||
      readObjectValue(data, ['num', 'gift_num', 'giftNum']),
    readObjectValue(payInfo, ['unit', 'guard_unit', 'guardUnit']) ||
      readObjectValue(data, ['unit', 'guard_unit', 'guardUnit']),
  );
  const giftId =
    cleanText(
      readObjectValue(giftInfo, ['gift_id', 'giftId', 'giftid']) ||
        readObjectValue(data, ['gift_id', 'giftId', 'giftid']),
    ) || `guard-${guardLevel || 'unknown'}`;
  const uid = cleanText(
    readObjectValue(senderInfo, ['uid', 'mid']) ||
      readObjectValue(data, ['uid', 'mid']),
  );
  const payflowId = cleanText(
    readObjectValue(payInfo, ['payflow_id', 'payflowId']) ||
      readObjectValue(data, ['payflow_id', 'payflowId']),
  );
  const guardPurchaseId = buildBilibiliGuardPurchaseId(
    uid,
    giftId,
    readObjectValue(guardInfo, ['start_time', 'startTime']) ||
      readObjectValue(data, ['start_time', 'startTime']),
  );

  const explicitTotalCoin = normalizeBilibiliGiftCoin(
    readObjectValue(data, [
      'total_price',
      'totalPrice',
      'total_coin',
      'totalCoin',
      'pay_amount',
      'payAmount',
    ]),
  );
  const orderCoin = normalizeBilibiliGiftCoin(
    readObjectValue(payInfo, ['price', 'amount']) ||
      readObjectValue(data, ['price', 'gift_price', 'giftPrice', 'amount']),
  );
  const totalPrice = normalizeBilibiliCoinRmb(explicitTotalCoin || orderCoin);

  return {
    platformId: payflowId
      ? `guard-order:${payflowId}`
      : guardPurchaseId ||
        cleanText(
          readObjectValue(data, [
            'id',
            'tid',
            'gift_tid',
            'giftTid',
            'order_id',
            'orderId',
            'toast_msg_id',
            'toastMsgId',
            'msg_id',
            'msgId',
          ]),
        ) ||
        buildBilibiliFallbackGiftId(packet, data),
    cmd,
    giftId,
    giftName,
    uid,
    userName:
      cleanText(
        readObjectValue(senderBase, [
          'name',
          'uname',
          'user_name',
          'userName',
        ]) ||
          readObjectValue(senderInfo, [
            'username',
            'user_name',
            'userName',
            'uname',
            'nickname',
          ]) ||
          readObjectValue(data, [
            'username',
            'user_name',
            'userName',
            'uname',
            'nickname',
          ]),
      ) || '观众',
    num,
    unitPrice: totalPrice,
    totalPrice,
    coinType: 'guard',
    isBlindBox: false,
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp:
      normalizeTimestampMs(
        readObjectValue(data, [
          'timestamp',
          'ts',
          'time',
          'start_time',
          'startTime',
        ]),
      ) || Date.now(),
  };
}

module.exports = {
  extractBilibiliOpenLiveGuardGiftMessage,
  extractBilibiliWebGuardGiftMessage,
};
