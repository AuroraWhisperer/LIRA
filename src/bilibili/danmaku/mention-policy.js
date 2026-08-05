'use strict';

const { cleanText } = require('../../shared/utils');

function normalizeMentionTarget(input) {
  const uid = cleanText(input && input.uid);
  const name = cleanText(input && input.name).slice(0, 80);
  if (uid && !/^\d{1,20}$/.test(uid)) throw new Error('点歌人的 UID 格式无效。');
  return { uid, name };
}

function buildMentionedMessage(message, target) {
  const text = cleanText(message);
  if (!text) throw new Error('弹幕内容不能为空。');
  const mentionTarget = normalizeMentionTarget(target);
  if (!mentionTarget.name) return { message: text, target: mentionTarget };
  const prefix = `@${mentionTarget.name}`;
  return {
    message: text.startsWith(prefix) ? text : `${prefix} ${text}`,
    target: mentionTarget
  };
}

module.exports = { normalizeMentionTarget, buildMentionedMessage };
