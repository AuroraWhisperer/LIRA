// 编写人：Aurora
// 历史消息轮询器 — 定时拉取历史弹幕消息作为补偿监听。
'use strict';

const packetParser = require('../packet-parser');
const bilibiliHelpers = require('../helpers');
const { isBilibiliCommandText } = require('./command-text');
const { cleanText, normalizeTimestampMs } = require('../../shared/utils');

class HistoryPoller {
  constructor(apiClient, onMessage, options = {}) {
    this.apiClient = apiClient;
    this.onMessage = onMessage;
    this.startedAtMs = options.startedAtMs || Date.now();
    this.roomOwnerUid = cleanText(options.roomOwnerUid);
    this.isCommandText =
      typeof options.isCommandText === 'function'
        ? options.isCommandText
        : isBilibiliCommandText;
    this.onIdentityHint =
      typeof options.onIdentityHint === 'function'
        ? options.onIdentityHint
        : null;
    this.deduplicator = options.deduplicator || null;
    this.timer = null;
    this.pollInFlight = false;
    this.localGeneration = 0;
  }

  start(context) {
    this.stop();
    if (!context || !context.roomId || !context.ownerUid) return;
    const localGeneration = ++this.localGeneration;
    this.pollHistory(context, localGeneration).catch((error) => {
      console.warn(`[Bilibili] history polling failed: ${error.message}`);
    });
    this.timer = setInterval(() => {
      this.pollHistory(context, localGeneration).catch((error) => {
        console.warn(`[Bilibili] history polling failed: ${error.message}`);
      });
    }, 2500);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.localGeneration += 1;
  }

  updateStartTime(startedAtMs) {
    this.startedAtMs = startedAtMs;
  }

  updateRoomOwnerUid(roomOwnerUid) {
    this.roomOwnerUid = cleanText(roomOwnerUid);
  }

  async pollHistory(context, localGeneration = this.localGeneration) {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const data = await this.apiClient.fetchHistory(context.roomId);
      if (localGeneration !== this.localGeneration) return;
      const messages = []
        .concat(Array.isArray(data.admin) ? data.admin : [])
        .concat(Array.isArray(data.room) ? data.room : []);
      messages.sort(
        (a, b) =>
          parseBilibiliTimeline(a.timeline) - parseBilibiliTimeline(b.timeline),
      );

      let processed = 0;
      for (const item of messages) {
        if (localGeneration !== this.localGeneration) return;
        const text = cleanText(item.text);
        if (!text) continue;
        const timelineMs = parseBilibiliTimeline(item.timeline);
        if (!this.isCommandText(text)) continue;
        if (
          !bilibiliHelpers.isCapturableBilibiliTimestamp(
            timelineMs,
            this.startedAtMs,
          )
        )
          continue;
        if (
          this.deduplicator &&
          !this.deduplicator.remember(item.uid, text, timelineMs, {
            userName: item.nickname || item.uname,
            source: 'history',
          })
        )
          continue;

        processed += 1;
        const userMeta = packetParser.extractBilibiliHistoryUserMeta(
          item,
          this.roomOwnerUid,
        );
        let identitySnapshot = null;
        if (this.onIdentityHint) {
          if (localGeneration !== this.localGeneration) return;
          const result = this.onIdentityHint(toIdentityHint(item, userMeta), {
            ...context,
            source: 'history',
            roomIdentityVerified: userMeta.currentRoomVerified === true,
          });
          identitySnapshot = result && result.snapshot;
        }
        if (localGeneration !== this.localGeneration) return;
        this.onMessage({
          uid: item.uid,
          userName: String(item.nickname || item.uname || '观众'),
          avatarUrl: userMeta.avatarUrl,
          message: text,
          requesterGuardLevel: userMeta.guardLevel,
          requesterMedalName: userMeta.medalName,
          requesterMedalLevel: userMeta.medalLevel,
          currentRoomVerified: userMeta.currentRoomVerified,
          identitySource: 'history',
          source: 'history',
          messageTimestamp: timelineMs,
          identitySnapshot,
        });
      }

      if (processed > 0) {
        console.log(
          `[Bilibili] history polling processed ${processed} command message(s).`,
        );
      }
    } finally {
      this.pollInFlight = false;
    }
  }
}

function toIdentityHint(item, userMeta) {
  return {
    uid: item.uid,
    name: String(item.nickname || item.uname || '观众'),
    avatarUrl: userMeta.avatarUrl,
    roomIdentity: {
      guardKnown: userMeta.currentRoomVerified === true,
      guardLevel: userMeta.guardLevel,
      medalKnown: userMeta.currentRoomVerified === true,
      fansMedal: userMeta.medalName
        ? {
            name: userMeta.medalName,
            level: userMeta.medalLevel,
            targetUid: userMeta.medalTargetUid,
          }
        : null,
    },
  };
}

function parseBilibiliTimeline(value) {
  return normalizeTimestampMs(value);
}

module.exports = { HistoryPoller };
