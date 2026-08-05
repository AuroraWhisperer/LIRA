// 编写人：Aurora
// 签到机器人祝福语文案池，业务逻辑只从这里取一句附在回复后。
'use strict';

const CHECKIN_BLESSINGS = [
  '祝你今天心情明亮。',
  '愿今天的好运准时到达。',
  '愿你一整天都被温柔对待。',
  '祝你今天顺顺利利。',
  '愿快乐多一点，烦恼少一点。',
  '祝你今天元气满满。',
  '愿好消息正在路上。',
  '祝你直播间玩得开心。',
  '愿今天也有小小惊喜。',
  '祝你每一步都轻松一点。'
];

function pickCheckinBlessing() {
  const index = Math.floor(Math.random() * CHECKIN_BLESSINGS.length);
  return CHECKIN_BLESSINGS[index] || CHECKIN_BLESSINGS[0];
}

module.exports = { CHECKIN_BLESSINGS, pickCheckinBlessing };
