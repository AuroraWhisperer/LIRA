// 编写人：Aurora
// 抽签机器人：按观众 UID 和北京时间日期生成每日固定的一签。
'use strict';

const { cleanText } = require('../shared/utils');
const { chinaDateKey } = require('./checkin-service');

const FORTUNE_COMMAND = '抽签';

const FORTUNES = [
  { level: '上上签', name: '云开见日', text: '守得云开见月明，眼前的阻滞正在渐渐散去', advice: '宜乘势而为，把握已经出现的机会；忌得意忘形，忽略同行之人' },
  { level: '上上签', name: '春风得意', text: '东风正好，花开有时', advice: '宜把握良机，忌急躁冒进' },
  { level: '上吉签', name: '锦上添花', text: '好事将近，佳音可期', advice: '宜主动争取，忌犹豫不决' },
  { level: '上吉签', name: '贵人相助', text: '同心同行，事半功倍', advice: '宜真诚求助，忌闭门独行' },
  { level: '上吉签', name: '水到渠成', text: '功夫不负，收获渐近', advice: '宜稳步推进，忌半途而废' },
  { level: '上吉签', name: '喜上眉梢', text: '小喜将至，心愿有回音', advice: '宜分享欢喜，忌过分张扬' },
  { level: '中吉签', name: '稳中有进', text: '步步踏实，渐入佳境', advice: '宜按部就班，忌贪多求快' },
  { level: '中吉签', name: '柳暗花明', text: '转过一弯，便见新景', advice: '宜换个思路，忌钻牛角尖' },
  { level: '中吉签', name: '静候花开', text: '时机未晚，眼下的沉静正是在为下一程积蓄力量', advice: '宜耐心打磨手中之事；忌频频催促，让焦虑扰乱原有节奏' },
  { level: '中吉签', name: '和气生财', text: '人和事顺，财路自宽', advice: '宜以和为贵，忌意气用事' },
  { level: '中吉签', name: '勤能补拙', text: '日拱一卒，终有所成', advice: '宜专心精进，忌三心二意' },
  { level: '中吉签', name: '顺水行舟', text: '借势而行，省力有成', advice: '宜顺势调整，忌逆势强求' },
  { level: '中吉签', name: '家和事兴', text: '灯火可亲，诸事安稳', advice: '宜多些体谅，忌争一时气' },
  { level: '小吉签', name: '小有收获', text: '耕耘有信，小得亦欢', advice: '宜珍惜所得，忌嫌少贪多' },
  { level: '小吉签', name: '平安顺意', text: '无惊无扰，便是好日', advice: '宜照顾自己，忌劳心过度' },
  { level: '小吉签', name: '旧友重逢', text: '故人有信，旧缘添暖', advice: '宜主动问候，忌计较旧事' },
  { level: '小吉签', name: '灵光初现', text: '心有所感，可成新意', advice: '宜及时记录，忌空想不做' },
  { level: '小吉签', name: '雨过天青', text: '烦忧渐散，心境渐明', advice: '宜放下包袱，忌反复内耗' },
  { level: '平签', name: '守正待时', text: '眼下平常，静中藏机', advice: '宜守好本分，忌贸然变动' },
  { level: '平签', name: '慢即是快', text: '路远不急，稳走便到', advice: '宜从容安排，忌自乱阵脚' }
];

function createFortuneService(dependencies = {}) {
  const {
    settings,
    nowMs = Date.now,
    pickFortune = pickDailyFortune
  } = dependencies;

  return {
    handleDanmaku(danmaku = {}) {
      if (!isFortuneCommand(danmaku.message)) {
        return { accepted: false, reason: 'not-fortune' };
      }

      const currentSettings = typeof settings === 'function' ? settings() : {};
      if (currentSettings.enableFortuneBot !== 'true') {
        return { accepted: false, reason: 'fortune-disabled', command: { type: 'fortune' } };
      }

      const uid = cleanText(danmaku.uid);
      if (!uid || uid === '0') {
        return { accepted: false, reason: 'missing-uid', command: { type: 'fortune' } };
      }

      const dateKey = chinaDateKey(Number(nowMs()) || Date.now());
      const fortune = pickFortune(uid, dateKey, currentSettings.fortunePool);
      const userName = cleanText(danmaku.userName) || '观众';
      return {
        accepted: true,
        command: { type: 'fortune' },
        dateKey,
        fortune,
        autoReply: {
          message: buildFortuneReply(fortune),
          target: { uid, name: userName }
        }
      };
    }
  };
}

function parseFortunePool(value) {
  let parsed = value;
  if (!Array.isArray(parsed)) {
    try {
      parsed = JSON.parse(String(value || ''));
    } catch (_) {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed)) return [...FORTUNES];

  const fortunes = parsed.map((item) => ({
    level: cleanText(item && item.level),
    name: cleanText(item && item.name),
    text: cleanText(item && item.text),
    advice: cleanText(item && item.advice)
  })).filter((item) => item.level && item.name && item.text && item.advice);
  return fortunes.length > 0 ? fortunes : [...FORTUNES];
}

function pickDailyFortune(uid, dateKey, value) {
  const fortunes = parseFortunePool(value);
  const index = stableHash(`${cleanText(dateKey)}:${cleanText(uid)}`) % fortunes.length;
  return fortunes[index];
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildFortuneReply(fortune = {}) {
  return `${cleanText(fortune.level)}·${cleanText(fortune.name)}｜${cleanText(fortune.text)}。${cleanText(fortune.advice)}。`;
}

function isFortuneCommand(message) {
  return cleanText(message) === FORTUNE_COMMAND;
}

module.exports = {
  FORTUNE_COMMAND,
  FORTUNES,
  createFortuneService,
  parseFortunePool,
  pickDailyFortune,
  buildFortuneReply,
  isFortuneCommand
};
