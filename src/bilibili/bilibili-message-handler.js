// 编写人：Aurora
// Bilibili 弹幕 → 点歌的桥接层。
// 这是 Bilibili 和 music 域之间的唯一桥梁，解析弹幕指令后调用 queue-service。
'use strict';

const { cleanText, formatLogTimestamp } = require('../shared/utils');
const { toSimplifiedChinese } = require('../shared/chinese-text');
const { parseRandomSongTerms } = require('../music/random-song-filter');
const { normalizeRandomScopeText, randomSourceValue } = require('../music/song-field-utils');
const { logSongRequest, songRequestReason } = require('./diagnostics');
const { isSongCancelCommand } = require('./danmaku/command-text');
const { isQueueRequestRejection } = require('../music/queue-service');
const { requesterIdentity, userCooldownSeconds, requestRejection } = require('../music/song-request-policy');

// ── 弹幕指令入口 ──

function handleDanmakuMessage(
  context,
  {
    message,
    userName,
    uid,
    identityType,
    fanScope,
    source,
    messageTimestamp,
    historyCancellation,
    requesterGuardLevel,
    requesterMedalName,
    requesterMedalLevel,
    requesterGuardVerified,
    requesterMedalVerified,
    currentRoomVerified,
    isPinned,
  },
  simplified,
) {
  const text = cleanText(message);
  const commandText = simplified === undefined ? toSimplifiedChinese(text) : cleanText(simplified);
  let settings = source === 'superchat' ? context.settings() : null;
  if (source === 'superchat' && settings.scSongRequestEnabled === 'false') {
    return { accepted: false, reason: 'SC 点歌已关闭。' };
  }
  const command = parseCommandText(text, commandText);
  if (!command) {
    return { accepted: false, reason: '不是点歌指令。' };
  }
  settings ??= context.settings();
  if (!validRequestSpacing(command, commandText, settings)) {
    return { accepted: false, reason: '不是点歌指令。' };
  }

  const requesterIdentityType = identityType || (/^[1-9]\d{0,24}$/.test(cleanText(uid)) ? 'uid' : undefined);
  if (command.type === 'cancel') {
    if (settings.songRequestCancelEnabled === 'false') {
      return { accepted: false, reason: '观众取消点歌已关闭。', command };
    }
    const ambiguous = source === 'history' &&
      hasAmbiguousHistoryTarget(context, settings, command.songName, historyCancellation?.unorderedRequests);
    const queueItem = ambiguous ? null : context.cancelQueueItem({
      songName: command.songName,
      requesterUid: uid,
      requesterIdentityType,
      ...(source === 'history' && { messageTimestamp, historyCancellation: historyCancellation || { timeline: messageTimestamp } }),
    });
    return queueItem
      ? { accepted: true, command, queueItem }
      : { accepted: false, reason: '没有找到你点的待处理歌曲。', command };
  }

  if (settings.paused === 'true') {
    return { accepted: false, reason: '当前已暂停接收点歌。', command };
  }

  if (
    command.type === 'request' &&
    (settings.songRequestBlacklist || '').split('\n').some((word) =>
      toSimplifiedChinese(cleanText(word)) === commandText.slice(2).trim())
  ) {
    return { accepted: false, reason: '点歌内容命中黑名单。', command };
  }

  const requester = {
    requesterUid: uid,
    requesterIdentityType,
    requesterGuardLevel,
    requesterMedalName,
    requesterMedalLevel,
    requesterGuardVerified,
    requesterMedalVerified,
    currentRoomVerified,
    viewerRequest: true,
  };
  const identity = requesterIdentity(requester);
  const defaults = context.settingsStore.getDefaultSettings();
  const cooldownSeconds = userCooldownSeconds({ ...defaults, ...settings }, requester);
  // Scope and identity type are part of the key; legacy unscoped rows are never read here.
  const cooldownKey = cooldownSeconds > 0 && identity
    ? `v2:${JSON.stringify([fanScope || null, identity.type, identity.uid])}`
    : null;
  const lastAt = cooldownKey ? context.userRequestCooldown.getLastRequestAt(cooldownKey) : 0;
  const elapsedSeconds = (Date.now() - lastAt) / 1000;
  let queueItem;
  try {
    if (cooldownSeconds > 0 && !identity) {
      throw requestRejection('REQUESTER_IDENTITY_REQUIRED', '暂时无法确认你的点歌身份，请稍后再点歌。');
    }
    if (cooldownSeconds > 0 && elapsedSeconds < cooldownSeconds) {
      return {
        accepted: false,
        reason: `用户冷却中，还需 ${Math.ceil(cooldownSeconds - elapsedSeconds)} 秒。`,
        command,
      };
    }
    if (command.type === 'random') {
      // 通过 context.pickRandomSong 调用，不直接持有 DB 句柄
      const song = context.pickRandomSong(command.scopeText, fanScope);
      if (!song) {
        const reason = command.scopeText
          ? `歌库里没有同时满足全部条件「${command.scopeText}」的可随机歌曲。`
          : '歌库里还没有可随机歌曲。';
        const autoReply =
          settings.enableRandomTagReply === 'true'
            ? buildRandomScopeAutoReply(command.scopeText, {}, { uid, name: userName })
            : null;
        return { accepted: false, reason, command, autoReply };
      }
      queueItem = context.addQueueItem({
        songName: song.name,
        artist: song.artist,
        categoryName: song.category_name,
        requesterName: userName,
        ...requester,
        fanScope,
        source: randomSourceValue(command.scopeText),
        message: text,
        messageTimestamp,
        isPinned,
      });
    } else {
      const matchedSong = context.resolveSongRequest?.(command.songName);
      queueItem = context.addQueueItem({
        songName: matchedSong ? matchedSong.name : command.songName,
        artist: matchedSong?.artist,
        requesterName: userName,
        ...requester,
        fanScope,
        source: source || 'danmaku',
        message: text,
        messageTimestamp,
        isPinned,
      }, matchedSong);
    }
  } catch (error) {
    if (!isQueueRequestRejection(error)) throw error;
    return {
      accepted: false,
      reason: error.message,
      code: error.code,
      command,
      autoReply: settings.enableRandomTagReply === 'true'
        ? buildSongRequestAutoReply(songRequestAutoReplyMessage(error, settings), { uid, name: userName }) : null,
    };
  }

  if (cooldownKey) {
    context.userRequestCooldown.recordAccepted(cooldownKey, { uid: identity.uid, userName });
  }
  return { accepted: true, command, queueItem };
}

// ── 指令解析 ──

function validRequestSpacing(command, text, settings) {
  return command.type !== 'request' || settings.songRequestRequireSpace !== 'true' || text.startsWith('点歌 ');
}

function hasAmbiguousHistoryTarget(context, settings, songName, messages = []) {
  const title = toSimplifiedChinese(songName);
  return messages.some(message => {
    const text = cleanText(message);
    const simplified = toSimplifiedChinese(text);
    const request = parseCommandText(text, simplified);
    if (request?.type === 'random') return true;
    if (request?.type !== 'request' || !validRequestSpacing(request, simplified, settings)) return false;
    if (!title) return true;
    const song = context.resolveSongRequest?.(request.songName);
    return toSimplifiedChinese(song?.name || request.songName) === title;
  });
}

function parseDanmakuCommand(message) {
  const text = cleanText(message);
  return parseCommandText(text, toSimplifiedChinese(text));
}

function parseCommandText(text, commandText) {
  if (isSongCancelCommand(commandText)) {
    return { type: 'cancel', songName: cleanText(text.slice('取消点歌'.length)) };
  }

  if (commandText.startsWith('随机点歌')) {
    return {
      type: 'random',
      scopeText: normalizeRandomScopeText(text.slice('随机点歌'.length)),
    };
  }

  if (!commandText.startsWith('点歌')) {
    return null;
  }

  const songName = cleanText(text.slice(2));
  if (!songName) return null;
  return { type: 'request', songName };
}

// ── 日志 ──

function logDanmakuCommand(danmaku, result, message = toSimplifiedChinese(cleanText(danmaku.message))) {
  if (!message.startsWith('点歌') && !message.startsWith('随机点歌') && !message.startsWith('取消点歌')) return;
  logSongRequest('command-result', danmaku, {
    status: result?.accepted ? 'accepted' : 'ignored',
    ...(result?.accepted
      ? { queueId: Number(result.queueItem?.id) || 0 }
      : { reason: songRequestReason(result?.reason) }),
  }, message);
  console.log(formatBilibiliCommandLog(danmaku, result));
}

function songRequestAutoReplyMessage(error, settings) {
  switch (error.code) {
    case 'QUEUE_FULL':
      return '点歌队列满啦，稍后再来试试～';
    case 'SONG_NOT_IN_LIBRARY':
      return '歌库里没找到这首，换一首试试～';
    case 'SONG_ALREADY_QUEUED':
      return '这首歌已经在队列里啦～';
    case 'USER_QUEUE_FULL':
      return `每人最多同时排队 ${settings.userQueueLimit} 首，等已点的歌完成后再点吧～`;
    case 'REQUESTER_IDENTITY_REQUIRED':
      return '暂时无法确认你的点歌身份，请稍后再点歌～';
    default:
      return error.message;
  }
}

function buildRandomScopeAutoReply(scopeText, details = {}, target = {}) {
  const terms =
    Array.isArray(details.terms) && details.terms.length > 0 ? details.terms : parseRandomSongTerms(scopeText);
  if (terms.length === 0) return buildSongRequestAutoReply('歌库里暂时没有可随机的歌曲，请稍后再试～', target);

  const scope = cleanText(scopeText);
  const message =
    terms.length === 1
      ? `歌库里暂时没有「${terms[0]}」类歌曲，换个条件试试～`
      : `暂时没有同时符合「${scope}」的歌曲，换个条件试试～`;
  return buildSongRequestAutoReply(message, target);
}

function buildSongRequestAutoReply(message, target) {
  if (!cleanText(target.name)) return null;
  return {
    message,
    target: {
      uid: cleanText(target.uid),
      name: cleanText(target.name),
    },
  };
}

function formatBilibiliCommandLog(danmaku, result) {
  const message = cleanText(danmaku && danmaku.message);
  const status = result && result.accepted ? 'accepted' : 'ignored';
  const outcome =
    result && result.accepted
      ? ` song=${JSON.stringify(cleanText(result.queueItem && result.queueItem.song_name))}`
      : ` reason=${JSON.stringify(cleanText(result && result.reason))}`;
  const trace = {
    connectionGeneration: Number(danmaku && danmaku.connectionGeneration) || 0,
    connectionAttempt: Number(danmaku && danmaku.connectionAttempt) || 0,
    cmd: cleanText(danmaku && danmaku.cmd),
  };
  return (
    `[Bilibili][Command] status=${status}` +
    ` time=${formatLogTimestamp(danmaku && danmaku.messageTimestamp)}` +
    ` source=${cleanText(danmaku && danmaku.source) || 'danmaku'}` +
    ` user=${JSON.stringify(cleanText(danmaku && danmaku.userName))}` +
    ` uid=${JSON.stringify(cleanText(danmaku && danmaku.uid))}` +
    ` message=${JSON.stringify(message)}` +
    outcome +
    ` trace=${JSON.stringify(trace)}`
  );
}

module.exports = {
  handleDanmakuMessage,
  parseDanmakuCommand,
  normalizeRandomScopeText,
  randomSourceValue,
  buildRandomScopeAutoReply,
  logDanmakuCommand,
  formatBilibiliCommandLog,
};
