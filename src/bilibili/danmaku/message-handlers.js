// 编写人：Aurora
// 消息处理器 — 处理和分发弹幕、SC、礼物等消息。
'use strict';

const packetParser = require('../packet-parser');
const bilibiliHelpers = require('../helpers');
const { SUPER_CHAT_PIN_THRESHOLD } = require('../superchat-service');
const { detectGuardLevelFromName } = require('../utils/gift-normalizers');
const { isBilibiliCommandText } = require('./command-text');
const { cleanText, now, timestampToIso } = require('../../shared/utils');

class MessageHandlers {
  constructor(handlers, userInfoService, deduplicator, diagnostics, options = {}) {
    this.handlers = handlers;
    this.userInfoService = userInfoService;
    this.deduplicator = deduplicator;
    this.diagnostics = diagnostics;
    this.runtimeGiftCommandPrefixes = options.runtimeGiftCommandPrefixes || new Set();
    this.startedAtMs = options.startedAtMs || Date.now();
    this.connectionGeneration = Number(options.connectionGeneration) || 0;
    this.connectionAttempt = Number(options.connectionAttempt) || 0;
    this.roomOwnerUid = cleanText(options.roomOwnerUid);
    this.roomRunContext = null;
    this.messageBuffer = options.messageBuffer || null;
    this.isCommandText = typeof options.isCommandText === 'function'
      ? options.isCommandText
      : isBilibiliCommandText;
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

  updateRoomOwnerUid(roomOwnerUid) {
    this.roomOwnerUid = cleanText(roomOwnerUid);
  }

  updateRoomRunContext(roomRunContext) {
    this.roomRunContext = roomRunContext || null;
  }

  // 销毁定时器，避免泄漏
  destroy() {
    this.roomRunContext = null;
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
    const userMeta = packetParser.extractBilibiliDanmakuUserMeta(info, this.roomOwnerUid);
    const text = String(info[1] || '');
    const messageTimestamp = packetParser.extractBilibiliDanmakuTimestamp(info);
    const avatarUrl = packetParser.extractBilibiliDanmakuAvatarUrl(info);
    const emotes = packetParser.extractBilibiliDanmakuEmotes(info);

    if (this.isCommandText(text) && !bilibiliHelpers.isCapturableBilibiliTimestamp(messageTimestamp, this.startedAtMs)) {
      return;
    }
    if (this.isCommandText(text) && !this.deduplicator.remember(userInfo[0], text, messageTimestamp, {
      userName: userInfo[1],
      source: 'danmaku'
    })) {
      return;
    }

    const requester = this.ingestIdentity({
      uid: userInfo[0],
      name: String(userInfo[1] || '观众'),
      avatarUrl,
      roomIdentity: roomIdentityFromMeta(userMeta)
    }, 'danmaku', userMeta.currentRoomVerified);

    this.handlers.onMessage({
      message: text,
      emotes,
      uid: requester.uid,
      userName: requester.userName,
      requesterGuardLevel: requester.guardLevel,
      requesterMedalName: requester.medalName,
      requesterMedalLevel: requester.medalLevel,
      source: 'danmaku',
      messageTimestamp,
      avatarUrl: requester.avatarUrl,
      connectionGeneration: this.connectionGeneration,
      connectionAttempt: this.connectionAttempt,
      cmd: normalizeBilibiliCommandName(message.cmd)
    });
  }

  handleSuperChat(message) {
    const superChat = packetParser.extractBilibiliSuperChatMessage(message, this.roomOwnerUid);
    const text = superChat.message;
    const requester = this.ingestIdentity({
      uid: superChat.uid,
      name: superChat.userName,
      avatarUrl: superChat.avatarUrl,
      roomIdentity: roomIdentityFromMeta(superChat)
    }, 'superchat', superChat.currentRoomVerified);
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
      currentRoomVerified: superChat.currentRoomVerified,
      source: 'superchat',
      messageTimestamp: superChat.messageTimestamp,
      ...trace
    });

    if (!this.isCommandText(text)) {
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
      avatarUrl: requester.avatarUrl,
      currentRoomVerified: superChat.currentRoomVerified,
      source: 'superchat',
      messageTimestamp: superChat.messageTimestamp,
      isPinned: superChat.price >= SUPER_CHAT_PIN_THRESHOLD,
      ...trace
    });
  }

  handleGift(message) {
    // GUARD_BUY only carries the list price. Wait for USER_TOAST_MSG with the paid total.
    if (cleanText(message && message.cmd).startsWith('GUARD_BUY')) return;
    // USER_TOAST_MSG_V2 source=2 is a companion of the paid source=0 message.
    if (packetParser.isBilibiliDuplicateGuardToast(message)) return;

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
    const isVerifiedGuardPurchase = cleanText(gift.cmd).startsWith('USER_TOAST_MSG')
      && normalizeGuardLevelFromGift(gift) > 0;
    const requester = this.ingestIdentity({
      uid: gift.uid,
      name: gift.userName,
      avatarUrl: gift.avatarUrl,
      roomIdentity: isVerifiedGuardPurchase ? {
        guardKnown: true,
        guardLevel: normalizeGuardLevelFromGift(gift)
      } : undefined
    }, 'gift', isVerifiedGuardPurchase);
    this.handlers.onGift({
      ...gift,
      uid: requester.uid,
      userName: requester.userName
    });
  }

  ingestIdentity(hint, source, roomIdentityVerified) {
    const fallback = {
      uid: cleanText(hint && hint.uid),
      userName: cleanText(hint && hint.name) || '观众',
      avatarUrl: cleanText(hint && hint.avatarUrl),
      guardLevel: 0,
      medalName: '',
      medalLevel: 0
    };
    if (!this.roomRunContext) return fallback;
    const result = this.userInfoService.ingestHint(hint, {
      ...this.roomRunContext,
      source,
      roomIdentityVerified: roomIdentityVerified === true
    });
    return compatibilityRequester(result.snapshot, fallback);
  }
}

function roomIdentityFromMeta(meta = {}) {
  const verified = meta.currentRoomVerified === true;
  return {
    guardKnown: verified,
    guardLevel: meta.guardLevel,
    medalKnown: verified,
    fansMedal: meta.medalName ? {
      name: meta.medalName,
      level: meta.medalLevel,
      targetUid: meta.medalTargetUid
    } : null
  };
}

function compatibilityRequester(snapshot, fallback) {
  if (!snapshot) return fallback;
  const medal = snapshot.fansMedal && snapshot.fansMedal.known
    ? snapshot.fansMedal.value
    : null;
  return {
    uid: snapshot.uid,
    userName: snapshot.name || fallback.userName,
    avatarUrl: snapshot.avatarUrl || fallback.avatarUrl,
    guardLevel: snapshot.guard && snapshot.guard.known ? snapshot.guard.level : 0,
    medalName: medal ? medal.name : '',
    medalLevel: medal ? medal.level : 0
  };
}

function normalizeGuardLevelFromGift(gift) {
  const match = /^guard-(\d+)$/.exec(cleanText(gift && gift.giftId));
  if (match) return Number(match[1]);
  return detectGuardLevelFromName(gift && gift.giftName);
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
