// 编写人：Aurora
// Bilibili 弹幕 → 点歌的桥接层。
// 这是 Bilibili 和 music 域之间的唯一桥梁，解析弹幕指令后调用 queue-service。
'use strict';

const { cleanText, formatLogTimestamp } = require('../shared/utils');
const { parseRandomSongTerms } = require('../music/random-song-filter');

// ── 弹幕指令入口 ──

function handleDanmakuMessage(context, {
  message, userName, uid, source,
  messageTimestamp, requesterGuardLevel,
  requesterMedalName, requesterMedalLevel,
  isPinned
}) {
  const text = cleanText(message);
  const settings = context.settings();
  const command = parseDanmakuCommand(text, settings);
  if (!command) {
    return { accepted: false, reason: '不是点歌指令。' };
  }

  if (settings.paused === 'true') {
    return { accepted: false, reason: '当前已暂停接收点歌。', command };
  }

  const defaults = context.settingsStore.getDefaultSettings();
  const cooldownSeconds = Number(settings.userCooldownSeconds || defaults.userCooldownSeconds);
  const cooldownKey = cleanText(uid) || cleanText(userName) || 'anonymous';
  const lastAt = context.state.cooldownByUser.get(cooldownKey) || 0;
  const elapsedSeconds = (Date.now() - lastAt) / 1000;
  if (cooldownSeconds > 0 && elapsedSeconds < cooldownSeconds) {
    return {
      accepted: false,
      reason: `用户冷却中，还需 ${Math.ceil(cooldownSeconds - elapsedSeconds)} 秒。`,
      command
    };
  }

  let queueItem;
  if (command.type === 'random') {
    // 通过 context.pickRandomSong 调用，不直接持有 DB 句柄
    const song = context.pickRandomSong(command.scopeText);
    if (!song) {
      const reason = command.scopeText
        ? `歌库里没有同时满足全部条件「${command.scopeText}」的可随机歌曲。`
        : '歌库里还没有可随机歌曲。';
      const autoReply = settings.enableRandomTagReply === 'true'
        ? buildRandomScopeAutoReply(command.scopeText, {
          ...(context.describeRandomSongScope
            ? context.describeRandomSongScope(command.scopeText)
            : {})
        }, { uid, name: userName })
        : null;
      return { accepted: false, reason, command, autoReply };
    }
    queueItem = context.addQueueItem({
      songName: song.name,
      artist: song.artist,
      categoryName: song.category_name,
      requesterName: userName,
      requesterUid: uid,
      requesterGuardLevel,
      requesterMedalName,
      requesterMedalLevel,
      source: randomSourceValue(command.scopeText),
      message: text,
      messageTimestamp,
      isPinned
    });
  } else {
    const matchedSong = context.resolveSongRequest
      ? context.resolveSongRequest(command.songName)
      : null;
    queueItem = context.addQueueItem({
      songName: matchedSong ? matchedSong.name : command.songName,
      requesterName: userName,
      requesterUid: uid,
      requesterGuardLevel,
      requesterMedalName,
      requesterMedalLevel,
      source: source || 'danmaku',
      message: text,
      messageTimestamp,
      isPinned
    });
  }

  const acceptedAt = Date.now();
  context.state.cooldownByUser.set(cooldownKey, acceptedAt);
  // 内存 Map 是读路径，DB 只为重启后能恢复冷却；写失败不影响本次点歌
  if (context.cooldownStore) {
    try {
      context.cooldownStore.touch(cooldownKey, { uid, userName, at: acceptedAt });
    } catch (error) {
      console.warn(`[Cooldown] persist failed: key=${cooldownKey} error=${error.message}`);
    }
  }
  return { accepted: true, command, queueItem };
}

// ── 指令解析 ──

function parseDanmakuCommand(message, settings) {
  const text = cleanText(message);
  if (!text) return null;

  if (text.startsWith('随机点歌')) {
    return { type: 'random', scopeText: normalizeRandomScopeText(text.slice('随机点歌'.length)) };
  }

  if (text.startsWith('随机 ')) {
    return { type: 'random', scopeText: normalizeRandomScopeText(text.slice('随机 '.length)) };
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

// ── 随机作用域辅助 ──

function normalizeRandomScopeText(value) {
  let text = cleanText(value);
  while (text && '+＋:：-—'.includes(text[0])) {
    text = cleanText(text.slice(1));
  }
  return text;
}

function randomSourceValue(scopeText) {
  const scope = normalizeRandomScopeText(scopeText);
  return scope ? `random:${scope}` : 'random';
}

// ── 日志 ──

function logDanmakuCommand(danmaku, result) {
  const message = cleanText(danmaku.message);
  if (!message.startsWith('点歌') && !message.startsWith('随机')) return;
  console.log(formatBilibiliCommandLog(danmaku, result));
}

function buildRandomScopeAutoReply(scopeText, details = {}, target = {}) {
  const terms = Array.isArray(details.terms) && details.terms.length > 0
    ? details.terms
    : parseRandomSongTerms(scopeText);
  if (terms.length === 0 || !cleanText(target.name)) return null;

  const scope = cleanText(scopeText);
  const message = terms.length === 1
    ? `歌库里暂时没有「${terms[0]}」这一类歌曲，请换个条件试试。`
    : `你输入的组合条件「${scope}」暂时没有匹配歌曲，请调整组合条件后再试。`;
  return {
    message,
    target: {
      uid: cleanText(target.uid),
      name: cleanText(target.name)
    }
  };
}

function formatBilibiliCommandLog(danmaku, result) {
  const message = cleanText(danmaku && danmaku.message);
  const status = result && result.accepted ? 'accepted' : 'ignored';
  const outcome = result && result.accepted
    ? ` song=${JSON.stringify(cleanText(result.queueItem && result.queueItem.song_name))}`
    : ` reason=${JSON.stringify(cleanText(result && result.reason))}`;
  const trace = {
    connectionGeneration: Number(danmaku && danmaku.connectionGeneration) || 0,
    connectionAttempt: Number(danmaku && danmaku.connectionAttempt) || 0,
    cmd: cleanText(danmaku && danmaku.cmd)
  };
  return `[Bilibili][Command] status=${status}`
    + ` time=${formatLogTimestamp(danmaku && danmaku.messageTimestamp)}`
    + ` source=${cleanText(danmaku && danmaku.source) || 'danmaku'}`
    + ` user=${JSON.stringify(cleanText(danmaku && danmaku.userName))}`
    + ` uid=${JSON.stringify(cleanText(danmaku && danmaku.uid))}`
    + ` message=${JSON.stringify(message)}`
    + outcome
    + ` trace=${JSON.stringify(trace)}`;
}

module.exports = {
  handleDanmakuMessage,
  parseDanmakuCommand,
  normalizeRandomScopeText,
  randomSourceValue,
  buildRandomScopeAutoReply,
  logDanmakuCommand,
  formatBilibiliCommandLog
};
