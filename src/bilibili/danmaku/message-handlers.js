// 编写人：Aurora
// 消息处理器 — 处理和分发弹幕、SC、礼物等消息。
'use strict';

const packetParser = require('../packet-parser');
const bilibiliHelpers = require('../helpers');
const { SUPER_CHAT_PIN_THRESHOLD } = require('../superchat-service');
const { extractBilibiliGiftIdentity } = require('../users/gift-identity-hints');
const { isBilibiliCommandText } = require('./command-text');
const { cleanText, now, timestampToIso } = require('../../shared/utils');
const { logBilibiliDiagnostic, logSongRequest } = require('../diagnostics');

class MessageHandlers {
  constructor(
    handlers,
    userInfoService,
    deduplicator,
    diagnostics,
    options = {},
  ) {
    this.handlers = handlers;
    this.userInfoService = userInfoService;
    this.deduplicator = deduplicator;
    this.diagnostics = diagnostics;
    this.startedAtMs = options.startedAtMs || Date.now();
    this.connectionGeneration = Number(options.connectionGeneration) || 0;
    this.connectionAttempt = Number(options.connectionAttempt) || 0;
    this.roomOwnerUid = cleanText(options.roomOwnerUid);
    this.roomRunContext = null;
    this.isCommandText =
      typeof options.isCommandText === 'function'
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
    this.danmakuCount = 0;
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

  async handlePackets(buffer, ingress) {
    let packetSeq = 0;
    this.diagnostics.lastPacketAt = now();
    for (const message of packetParser.parseBilibiliPackets(buffer)) {
      bilibiliHelpers.recordBilibiliCommandDiagnostic(
        this.diagnostics,
        message && message.cmd,
      );

      if (message.cmd && String(message.cmd).startsWith('DANMU_MSG')) {
        this.handleDanmaku(message, ingress && { ...ingress, packetSeq: packetSeq++ });
      } else if (
        message.cmd &&
        String(message.cmd).startsWith('SUPER_CHAT_MESSAGE')
      ) {
        this.handleSuperChat(message);
      } else if (packetParser.isBilibiliGiftLikeCommand(message.cmd)) {
        this.handleIdentityMessage(message);
      }
    }
  }

  handleDanmaku(message, ingress) {
    const info = message.info || [];
    const userInfo = info[2] || [];
    const userMeta = packetParser.extractBilibiliDanmakuUserMeta(
      info,
      this.roomOwnerUid,
    );
    const text = String(info[1] || '');
    const messageTimestamp = packetParser.extractBilibiliDanmakuTimestamp(info);
    if (ingress) {
      const rawTime = Number(info[0]?.[4]);
      const platformTime = rawTime > 1e12 ? rawTime : rawTime > 1e9 ? rawTime * 1000 : null;
      this.handlers.onRealtimeDanmaku?.({
        ...ingress, source: 'danmaku', message: text, uid: userInfo[0],
        platformTime: Number.isFinite(platformTime) ? platformTime : null,
        // No stable platform event ID has been verified; do not fabricate one.
        eventId: null,
      });
    }
    const avatarUrl = packetParser.extractBilibiliDanmakuAvatarUrl(info);
    const emotes = packetParser.extractBilibiliDanmakuEmotes(info);
    const diagnosticMessage = {
      message: text, uid: userInfo[0], userName: userInfo[1], messageTimestamp,
      source: 'danmaku', connectionGeneration: this.connectionGeneration,
      connectionAttempt: this.connectionAttempt,
    };
    this.danmakuCount = (this.danmakuCount || 0) + 1;
    if (this.danmakuCount === 1) {
      logBilibiliDiagnostic('danmaku-first-received', {
        connectionGeneration: this.connectionGeneration,
        connectionAttempt: this.connectionAttempt,
        nameMasked: /\*{2,}/.test(String(userInfo[1] || '')),
      });
    }
    logSongRequest('command-ingress', diagnosticMessage);

    if (
      this.isCommandText(text) &&
      !bilibiliHelpers.isCapturableBilibiliTimestamp(
        messageTimestamp,
        this.startedAtMs,
      )
    ) {
      logSongRequest('command-filtered', diagnosticMessage, {
        reason: 'stale-timestamp', listenerStartedAt: this.startedAtMs,
      });
      return;
    }
    if (
      this.isCommandText(text) &&
      !this.deduplicator.remember(userInfo[0], text, messageTimestamp, {
        userName: userInfo[1],
        source: 'danmaku',
      })
    ) {
      return;
    }

    const requester = this.ingestIdentity(
      {
        uid: userInfo[0],
        name: String(userInfo[1] || '观众'),
        avatarUrl,
        roomIdentity: roomIdentityFromMeta(userMeta),
      },
      'danmaku',
      userMeta.currentRoomVerified,
    );

    this.handlers.onMessage({
      message: text,
      emotes,
      uid: requester.uid,
      identityType: 'uid',
      userName: requester.userName,
      ...(this.roomOwnerUid && String(requester.uid) === this.roomOwnerUid ? { isStreamer: true } : {}),
      requesterGuardLevel: requester.guardLevel,
      requesterMedalName: requester.medalName,
      requesterMedalLevel: requester.medalLevel,
      source: 'danmaku',
      messageTimestamp,
      avatarUrl: requester.avatarUrl,
      connectionGeneration: this.connectionGeneration,
      connectionAttempt: this.connectionAttempt,
      cmd: normalizeBilibiliCommandName(message.cmd),
    });
  }

  handleSuperChat(message) {
    const superChat = packetParser.extractBilibiliSuperChatMessage(
      message,
      this.roomOwnerUid,
    );
    const text = superChat.message;
    const requester = this.ingestIdentity(
      {
        uid: superChat.uid,
        name: superChat.userName,
        avatarUrl: superChat.avatarUrl,
        roomIdentity: roomIdentityFromMeta(superChat),
      },
      'superchat',
      superChat.currentRoomVerified,
    );
    const trace = {
      connectionGeneration: this.connectionGeneration,
      connectionAttempt: this.connectionAttempt,
      cmd: normalizeBilibiliCommandName(message.cmd),
    };
    const diagnosticMessage = { ...superChat, source: 'superchat', ...trace };
    logSongRequest('command-ingress', diagnosticMessage);

    console.log(
      formatBilibiliSuperChatLog(
        {
          ...superChat,
          uid: requester.uid,
          userName: requester.userName,
        },
        trace,
      ),
    );

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
      ...trace,
    });

    if (!this.isCommandText(text)) {
      return;
    }
    if (
      !bilibiliHelpers.isCapturableBilibiliTimestamp(
        superChat.messageTimestamp,
        this.startedAtMs,
      )
    ) {
      logSongRequest('command-filtered', diagnosticMessage, {
        reason: 'stale-timestamp',
        listenerStartedAt: this.startedAtMs,
      });
      return;
    }
    if (
      !this.deduplicator.remember(
        superChat.uid || superChat.id,
        text,
        superChat.messageTimestamp,
        {
          userName: superChat.userName,
          source: 'superchat',
        },
      )
    ) {
      return;
    }

    this.handlers.onMessage({
      message: text,
      uid: requester.uid,
      identityType: 'uid',
      userName: requester.userName,
      requesterGuardLevel: requester.guardLevel,
      requesterMedalName: requester.medalName,
      requesterMedalLevel: requester.medalLevel,
      avatarUrl: requester.avatarUrl,
      currentRoomVerified: superChat.currentRoomVerified,
      source: 'superchat',
      messageTimestamp: superChat.messageTimestamp,
      isPinned: superChat.price >= SUPER_CHAT_PIN_THRESHOLD,
      ...trace,
    });
  }

  handleIdentityMessage(message) {
    const identity = extractBilibiliGiftIdentity(message);
    if (!identity) return;
    this.ingestIdentity(identity.hint, 'gift', identity.roomIdentityVerified);
  }

  ingestIdentity(hint, source, roomIdentityVerified) {
    const fallback = {
      uid: cleanText(hint && hint.uid),
      userName: cleanText(hint && hint.name) || '观众',
      avatarUrl: cleanText(hint && hint.avatarUrl),
      guardLevel: 0,
      medalName: '',
      medalLevel: 0,
    };
    if (!this.roomRunContext) return fallback;
    const result = this.userInfoService.ingestHint(hint, {
      ...this.roomRunContext,
      source,
      roomIdentityVerified: roomIdentityVerified === true,
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
    fansMedal: meta.medalName
      ? {
          name: meta.medalName,
          level: meta.medalLevel,
          targetUid: meta.medalTargetUid,
        }
      : null,
  };
}

function compatibilityRequester(snapshot, fallback) {
  if (!snapshot) return fallback;
  const medal =
    snapshot.fansMedal && snapshot.fansMedal.known
      ? snapshot.fansMedal.value
      : null;
  return {
    uid: snapshot.uid,
    userName: snapshot.name || fallback.userName,
    avatarUrl: snapshot.avatarUrl || fallback.avatarUrl,
    guardLevel:
      snapshot.guard && snapshot.guard.known ? snapshot.guard.level : 0,
    medalName: medal ? medal.name : '',
    medalLevel: medal ? medal.level : 0,
  };
}

function normalizeBilibiliCommandName(value) {
  const cmd = cleanText(value);
  if (cmd.startsWith('DANMU_MSG')) return 'DANMU_MSG';
  if (cmd.startsWith('SUPER_CHAT_MESSAGE')) return 'SUPER_CHAT_MESSAGE';
  return cmd;
}

function formatBilibiliSuperChatLog(superChat, trace = {}) {
  return (
    `[Bilibili][SuperChat] status=received` +
    ` user=${JSON.stringify(cleanText(superChat && superChat.userName) || '观众')}` +
    ` uid=${JSON.stringify(cleanText(superChat && superChat.uid))}` +
    ` price=${Number(superChat && superChat.price) || 0}` +
    ` message=${JSON.stringify(cleanText(superChat && superChat.message))}` +
    ` trace=${JSON.stringify({
      connectionGeneration: Number(trace.connectionGeneration) || 0,
      connectionAttempt: Number(trace.connectionAttempt) || 0,
      cmd: cleanText(trace.cmd),
      messageTimestamp: timestampToIso(superChat && superChat.messageTimestamp),
    })}`
  );
}

module.exports = {
  MessageHandlers,
  formatBilibiliSuperChatLog,
};
