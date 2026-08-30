// 编写人：Aurora
// 抽签机器人：按观众 UID 和北京时间日期生成每日固定的一签。
'use strict';

const { cleanText } = require('../shared/utils');
const { chinaDateKey } = require('./checkin-service');
const { FORTUNES } = require('../shared/bot-defaults');

const FORTUNE_COMMAND = '抽签';

function createFortuneService(dependencies = {}) {
  const {
    settings,
    nowMs = Date.now,
    pickFortune = pickDailyFortune,
  } = dependencies;

  return {
    handleDanmaku(danmaku = {}) {
      if (!isFortuneCommand(danmaku.message)) {
        return { accepted: false, reason: 'not-fortune' };
      }

      const currentSettings = typeof settings === 'function' ? settings() : {};
      if (currentSettings.enableFortuneBot !== 'true') {
        return {
          accepted: false,
          reason: 'fortune-disabled',
          command: { type: 'fortune' },
        };
      }

      const uid = cleanText(danmaku.uid);
      if (!uid || uid === '0') {
        return {
          accepted: false,
          reason: 'missing-uid',
          command: { type: 'fortune' },
        };
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
          target: { uid, name: userName },
        },
      };
    },
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

  const fortunes = parsed
    .map((item) => ({
      level: cleanText(item && item.level),
      name: cleanText(item && item.name),
      text: cleanText(item && item.text),
      advice: cleanText(item && item.advice),
    }))
    .filter((item) => item.level && item.name && item.text && item.advice);
  return fortunes.length > 0 ? fortunes : [...FORTUNES];
}

function pickDailyFortune(uid, dateKey, value) {
  const fortunes = parseFortunePool(value);
  const index =
    stableHash(`${cleanText(dateKey)}:${cleanText(uid)}`) % fortunes.length;
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
  isFortuneCommand,
};
