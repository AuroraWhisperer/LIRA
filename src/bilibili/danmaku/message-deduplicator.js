// 编写人：Aurora
// 消息去重器 — 防止重复处理相同的命令消息。
'use strict';

const bilibiliHelpers = require('../helpers');
const { cleanText, normalizeTimestampMs } = require('../../shared/utils');

const COMMAND_MATCH_WINDOW_MS = 1500;
const COMMAND_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const COMMAND_CACHE_MAX_SIZE = 500;

class MessageDeduplicator {
  constructor() {
    this.seenCommandKeys = new Map();
    this.recentCommands = [];
  }

  remember(uid, message, timestampMs, options = {}) {
    const key = bilibiliHelpers.buildBilibiliCommandKey(uid, message, timestampMs);
    if (!key) return false;
    if (this.seenCommandKeys.has(key)) return false;

    const receivedAt = Date.now();
    this.seenCommandKeys.set(key, receivedAt);
    const command = {
      uid: normalizeUid(uid),
      userName: normalizeUserName(options.userName),
      message: cleanText(message),
      timestampMs: normalizeTimestampMs(timestampMs) || receivedAt,
      source: cleanText(options.source),
      matchedSources: new Set(),
      receivedAt
    };

    const crossSourceMatch = this.recentCommands.find((candidate) => (
      isCrossSourceDuplicate(candidate, command)
      && !candidate.matchedSources.has(command.source)
    ));
    if (crossSourceMatch) {
      crossSourceMatch.matchedSources.add(command.source);
      this.prune(receivedAt);
      return false;
    }

    if (command.source) command.matchedSources.add(command.source);
    this.recentCommands.push(command);
    this.prune(receivedAt);
    return true;
  }

  prune(receivedAt) {
    if (this.seenCommandKeys.size > 1000) {
      const cutoff = receivedAt - COMMAND_CACHE_MAX_AGE_MS;
      for (const [seenKey, seenAt] of this.seenCommandKeys) {
        if (seenAt < cutoff || this.seenCommandKeys.size > COMMAND_CACHE_MAX_SIZE) {
          this.seenCommandKeys.delete(seenKey);
        }
      }
    }

    const cutoff = receivedAt - COMMAND_CACHE_MAX_AGE_MS;
    this.recentCommands = this.recentCommands
      .filter((command) => command.receivedAt >= cutoff)
      .slice(-COMMAND_CACHE_MAX_SIZE);
  }

  has(uid, message, timestampMs) {
    const key = bilibiliHelpers.buildBilibiliCommandKey(uid, message, timestampMs);
    return key && this.seenCommandKeys.has(key);
  }
}

function isCrossSourceDuplicate(left, right) {
  if (!left.source || !right.source || left.source === right.source) return false;
  if (left.message !== right.message) return false;
  if (Math.abs(left.timestampMs - right.timestampMs) > COMMAND_MATCH_WINDOW_MS) return false;
  return isSameRequester(left, right);
}

function isSameRequester(left, right) {
  if (left.uid && right.uid && left.uid === right.uid) return true;
  if (left.userName && right.userName && namesMatch(left.userName, right.userName)) return true;
  if (left.uid && right.uid) return false;
  return !left.userName || !right.userName;
}

function namesMatch(left, right) {
  if (left === right) return true;
  return maskedNameMatches(left, right) || maskedNameMatches(right, left);
}

function maskedNameMatches(maskedName, fullName) {
  const firstMask = maskedName.search(/\*{2,}/);
  if (firstMask < 0) return false;
  const lastMask = maskedName.lastIndexOf('*');
  const prefix = maskedName.slice(0, firstMask);
  const suffix = maskedName.slice(lastMask + 1);
  return fullName.length >= prefix.length + suffix.length
    && fullName.startsWith(prefix)
    && fullName.endsWith(suffix);
}

function normalizeUid(value) {
  const uid = cleanText(value);
  return uid === '0' ? '' : uid;
}

function normalizeUserName(value) {
  const userName = cleanText(value).toLowerCase();
  return userName === '观众' ? '' : userName;
}

module.exports = { MessageDeduplicator };
