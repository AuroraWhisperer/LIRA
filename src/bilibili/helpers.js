// 编写人：Aurora
// Bilibili 杂项辅助函数 — 诊断记录、身份解析、时间戳工具。
'use strict';

const {
  cleanText,
  normalizeTimestampMs,
  normalizePositiveInteger,
  normalizeGuardLevel,
} = require('../shared/utils');

// ── 数值转换 ──

function parseBooleanLike(value) {
  if (value === true || value === 1) return true;
  const text = cleanText(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

// ── 诊断记录 ──

function recordBilibiliCommandDiagnostic(diag, cmd) {
  const text = cleanText(cmd);
  if (!text) return;
  diag.lastCommandAt = new Date().toISOString();
  diag.commandCounts[text] = (diag.commandCounts[text] || 0) + 1;
  diag.recentCommands.unshift({ cmd: text, at: diag.lastCommandAt });
  diag.recentCommands = diag.recentCommands.slice(0, 20);
}

// ── 命令解析 ──

function isCapturableBilibiliTimestamp(timestampMs, startedAtMs) {
  const HISTORY_MESSAGE_MAX_AGE_MS = 30 * 60 * 1000;
  const timestamp = normalizeTimestampMs(timestampMs);
  if (!timestamp) return false;
  const currentTime = Date.now();
  if (timestamp < startedAtMs - 5000) return false;
  if (timestamp < currentTime - HISTORY_MESSAGE_MAX_AGE_MS) return false;
  if (timestamp > currentTime + 5 * 60 * 1000) return false;
  return true;
}

function buildBilibiliCommandKey(uid, message, timestampMs) {
  const text = cleanText(message);
  if (!text) return '';
  const normalizedTimestamp = normalizeTimestampMs(timestampMs) || Date.now();
  const secondBucket = Math.floor(normalizedTimestamp / 1000);
  return cleanText(uid) + '|' + secondBucket + '|' + text;
}

// ── 身份/勋章解析 ──

function normalizeRequesterIdentity(input) {
  return {
    uid: cleanText(input && input.uid),
    userName: cleanText(input && input.userName),
    guardLevel: normalizeGuardLevel(input && input.guardLevel),
    medalName: cleanText(input && input.medalName),
    medalLevel: normalizePositiveInteger(input && input.medalLevel),
    seenAt: normalizePositiveInteger(input && input.seenAt) || undefined,
  };
}

function guardLevelName(level) {
  if (Number(level) === 3) return '舰长';
  if (Number(level) === 2) return '提督';
  if (Number(level) === 1) return '总督';
  return '';
}

function readMedalName(medalInfo) {
  return cleanText(
    (medalInfo &&
      (medalInfo.medal_name ||
        medalInfo.medalName ||
        medalInfo.medal ||
        medalInfo.name)) ||
      '',
  );
}

function readMedalLevel(medalInfo) {
  return normalizePositiveInteger(
    (medalInfo &&
      (medalInfo.medal_level || medalInfo.medalLevel || medalInfo.level)) ||
      0,
  );
}

function readBilibiliOnlineRankItems(data) {
  if (!data || typeof data !== 'object') return [];
  const candidates = [
    data.OnlineRankItem,
    data.onlineRankItem,
    data.online_rank_item,
    data.list,
    data.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function readBilibiliFansMembersRankItems(data) {
  if (!data || typeof data !== 'object') return [];
  const candidates = [
    data.item,
    data.items,
    data.list,
    data.fans_members,
    data.fansMembers,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

module.exports = {
  parseBooleanLike,
  recordBilibiliCommandDiagnostic,
  isCapturableBilibiliTimestamp,
  buildBilibiliCommandKey,
  normalizeRequesterIdentity,
  guardLevelName,
  readMedalName,
  readMedalLevel,
  readBilibiliOnlineRankItems,
  readBilibiliFansMembersRankItems,
};
