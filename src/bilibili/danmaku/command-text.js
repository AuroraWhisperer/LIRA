// 编写人：Aurora
// 弹幕入口共用的命令识别，避免 WebSocket 与历史轮询各维护一份名单。
'use strict';

const { cleanText } = require('../../shared/utils');
const { toSimplifiedChinese } = require('../../shared/chinese-text');
function dailyBotCommand(message, text = toSimplifiedChinese(cleanText(message))) {
  return text === '签到' ? 'checkin' : text === '抽签' ? 'fortune' : null;
}

function isSongCancelCommand(commandText) {
  return commandText.startsWith('取消点歌');
}

function isSongRequestCommand(commandText) {
  return commandText.startsWith('点歌') || commandText.startsWith('随机点歌');
}

function isBilibiliCommandText(message, customMatcher = null, simplified) {
  const text = cleanText(message);
  const commandText = simplified === undefined ? toSimplifiedChinese(text) : cleanText(simplified);
  return (
    isSongRequestCommand(commandText) ||
    isSongCancelCommand(commandText) ||
    Boolean(dailyBotCommand(text, commandText)) ||
    (typeof customMatcher === 'function' && customMatcher(text, commandText) === true)
  );
}

module.exports = { isBilibiliCommandText, dailyBotCommand, isSongCancelCommand, isSongRequestCommand };
