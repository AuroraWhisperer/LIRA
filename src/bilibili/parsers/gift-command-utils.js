'use strict';

const { cleanText, readObjectValue } = require('../../shared/utils');
const { readFirstObject } = require('../utils/user-meta-extractor');

function isBilibiliDuplicateGuardToast(packet) {
  const cmd = cleanText(packet && packet.cmd);
  if (!cmd.startsWith('USER_TOAST_MSG_V2')) return false;
  const data =
    packet && packet.data && typeof packet.data === 'object' ? packet.data : {};
  const option = readFirstObject(data, ['option']) || {};
  const source =
    readObjectValue(option, ['source']) ?? readObjectValue(data, ['source']);
  return Number(source) === 2;
}

function isBilibiliGiftCommand(cmd) {
  const text = String(cmd || '');
  return (
    text.startsWith('SEND_GIFT') ||
    text.startsWith('BLIND_GIFT') ||
    text.startsWith('COMBO_SEND') ||
    text.startsWith('GUARD_BUY') ||
    text.startsWith('USER_TOAST_MSG') ||
    text.startsWith('LIVE_OPEN_PLATFORM_SEND_GIFT') ||
    text.startsWith('LIVE_OPEN_PLATFORM_GUARD')
  );
}

function isBilibiliGiftLikeCommand(cmd) {
  const text = String(cmd || '');
  if (
    text.startsWith('COMBO_END') ||
    text.startsWith('GIFT_STAR_PROCESS') ||
    text.startsWith('WIDGET_GIFT_STAR_PROCESS')
  ) {
    return false;
  }
  return (
    isBilibiliGiftCommand(text) ||
    text.includes('GIFT') ||
    text.includes('COMBO') ||
    text.includes('GUARD')
  );
}

module.exports = {
  isBilibiliDuplicateGuardToast,
  isBilibiliGiftCommand,
  isBilibiliGiftLikeCommand,
};
