// 编写人：Aurora
// 签到机器人祝福语文案池，业务逻辑只从这里取一句附在回复后。
'use strict';

const CHECKIN_BLESSINGS = [
  '愿你今日诸事顺遂，所盼皆有回应。',
  '祝你平安喜乐，好运常伴。',
  '愿你所行皆坦途，所遇皆温暖。',
  '祝你日日有进步，事事有着落。',
  '愿你三餐四季皆温暖，平安常在。',
  '祝你工作顺心，生活舒心。',
  '愿你眼里有光，心中有暖。',
  '祝你烦恼随风去，欢喜踏歌来。',
  '愿你付出有收获，努力有回音。',
  '祝你身体安康，精神饱满。',
  '愿你心有所愿，行有所成。',
  '祝你新的一天顺顺利利，开开心心。',
  '愿你常有好心情，常遇好光景。',
  '祝你一路有花开，处处有惊喜。',
  '愿你忙有所获，闲有所乐。',
  '祝你前路明朗，步履从容。',
  '愿你所得皆所期，所失亦无碍。',
  '祝你笑口常开，万事胜意。',
  '愿你不负热爱，不负自己。',
  '祝你家人安康，岁岁常欢愉。',
  '愿你心宽无忧，日子有盼头。',
  '祝你好运连连，喜事不断。',
  '愿你遇事沉着，逢难化吉。',
  '祝你今天有收获，明天有期待。',
  '愿你认真生活，也被生活温柔以待。',
  '祝你心想事成，所愿皆圆满。',
  '愿你四时平安，日日自在。',
  '祝你一路向前，越来越好。',
  '愿你有福有乐，日子红红火火。',
  '祝你吉祥如意，幸福常相随。'
];

function parseCheckinBlessings(value) {
  let parsed = value;
  if (!Array.isArray(parsed)) {
    try {
      parsed = JSON.parse(String(value || ''));
    } catch (_) {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed)) return [...CHECKIN_BLESSINGS];

  const blessings = parsed
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return blessings.length > 0 ? blessings : [...CHECKIN_BLESSINGS];
}

function pickCheckinBlessing(value) {
  const blessings = parseCheckinBlessings(value);
  const index = Math.floor(Math.random() * blessings.length);
  return blessings[index] || blessings[0];
}

module.exports = { CHECKIN_BLESSINGS, parseCheckinBlessings, pickCheckinBlessing };
