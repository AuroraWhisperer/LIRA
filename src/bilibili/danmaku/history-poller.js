// 编写人：Aurora
// 历史消息轮询器 — 定时拉取历史弹幕消息作为补偿监听。
'use strict';

const packetParser = require('../packet-parser');
const bilibiliHelpers = require('../helpers');
const { isBilibiliCommandText, isSongCancelCommand, isSongRequestCommand } = require('./command-text');
const { toSimplifiedChinese } = require('../../shared/chinese-text');
const { cleanText, normalizeTimestampMs, timestampPrecisionMs } = require('../../shared/utils');
const { logBilibiliDiagnostic } = require('../diagnostics');

function orderHistoryList(items) {
  if (!Array.isArray(items)) return [];
  let dispatchAt = 0;
  return items.map((item, index) => {
    const time = normalizeTimestampMs(item.timeline);
    // Keep a coarse event after its preceding list entry when both times overlap.
    dispatchAt = Math.min(time + timestampPrecisionMs(item.timeline) - 1, Math.max(time, dispatchAt));
    return { item, items, index, time, dispatchAt };
  });
}

function sameSecondRequests({ item, items, index, time }) {
  const second = Math.floor(time / 1000);
  const uid = cleanText(item.uid);
  const siblings = [];
  for (const [position, entry] of items.entries()) {
    if (position !== index && cleanText(entry.uid) === uid &&
        Math.floor(normalizeTimestampMs(entry.timeline) / 1000) === second &&
        isSongRequestCommand(toSimplifiedChinese(cleanText(entry.text)))) {
      siblings.push({ message: cleanText(entry.text), timeline: entry.timeline, offset: position - index });
    }
  }
  return siblings;
}

function listsOnceAfterCancel(requests, pending) {
  const text = cleanText(pending.item.text);
  const matches = requests.filter(request => request.message === text);
  return matches.length === 1 && matches[0].offset > 0 &&
    normalizeTimestampMs(matches[0].timeline) === pending.time &&
    timestampPrecisionMs(matches[0].timeline) === timestampPrecisionMs(pending.item.timeline);
}

function cancellationOrder(entry, messages, position, deduplicator) {
  const { item, items, time } = entry;
  const uid = cleanText(item.uid);
  const siblings = sameSecondRequests(entry);
  const width = timestampPrecisionMs(item.timeline);
  const second = Math.floor(time / 1000);
  const cancellations = messages.filter(other => Math.floor(other.time / 1000) === second &&
    cleanText(other.item.uid) === uid && cleanText(other.item.text) === cleanText(item.text));
  const copies = cancellations.filter(other => other.time === time && timestampPrecisionMs(other.item.timeline) === width);
  const conflicts = new Set();
  let mirrorRequests = [];
  if (copies.length === 2 && copies[0].items !== copies[1].items) {
    const mirror = copies[0] === entry ? copies[1] : copies[0];
    const otherOrder = sameSecondRequests(mirror);
    // Let the copy with usable list order reach deduplication and queue delivery.
    if (deduplicator && !siblings.length && otherOrder.length && copies[0] === entry) return null;
    for (const request of siblings) {
      if (otherOrder.some(other => other.message === request.message && other.offset * request.offset < 0)) {
        conflicts.add(request.message);
      }
    }
    if (cancellations.length === 2) mirrorRequests = otherOrder;
  }
  // A pending request can still be the target unless both lists independently
  // place the same, unambiguous request after this cancellation.
  const end = time + width - 1;
  const pending = messages.slice(position + 1).filter(other => other.items !== items &&
    cleanText(other.item.uid) === uid && other.time <= end && other.time + timestampPrecisionMs(other.item.timeline) > time &&
    isSongRequestCommand(toSimplifiedChinese(cleanText(other.item.text))) &&
    !deduplicator?.has?.(uid, other.item.text, other.time) &&
    !(listsOnceAfterCancel(mirrorRequests, other) && listsOnceAfterCancel(siblings, other)));
  const observed = deduplicator?.commandTimelines?.(uid, second);
  const agreedSide = request => !conflicts.has(request.message);
  return {
    timeline: item.timeline,
    siblings: siblings.filter(agreedSide),
    mirrorSiblings: mirrorRequests.filter(agreedSide),
    unorderedRequests: [...new Set([...conflicts, ...pending.map(other => cleanText(other.item.text))])],
    observed,
  };
}

class HistoryPoller {
  constructor(apiClient, onMessage, options = {}) {
    this.apiClient = apiClient;
    this.onMessage = onMessage;
    this.startedAtMs = options.startedAtMs || Date.now();
    this.roomOwnerUid = cleanText(options.roomOwnerUid);
    this.isCommandText = typeof options.isCommandText === 'function' ? options.isCommandText : isBilibiliCommandText;
    this.onIdentityHint = typeof options.onIdentityHint === 'function' ? options.onIdentityHint : null;
    this.deduplicator = options.deduplicator || null;
    this.timer = null;
    this.pollInFlight = false;
    this.localGeneration = 0;
  }

  start(context) {
    if (this.timer && this.context === context) return;
    this.stop();
    if (!context || !context.roomId || !context.ownerUid) return;
    this.context = context;
    const localGeneration = ++this.localGeneration;
    logBilibiliDiagnostic('history-start', { roomId: context.roomId });
    let delayMs = 2500;
    const poll = async () => {
      try {
        await this.pollHistory(context, localGeneration);
        delayMs = 2500;
      } catch (error) {
        delayMs = Math.min(60000, delayMs * 2);
        console.warn(`[Bilibili] history polling failed: ${error.message}`);
      }
      if (localGeneration === this.localGeneration) this.timer = setTimeout(poll, delayMs);
    };
    this.timer = setTimeout(poll, 0);
  }

  stop() {
    if (this.timer) logBilibiliDiagnostic('history-stop');
    clearTimeout(this.timer);
    this.timer = null;
    this.context = null;
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
      const messages = [...orderHistoryList(data.admin), ...orderHistoryList(data.room)]
        .sort((a, b) => a.dispatchAt - b.dispatchAt);

      let processed = 0;
      let stale = 0;
      let duplicates = 0;
      for (const [position, entry] of messages.entries()) {
        if (localGeneration !== this.localGeneration) return;
        const { item, time: timelineMs } = entry;
        const text = cleanText(item.text);
        if (!text) continue;
        if (!this.isCommandText(text)) continue;
        if (!bilibiliHelpers.isCapturableBilibiliTimestamp(timelineMs, this.startedAtMs)) {
          stale += 1;
          continue;
        }
        let historyCancellation;
        if (isSongCancelCommand(toSimplifiedChinese(text))) {
          historyCancellation = cancellationOrder(entry, messages, position, this.deduplicator);
          if (!historyCancellation) continue;
        }
        if (
          this.deduplicator &&
          !this.deduplicator.remember(item.uid, text, timelineMs, {
            userName: item.nickname || item.uname,
            source: 'history',
            platformTimestamp: item.timeline,
          })
        ) {
          duplicates += 1;
          continue;
        }

        processed += 1;
        const userMeta = packetParser.extractBilibiliHistoryUserMeta(item, this.roomOwnerUid);
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
          ...(historyCancellation && { historyCancellation }),
          identitySnapshot,
        });
      }

      if (processed > 0 || this.reportedGeneration !== localGeneration) {
        this.reportedGeneration = localGeneration;
        logBilibiliDiagnostic('history-sample', {
          roomId: context.roomId,
          fetched: messages.length,
          processed,
          stale,
          duplicates,
          listenerStartedAt: this.startedAtMs,
        });
      }
      if (processed > 0) {
        console.log(`[Bilibili] history polling processed ${processed} command message(s).`);
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

module.exports = { HistoryPoller };
