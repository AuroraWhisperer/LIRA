// 编写人：Aurora
// 消息处理器 — 处理和分发弹幕、SC、礼物等消息。
'use strict';

const packetParser = require('../packet-parser');
const bilibiliHelpers = require('../helpers');
const { SUPER_CHAT_PIN_THRESHOLD } = require('../superchat-service');
const { cleanText, now } = require('../../shared/utils');

class MessageHandlers {
  constructor(handlers, identityCache, deduplicator, diagnostics, options = {}) {
    this.handlers = handlers;
    this.identityCache = identityCache;
    this.deduplicator = deduplicator;
    this.diagnostics = diagnostics;
    this.runtimeGiftCommandPrefixes = options.runtimeGiftCommandPrefixes || new Set();
    this.startedAtMs = options.startedAtMs || Date.now();
  }

  updateStartTime(startedAtMs) {
    this.startedAtMs = startedAtMs;
  }

  async handlePackets(buffer) {
    this.diagnostics.lastPacketAt = now();
    for (const message of packetParser.parseBilibiliPackets(buffer)) {
      bilibiliHelpers.recordBilibiliCommandDiagnostic(this.diagnostics, message && message.cmd);

      if (message.cmd && String(message.cmd).startsWith('DANMU_MSG')) {
        this.handleDanmaku(message);
      } else if (message.cmd && String(message.cmd).startsWith('SUPER_CHAT_MESSAGE')) {
        this.handleSuperChat(message);
      } else if (packetParser.isBilibiliGiftCommand(message.cmd, this.runtimeGiftCommandPrefixes)) {
        this.handleGift(message);
      } else if (packetParser.isBilibiliGiftLikeCommand(message.cmd, this.runtimeGiftCommandPrefixes)) {
        bilibiliHelpers.logUnparsedGiftLikeCommand(message, 'gift-like-command');
        bilibiliHelpers.recordBilibiliGiftDiagnostic(this.diagnostics, message.cmd, 'gift-like-command');
      }
    }
  }

  handleDanmaku(message) {
    const info = message.info || [];
    const userInfo = info[2] || [];
    const userMeta = packetParser.extractBilibiliDanmakuUserMeta(info);
    const text = String(info[1] || '');
    const messageTimestamp = packetParser.extractBilibiliDanmakuTimestamp(info);

    if (isBilibiliCommandText(text) && !bilibiliHelpers.isCapturableBilibiliTimestamp(messageTimestamp, this.startedAtMs)) {
      return;
    }
    if (isBilibiliCommandText(text) && !this.deduplicator.remember(userInfo[0], text, messageTimestamp)) {
      return;
    }

    const requester = this.identityCache.resolve({
      uid: userInfo[0],
      userName: String(userInfo[1] || '观众'),
      requesterGuardLevel: userMeta.guardLevel,
      requesterMedalName: userMeta.medalName,
      requesterMedalLevel: userMeta.medalLevel
    });

    this.handlers.onMessage({
      message: text,
      uid: requester.uid,
      userName: requester.userName,
      requesterGuardLevel: requester.guardLevel,
      requesterMedalName: requester.medalName,
      requesterMedalLevel: requester.medalLevel,
      source: 'danmaku',
      messageTimestamp
    });
  }

  handleSuperChat(message) {
    const superChat = packetParser.extractBilibiliSuperChatMessage(message);
    const text = superChat.message;
    const requester = this.identityCache.resolve({
      uid: superChat.uid,
      userName: superChat.userName,
      requesterGuardLevel: superChat.guardLevel,
      requesterMedalName: superChat.medalName,
      requesterMedalLevel: superChat.medalLevel
    });

    this.handlers.onSuperChat({
      id: superChat.id,
      message: text,
      price: superChat.price,
      uid: requester.uid,
      userName: requester.userName,
      requesterGuardLevel: requester.guardLevel,
      requesterMedalName: requester.medalName,
      requesterMedalLevel: requester.medalLevel,
      source: 'superchat',
      messageTimestamp: superChat.messageTimestamp
    });

    if (!isBilibiliCommandText(text)) {
      return;
    }
    if (!bilibiliHelpers.isCapturableBilibiliTimestamp(superChat.messageTimestamp, this.startedAtMs)) {
      return;
    }
    if (!this.deduplicator.remember(superChat.uid || superChat.id, text, superChat.messageTimestamp)) {
      return;
    }

    this.handlers.onMessage({
      message: text,
      uid: requester.uid,
      userName: requester.userName,
      requesterGuardLevel: requester.guardLevel,
      requesterMedalName: requester.medalName,
      requesterMedalLevel: requester.medalLevel,
      source: 'superchat',
      messageTimestamp: superChat.messageTimestamp,
      isPinned: superChat.price >= SUPER_CHAT_PIN_THRESHOLD
    });
  }

  handleGift(message) {
    const gift = packetParser.extractBilibiliGiftMessage(message);
    if (!gift) {
      bilibiliHelpers.logUnparsedGiftLikeCommand(message, 'known-gift-command');
      bilibiliHelpers.recordBilibiliGiftDiagnostic(this.diagnostics, message.cmd, 'known-gift-command');
      return;
    }
    this.diagnostics.lastGiftAt = now();
    this.diagnostics.parsedGiftCount += 1;
    const requester = this.identityCache.resolve({
      uid: gift.uid,
      userName: gift.userName
    });
    this.handlers.onGift({
      ...gift,
      uid: requester.uid,
      userName: requester.userName
    });
  }
}

function isBilibiliCommandText(message) {
  const text = cleanText(message);
  return text.startsWith('点歌') || text.startsWith('随机');
}

module.exports = { MessageHandlers };
