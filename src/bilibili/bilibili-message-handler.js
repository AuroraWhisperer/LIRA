// 编写人：Aurora
// Bilibili 弹幕 → 点歌的桥接层。
// 这是 Bilibili 和 music 域之间的唯一桥梁，解析弹幕指令后调用 queue-service。
'use strict';

const { cleanText, formatLogTimestamp } = require('../shared/utils');

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
        ? `没有找到歌手、风格或语言「${command.scopeText}」里的可随机歌曲。`
        : '歌库里还没有可随机歌曲。';
      return { accepted: false, reason, command };
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
    queueItem = context.addQueueItem({
      songName: command.songName,
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

  if (result.accepted) {
    console.log(`[Bilibili] command accepted: time=${formatLogTimestamp(danmaku.messageTimestamp)} source=${danmaku.source || 'danmaku'} user=${danmaku.userName || ''} uid=${danmaku.uid || ''} message=${JSON.stringify(message)} song=${result.queueItem ? result.queueItem.song_name : ''}`);
  } else {
    console.log(`[Bilibili] command ignored: time=${formatLogTimestamp(danmaku.messageTimestamp)} source=${danmaku.source || 'danmaku'} user=${danmaku.userName || ''} uid=${danmaku.uid || ''} message=${JSON.stringify(message)} reason=${result.reason || ''}`);
  }
}

module.exports = {
  handleDanmakuMessage,
  parseDanmakuCommand,
  normalizeRandomScopeText,
  randomSourceValue,
  logDanmakuCommand
};
