// 编写人：Aurora
// 签到机器人祝福语文案池，业务逻辑只从这里取一句附在回复后。
'use strict';

const { CHECKIN_BLESSINGS } = require('../shared/bot-defaults');

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
