// 编写人：Aurora
// 弹幕入口共用的命令识别，避免 WebSocket 与历史轮询各维护一份名单。
'use strict';

const { cleanText } = require('../../shared/utils');
const { isCheckinCommand } = require('../checkin-service');
const { isFortuneCommand } = require('../fortune-service');

function isBilibiliCommandText(message) {
  const text = cleanText(message);
  return text.startsWith('点歌') || text.startsWith('随机')
    || isCheckinCommand(text) || isFortuneCommand(text);
}

module.exports = { isBilibiliCommandText };
