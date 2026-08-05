// 编写人：Aurora
// 签到机器人：只负责识别“签到”弹幕，并把签到结果转换为可发送的回复。
'use strict';

const { cleanText } = require('../shared/utils');
const { pickCheckinBlessing } = require('./checkin-blessings');

const CHECKIN_COMMAND = '签到';
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

function createCheckinService(dependencies = {}) {
  const {
    store,
    settings,
    nowMs = Date.now,
    pickBlessing = (_record, currentSettings) => pickCheckinBlessing(currentSettings.checkinBlessings)
  } = dependencies;
  if (!store || typeof store.checkIn !== 'function') {
    throw new Error('checkin store is required.');
  }

  return {
    handleDanmaku(danmaku = {}) {
      const text = cleanText(danmaku.message);
      if (text !== CHECKIN_COMMAND) {
        return { accepted: false, reason: 'not-checkin' };
      }

      const currentSettings = typeof settings === 'function' ? settings() : {};
      if (currentSettings.enableCheckinBot !== 'true') {
        return { accepted: false, reason: 'checkin-disabled', command: { type: 'checkin' } };
      }

      const uid = cleanText(danmaku.uid);
      if (!uid || uid === '0') {
        return { accepted: false, reason: 'missing-uid', command: { type: 'checkin' } };
      }

      const currentMs = Number(nowMs()) || Date.now();
      const userName = cleanText(danmaku.userName) || '观众';
      const record = store.checkIn({
        uid,
        userName,
        dateKey: chinaDateKey(currentMs),
        atIso: new Date(currentMs).toISOString()
      });
      const blessing = cleanText(pickBlessing(record, currentSettings)) || '';
      return {
        accepted: true,
        command: { type: 'checkin' },
        record,
        autoReply: {
          message: buildCheckinReply(record, blessing),
          target: { uid, name: userName }
        }
      };
    }
  };
}

function buildCheckinReply(record, blessing = '') {
  const totalDays = Math.max(1, Number(record && record.totalDays) || 1);
  const prefix = record && record.alreadyCheckedToday
    ? `今天已经签到过啦，已累计 ${totalDays} 天。`
    : `已签到 ${totalDays} 天。`;
  return `${prefix}${cleanText(blessing)}`;
}

function chinaDateKey(timestampMs) {
  const ms = Number(timestampMs) || Date.now();
  return new Date(ms + CHINA_OFFSET_MS).toISOString().slice(0, 10);
}

function isCheckinCommand(message) {
  return cleanText(message) === CHECKIN_COMMAND;
}

module.exports = {
  CHECKIN_COMMAND,
  createCheckinService,
  buildCheckinReply,
  chinaDateKey,
  isCheckinCommand
};
