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
    this.messageBuffer = options.messageBuffer || null;
    // 每 5 分钟清理一次身份缓存，防止无界增长
    this._identityCleanupTimer = setInterval(() => {
      if (this.identityCache && typeof this.identityCache.cleanup === 'function') {
        this.identityCache.cleanup();
      }
    }, 5 * 60 * 1000).unref();
  }

  updateStartTime(startedAtMs) {
    this.startedAtMs = startedAtMs;
  }

  // 销毁定时器，避免泄漏
  destroy() {
    if (this._identityCleanupTimer) {
      clearInterval(this._identityCleanupTimer);
      this._identityCleanupTimer = null;
    }
  }

  async handlePackets(buffer) {
    this.diagnostics.lastPacketAt = now();
    for (const message of packetParser.parseBilibiliPackets(buffer)) {
      bilibiliHelpers.recordBilibiliCommandDiagnostic(this.diagnostics, message && message.cmd);

      if (message.cmd && String(message.cmd).startsWith('DANMU_MSG')) {
        this.handleDanmaku(message);
      } else if (message.cmd && String(message.cmd).startsWith('SUPER_CHAT_MESSAGE')) {
        this.handleSuperChat(message);
      } else if (packetParser.isBilibiliGiftLikeCommand(message.cmd, this.runtimeGiftCommandPrefixes)) {
        // 所有 gift-like 消息都尝试解析，包括未知 CMD
        // extractBilibiliGiftMessage 有通用 fallback 能处理大部分格式
        this.handleGift(message);
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
    if (isBilibiliCommandText(text) && !this.deduplicator.remember(userInfo[0], text, messageTimestamp, {
      userName: userInfo[1],
      source: 'danmaku'
    })) {
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
    if (!this.deduplicator.remember(superChat.uid || superChat.id, text, superChat.messageTimestamp, {
      userName: superChat.userName,
      source: 'superchat'
    })) {
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
    const isKnownCmd = packetParser.isBilibiliGiftCommand(message.cmd, this.runtimeGiftCommandPrefixes);
    const gift = packetParser.extractBilibiliGiftMessage(message);

    if (!gift || !isValidGiftResult(gift)) {
      // 只对被拒绝的消息打日志，减少正常礼物的同步 I/O
      const dataKeys = message.data && typeof message.data === 'object'
        ? Object.keys(message.data).slice(0, 15).join(',') : 'N/A';
      console.log(`[GiftDebug] REJECTED CMD=${message.cmd || '(none)'} knownCmd=${isKnownCmd} reason=${!gift ? 'null-result' : 'validation-failed(giftId="' + (gift.giftId || '') + '" giftName="' + (gift.giftName || '') + '" totalPrice=' + (gift.totalPrice || 0) + '")'} dataKeys=[${dataKeys}]`);
      if (this.messageBuffer) {
        this.messageBuffer.record({
          cmd: message.cmd,
          category: isKnownCmd ? 'parse-failed' : 'unrecognized-cmd',
          rawData: message.data,
          detail: gift
            ? `Parsed but validation failed: giftId="${gift.giftId || ''}" giftName="${gift.giftName || ''}" totalPrice=${gift.totalPrice || 0}`
            : `extractBilibiliGiftMessage returned null; data keys: ${dataKeys}`
        });
      }
      if (isKnownCmd) {
        bilibiliHelpers.logUnparsedGiftLikeCommand(message, 'known-gift-command');
        bilibiliHelpers.recordBilibiliGiftDiagnostic(this.diagnostics, message.cmd, 'known-gift-command');
      } else {
        bilibiliHelpers.logUnparsedGiftLikeCommand(message, 'gift-like-command');
        bilibiliHelpers.recordBilibiliGiftDiagnostic(this.diagnostics, message.cmd, 'gift-like-command');
      }
      return;
    }

    // Keep one readable line per parsed gift; persistence is reflected in the UI.
    console.log(formatBilibiliGiftLog(gift));
    this.diagnostics.lastGiftAt = now();
    this.diagnostics.parsedGiftCount += 1;
    if (this.messageBuffer) {
      this.messageBuffer.record({
        cmd: message.cmd,
        category: 'parsed-ok',
        rawData: message.data,
        parsed: gift,
        detail: isKnownCmd ? '' : `New/unrecognized CMD parsed successfully via fallback`
      });
    }
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

function formatBilibiliGiftLog(gift) {
  const userName = JSON.stringify(cleanText(gift && gift.userName) || '观众');
  const giftName = JSON.stringify(cleanText(gift && gift.giftName) || '未知礼物');
  const quantity = Math.max(1, Number(gift && gift.num) || 1);
  const totalPrice = Number(gift && gift.totalPrice);
  const amount = Number.isFinite(totalPrice) ? totalPrice.toFixed(2) : '0.00';
  const tags = [];
  if (gift && gift.isBlindBox) tags.push('blind-box');
  if (gift && gift.coinType && gift.coinType !== 'gold') tags.push(`coin=${gift.coinType}`);
  const suffix = tags.length > 0 ? ` ${tags.join(' ')}` : '';
  return `[Bilibili][Gift] user=${userName} gift=${giftName} x${quantity} amount=¥${amount}${suffix}`;
}

/**
 * 验证解析后的礼物结果是否有意义的数据。
 * 过滤掉非礼物消息（CMD 碰巧含 GIFT 关键字但没有实际礼物字段）。
 */
function isValidGiftResult(gift) {
  if (!gift) return false;
  // 有真实 giftId（非空）
  if (gift.giftId && gift.giftId !== '') return true;
  // 有真实 giftName（非默认占位）
  if (gift.giftName && gift.giftName !== '未知礼物') return true;
  // 有付费金额 —— 即使名字解析不出来，有金额就是真礼物
  if (gift.totalPrice > 0) return true;
  // 盲盒
  if (gift.isBlindBox && gift.blindBoxPrice !== null && gift.blindBoxPrice > 0) return true;
  return false;
}

module.exports = { MessageHandlers, formatBilibiliGiftLog };
