// 编写人：Aurora
// 弹幕入口共用的命令识别，避免 WebSocket 与历史轮询各维护一份名单。
'use strict';

const { cleanText } = require('../../shared/utils');
const { toSimplifiedChinese } = require('../../shared/chinese-text');
function dailyBotCommand(message) {
  const text = toSimplifiedChinese(cleanText(message));
  return text === '签到' ? 'checkin' : text === '抽签' ? 'fortune' : null;
}

function isBilibiliCommandText(message, customMatcher = null) {
  const text = cleanText(message);
  const commandText = toSimplifiedChinese(text);
  return (
    commandText.startsWith('点歌') ||
    commandText.startsWith('随机点歌') ||
    commandText.startsWith('取消点歌') ||
    Boolean(dailyBotCommand(text)) ||
    (typeof customMatcher === 'function' && customMatcher(text) === true)
  );
}

module.exports = { isBilibiliCommandText, dailyBotCommand };
