// 编写人：Aurora
// 弹幕入口共用的命令识别，避免 WebSocket 与历史轮询各维护一份名单。
'use strict';

const { cleanText } = require('../../shared/utils');
function dailyBotCommand(message) {
  const text = cleanText(message);
  return text === '签到' ? 'checkin' : text === '抽签' ? 'fortune' : null;
}

function isBilibiliCommandText(message, customMatcher = null) {
  const text = cleanText(message);
  return (
    text.startsWith('点歌') ||
    text.startsWith('随机') ||
    Boolean(dailyBotCommand(text)) ||
    (typeof customMatcher === 'function' && customMatcher(text) === true)
  );
}

module.exports = { isBilibiliCommandText, dailyBotCommand };
