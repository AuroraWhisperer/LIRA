// 编写人：Aurora
// 消息处理器 — 处理和分发弹幕、SC、礼物等消息。
'use strict';

const packetParser = require('../packet-parser');
const bilibiliHelpers = require('../helpers');
const { SUPER_CHAT_PIN_THRESHOLD } = require('../superchat-service');
const { cleanText, now, timestampToIso } = require('../../shared/utils');

class MessageHandlers {
  constructor(handlers, identityCache, deduplicator, diagnostics, options = {}) {
    this.handlers = handlers;
    this.identityCache = identityCache;
    this.deduplicator = deduplicator;
    this.diagnostics = diagnostics;
    this.runtimeGiftCommandPrefixes = options.runtimeGiftCommandPrefixes || new Set();
    this.startedAtMs = options.startedAtMs || Date.now();
    this.connectionGeneration = Number(options.connectionGeneration) || 0;
    this.connectionAttempt = Number(options.connectionAttempt) || 0;
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

  updateConnectionGeneration(connectionGeneration) {
    this.connectionGeneration = Number(connectionGeneration) || 0;
  }

  updateConnectionAttempt(connectionAttempt) {
    this.connectionAttempt = Number(connectionAttempt) || 0;
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
      messageTimestamp,
      connectionGeneration: this.connectionGeneration,
      connectionAttempt: this.connectionAttempt,
      cmd: normalizeBilibiliCommandName(message.cmd)
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
    const trace = {
      connectionGeneration: this.connectionGeneration,
      connectionAttempt: this.connectionAttempt,
      cmd: normalizeBilibiliCommandName(message.cmd)
    };

    console.log(formatBilibiliSuperChatLog({
      ...superChat,
      uid: requester.uid,
      userName: requester.userName
    }, trace));

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
      messageTimestamp: superChat.messageTimestamp,
      ...trace
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
      isPinned: superChat.price >= SUPER_CHAT_PIN_THRESHOLD,
      ...trace
    });
  }

  handleGift(message) {
    // GUARD_BUY only carries the list price. Wait for USER_TOAST_MSG with the paid total.
    if (cleanText(message && message.cmd).startsWith('GUARD_BUY')) return;

    const isKnownCmd = packetParser.isBilibiliGiftCommand(message.cmd, this.runtimeGiftCommandPrefixes);
    const gift = packetParser.extractBilibiliGiftMessage(message);

    if (!gift || !isValidGiftResult(gift)) {
      const dataKeys = message.data && typeof message.data === 'object'
        ? Object.keys(message.data).slice(0, 15).join(',') : 'N/A';
      const failureKind = !gift ? 'null-result' : 'validation-failed';
      const diagnosticReason = isKnownCmd ? 'known-gift-command' : 'gift-like-command';
      bilibiliHelpers.logUnparsedGiftLikeCommand(message, `${diagnosticReason}:${failureKind}`, {
        status: isKnownCmd ? 'rejected' : 'unrecognized',
        connectionGeneration: this.connectionGeneration,
        connectionAttempt: this.connectionAttempt
      });
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
        bilibiliHelpers.recordBilibiliGiftDiagnostic(this.diagnostics, message.cmd, 'known-gift-command');
      } else {
        bilibiliHelpers.recordBilibiliGiftDiagnostic(this.diagnostics, message.cmd, 'gift-like-command');
      }
      return;
    }

    // Keep one readable line per parsed gift; persistence is reflected in the UI.
    console.log(formatBilibiliGiftLog(gift, {
      connectionGeneration: this.connectionGeneration,
      connectionAttempt: this.connectionAttempt
    }));
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

function normalizeBilibiliCommandName(value) {
  const cmd = cleanText(value);
  if (cmd.startsWith('DANMU_MSG')) return 'DANMU_MSG';
  if (cmd.startsWith('SUPER_CHAT_MESSAGE')) return 'SUPER_CHAT_MESSAGE';
  return cmd;
}

function formatBilibiliGiftLog(gift, trace = null) {
  const userName = JSON.stringify(cleanText(gift && gift.userName) || '观众');
  const giftName = JSON.stringify(cleanText(gift && gift.giftName) || '未知礼物');
  const quantity = Math.max(1, Number(gift && gift.num) || 1);
  const totalPrice = Number(gift && gift.totalPrice);
  const amount = Number.isFinite(totalPrice) ? totalPrice.toFixed(2) : '0.00';
  const tags = [];
  if (gift && gift.isBlindBox) tags.push('blind-box');
  if (gift && gift.coinType && gift.coinType !== 'gold') tags.push(`coin=${gift.coinType}`);
  const suffix = tags.length > 0 ? ` ${tags.join(' ')}` : '';
  const traceSuffix = trace ? ` trace=${JSON.stringify({
    connectionGeneration: Number(trace.connectionGeneration) || 0,
    connectionAttempt: Number(trace.connectionAttempt) || 0,
    cmd: cleanText(gift && gift.cmd),
    platformId: cleanText(gift && gift.platformId),
    comboId: cleanText(gift && gift.comboId),
    messageTimestamp: timestampToIso(gift && gift.messageTimestamp)
  })}` : '';
  return `[Bilibili][Gift] status=parsed user=${userName} gift=${giftName} x${quantity} amount=¥${amount}${suffix}${traceSuffix}`;
}

function formatBilibiliSuperChatLog(superChat, trace = {}) {
  return `[Bilibili][SuperChat] status=received`
    + ` user=${JSON.stringify(cleanText(superChat && superChat.userName) || '观众')}`
    + ` uid=${JSON.stringify(cleanText(superChat && superChat.uid))}`
    + ` price=${Number(superChat && superChat.price) || 0}`
    + ` message=${JSON.stringify(cleanText(superChat && superChat.message))}`
    + ` trace=${JSON.stringify({
      connectionGeneration: Number(trace.connectionGeneration) || 0,
      connectionAttempt: Number(trace.connectionAttempt) || 0,
      cmd: cleanText(trace.cmd),
      messageTimestamp: timestampToIso(superChat && superChat.messageTimestamp)
    })}`;
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

module.exports = { MessageHandlers, formatBilibiliGiftLog, formatBilibiliSuperChatLog };
