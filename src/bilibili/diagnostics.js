'use strict';

const { createHmac, randomBytes } = require('node:crypto');
const { redactCredentials } = require('../shared/log-redaction');

// References only correlate commands within this process; never persist the key.
const commandReferenceKey = randomBytes(32);

function logBilibiliDiagnostic(event, details = {}) {
  console.info(`[Bilibili][Diagnostic] ${JSON.stringify(redactCredentials({ event, ...details }))}`);
}

function summarizeAuthState(state = {}) {
  return {
    loggedIn: state.loggedIn === true,
    hasUid: Number(state.uid) > 0,
    hasSessdata: state.hasSessdata === true,
    hasCsrf: state.keyCookieNames?.includes('bili_jct') === true,
    encryptedSnapshotExists: state.encryptedSnapshotExists === true,
    encryptionAvailable: state.encryptionAvailable === true,
  };
}

function summarizeConnectionAuth(auth = {}) {
  const cookieHeader = String(auth.cookieHeader || '');
  return {
    hasUid: Number(auth.uid) > 0,
    hasSessdata: /(?:^|;\s*)SESSDATA=[^;\s]+/.test(cookieHeader),
    hasCsrf: /(?:^|;\s*)bili_jct=[^;\s]+/.test(cookieHeader),
  };
}

function songRequestSummary(danmaku = {}) {
  const message = String(danmaku.message || '').trim();
  if (!message.startsWith('点歌') && !message.startsWith('随机')) return null;
  return {
    commandRef: createHmac('sha256', commandReferenceKey)
      .update(JSON.stringify([String(danmaku.uid || ''), message, danmaku.messageTimestamp || 0]))
      .digest('hex')
      .slice(0, 16),
    commandType: message.startsWith('点歌') ? 'request' : 'random',
    source: ['danmaku', 'history', 'superchat', 'client'].includes(danmaku.source) ? danmaku.source : 'danmaku',
    messageTimestamp: Number(danmaku.messageTimestamp) || 0,
    messageLength: message.length,
    hasUid: Number(danmaku.uid) > 0,
    nameMasked: /\*{2,}/.test(String(danmaku.userName || '')),
    connectionGeneration: Number(danmaku.connectionGeneration) || 0,
    connectionAttempt: Number(danmaku.connectionAttempt) || 0,
  };
}

function logSongRequest(event, danmaku, details = {}) {
  const summary = songRequestSummary(danmaku);
  if (summary) logBilibiliDiagnostic(event, { ...summary, ...details });
}

function songRequestReason(reason) {
  const text = String(reason || '');
  if (/不是点歌指令/.test(text)) return 'not-a-song-command';
  if (/暂停接收点歌/.test(text)) return 'requests-paused';
  if (/用户冷却中/.test(text)) return 'user-cooldown';
  if (/没有.*可随机歌曲/.test(text)) return 'no-random-candidate';
  if (/歌曲名不能为空/.test(text)) return 'empty-song-name';
  if (/队列已达到上限/.test(text)) return 'queue-full';
  if (/队列里已经有这首歌/.test(text)) return 'song-already-queued';
  if (/歌库里没有这首歌/.test(text)) return 'song-not-in-library';
  return 'unexpected-error';
}

module.exports = {
  logBilibiliDiagnostic,
  summarizeAuthState,
  summarizeConnectionAuth,
  songRequestSummary,
  logSongRequest,
  songRequestReason,
};
