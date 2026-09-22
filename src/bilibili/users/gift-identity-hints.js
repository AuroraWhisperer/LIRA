'use strict';

const { cleanText, normalizeGuardLevel, readObjectValue } = require('../../shared/utils');
const { readFirstObject } = require('../utils/user-meta-extractor');
const { firstProtoScalar, decodeBilibiliGiftV2Proto } = require('../protocols/protobuf-decoder');
const { isBilibiliDuplicateGuardToast, isBilibiliGiftLikeCommand } = require('../parsers/gift-command-utils');

function extractBilibiliGiftIdentity(packet) {
  const cmd = cleanText(packet?.cmd);
  if (!isBilibiliGiftLikeCommand(cmd) || cmd.startsWith('GUARD_BUY') || isBilibiliDuplicateGuardToast(packet))
    return null;
  const data = packet?.data;
  if (!data || typeof data !== 'object') return null;

  if (cmd.startsWith('SEND_GIFT_V2') && data.pb) {
    const root = decodeBilibiliGiftV2Proto(data.pb);
    const uid = cleanText(firstProtoScalar(root?.[1]));
    if (uid)
      return {
        hint: {
          uid,
          name: cleanText(firstProtoScalar(root?.[2])) || '观众',
          avatarUrl: '',
        },
        roomIdentityVerified: false,
      };
  }

  const sender = readFirstObject(data, ['sender_uinfo', 'senderUinfo', 'user_info', 'userInfo']) || {};
  const base = readFirstObject(sender, ['base']) || {};
  const uid = cleanText(
    readObjectValue(sender, ['uid', 'mid', 'open_id', 'openId']) ||
      readObjectValue(data, ['uid', 'mid', 'sender_uid', 'senderUid', 'open_id', 'openId']),
  );
  if (!uid) return null;
  const hint = {
    uid,
    name:
      cleanText(
        readObjectValue(base, ['name', 'uname', 'user_name', 'userName']) ||
          readObjectValue(sender, ['username', 'user_name', 'userName', 'uname', 'nickname']) ||
          readObjectValue(data, ['username', 'uname', 'user_name', 'userName', 'nickname']),
      ) || '观众',
    avatarUrl: cleanText(readObjectValue(base, ['face']) || readObjectValue(data, ['face'])),
  };
  let roomIdentityVerified = false;
  if (cmd.startsWith('USER_TOAST_MSG')) {
    const guard = readFirstObject(data, ['guard_info', 'guardInfo']) || data;
    const role = readFirstObject(data, ['gift_info', 'giftInfo']) || data;
    const keys = ['guard_level', 'guardLevel', 'privilege_type', 'privilegeType'];
    const names = ['gift_name', 'giftName', 'role_name', 'roleName', 'role'];
    const guardLevel =
      normalizeGuardLevel(readObjectValue(guard, keys) || readObjectValue(data, keys)) ||
      guardLevelFromName(readObjectValue(role, names) || readObjectValue(guard, names) || readObjectValue(data, names));
    if (guardLevel > 0) {
      hint.roomIdentity = { guardKnown: true, guardLevel };
      roomIdentityVerified = true;
    }
  }
  return { hint, roomIdentityVerified };
}

function guardLevelFromName(name) {
  const text = cleanText(name).replace(/\s+/g, '').toLowerCase();
  if (/总督|governor|viceroy/u.test(text)) return 1;
  if (/提督|admiral|commodore/u.test(text)) return 2;
  if (/舰长|captain|commander/u.test(text)) return 3;
  return /^[123]$/u.test(text) ? Number(text) : 0;
}

module.exports = { extractBilibiliGiftIdentity };
