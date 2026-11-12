'use strict';

const { cleanText } = require('../../shared/utils');

function normalizeMentionTarget(input) {
  const uid = cleanText(input && input.uid);
  const name = cleanText(input && input.name).slice(0, 80);
  if (uid && !/^\d{1,20}$/.test(uid)) throw new Error('点歌人的 UID 格式无效。');
  return { uid, name };
}

module.exports = { normalizeMentionTarget };
