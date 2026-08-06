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
    this.isCommandText = typeof options.isCommandText === 'function'
      ? options.isCommandText
      : isBilibiliCommandText;
    this.timer = null;
  }

  start(roomId) {
    this.stop();
    this.pollHistory(roomId).catch((error) => {
      console.warn(`[Bilibili] history polling failed: ${error.message}`);
    });
    this.timer = setInterval(() => {
      this.pollHistory(roomId).catch((error) => {
        console.warn(`[Bilibili] history polling failed: ${error.message}`);
      });
    }, 2500);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  updateStartTime(startedAtMs) {
    this.startedAtMs = startedAtMs;
  }

  async pollHistory(roomId) {
    const data = await this.apiClient.fetchHistory(roomId);
    const messages = []
      .concat(Array.isArray(data.admin) ? data.admin : [])
      .concat(Array.isArray(data.room) ? data.room : []);
    messages.sort((a, b) => parseBilibiliTimeline(a.timeline) - parseBilibiliTimeline(b.timeline));

    let processed = 0;
    for (const item of messages) {
      const text = cleanText(item.text);
      if (!text) continue;
      const timelineMs = parseBilibiliTimeline(item.timeline);
      if (!this.isCommandText(text)) continue;
      if (!bilibiliHelpers.isCapturableBilibiliTimestamp(timelineMs, this.startedAtMs)) continue;

      processed += 1;
      const userMeta = packetParser.extractBilibiliHistoryUserMeta(item);
      this.onMessage({
        uid: item.uid,
        userName: String(item.nickname || item.uname || '观众'),
        message: text,
        requesterGuardLevel: userMeta.guardLevel,
        requesterMedalName: userMeta.medalName,
        requesterMedalLevel: userMeta.medalLevel,
        source: 'history',
        messageTimestamp: timelineMs
      });
    }

    if (processed > 0) {
      console.log(`[Bilibili] history polling processed ${processed} command message(s).`);
    }
  }
}

function parseBilibiliTimeline(value) {
  return normalizeTimestampMs(value);
}

module.exports = { HistoryPoller };
