// 编写人：Aurora
// Bilibili 弹幕 → 点歌的桥接层。
// 这是 Bilibili 和 music 域之间的唯一桥梁，解析弹幕指令后调用 queue-service。
'use strict';

const { cleanText, formatLogTimestamp } = require('../shared/utils');
const { parseRandomSongTerms } = require('../music/random-song-filter');
const { normalizeRandomScopeText, randomSourceValue } = require('../music/song-field-utils');
const { logSongRequest, songRequestReason } = require('./diagnostics');
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
    requesterGuardLevel,
    requesterMedalName,
    requesterMedalLevel,
    requesterGuardVerified,
    requesterMedalVerified,
    currentRoomVerified,
    isPinned,
  },
) {
  const text = cleanText(message);
  const settings = context.settings();
  if (source === 'superchat' && settings.scSongRequestEnabled === 'false') {
    return { accepted: false, reason: 'SC 点歌已关闭。' };
  }
  const command = parseDanmakuCommand(text, settings);
  if (!command) {
    return { accepted: false, reason: '不是点歌指令。' };
  }

  if (settings.paused === 'true') {
    return { accepted: false, reason: '当前已暂停接收点歌。', command };
  }

  if (
    command.type === 'request' &&
    (settings.songRequestBlacklist || '').split('\n').some((word) => cleanText(word) === command.songName)
  ) {
    return { accepted: false, reason: '点歌内容命中黑名单。', command };
  }

  const requester = {
    requesterUid: uid,
    requesterIdentityType: identityType || (/^[1-9]\d{0,24}$/.test(cleanText(uid)) ? 'uid' : undefined),
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
      const song = context.pickRandomSong(command.scopeText);
      if (!song) {
        const reason = command.scopeText
          ? `歌库里没有同时满足全部条件「${command.scopeText}」的可随机歌曲。`
          : '歌库里还没有可随机歌曲。';
        const autoReply =
          settings.enableRandomTagReply === 'true'
            ? buildRandomScopeAutoReply(
                command.scopeText,
                {
                  ...(context.describeRandomSongScope ? context.describeRandomSongScope(command.scopeText) : {}),
                },
                { uid, name: userName },
              )
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
      const matchedSong = context.resolveSongRequest ? context.resolveSongRequest(command.songName) : null;
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
      });
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

function parseDanmakuCommand(message, settings) {
  const text = cleanText(message);
  if (!text) return null;

  if (text.startsWith('随机点歌')) {
    return {
      type: 'random',
      scopeText: normalizeRandomScopeText(text.slice('随机点歌'.length)),
    };
  }

  if (text.startsWith('随机 ')) {
    return {
      type: 'random',
      scopeText: normalizeRandomScopeText(text.slice('随机 '.length)),
    };
  }

  if (text.startsWith('随机') && text !== '随机') {
    const scopeText = normalizeRandomScopeText(text.slice('随机'.length));
    if (scopeText && scopeText !== '点歌') {
      return { type: 'random', scopeText };
    }
  }

  if (!text.startsWith('点歌')) {
    return null;
  }

  const songName = cleanText(text.slice(2));
  if (!songName) return null;
  return { type: 'request', songName };
}

// ── 日志 ──

function logDanmakuCommand(danmaku, result) {
  const message = cleanText(danmaku.message);
  if (!message.startsWith('点歌') && !message.startsWith('随机')) return;
  logSongRequest('command-result', danmaku, {
    status: result?.accepted ? 'accepted' : 'ignored',
    ...(result?.accepted
      ? { queueId: Number(result.queueItem?.id) || 0 }
      : { reason: songRequestReason(result?.reason) }),
  });
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
