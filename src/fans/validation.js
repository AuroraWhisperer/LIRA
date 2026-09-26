'use strict';

const { DAY_MS, dateValue, dayStart } = require('./dates');

function text(value, label, max = 2000) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}过长或格式不正确。`);
  return value.trim();
}

function timestamp(value, label = '发生时间') {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label}无效。`);
  }
  return new Date(value).toISOString();
}

function identity(value) {
  if (!value || !value.value) return null;
  if (value.platform !== 'bilibili' || !['uid', 'open_id'].includes(value.type)) throw new Error('身份类型无效。');
  const id = text(value.value, '身份', 128);
  if (value.type === 'uid' && !/^[1-9]\d{0,24}$/.test(id)) throw new Error('UID 应为不含前导零的正整数字符串。');
  if (!id || /\s|[\x00-\x1f]/.test(id)) throw new Error('身份无效。');
  return { platform: value.platform, type: value.type, value: id };
}

function identityKey(value) {
  return value ? JSON.stringify([value.platform, value.type, value.value]) : null;
}

function birthday(value) {
  if (!value?.monthDay) return null;
  const monthDay = text(value.monthDay, '生日', 5);
  const calendar = value.calendar || 'solar';
  if (!['solar', 'lunar'].includes(calendar)) throw new Error('生日历法无效。');
  if (!/^\d{2}-\d{2}$/.test(monthDay)) throw new Error('生日应填写月日。');
  if (calendar === 'solar') dateValue(`2000-${monthDay}`, '生日', false);
  else if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|30)$/.test(monthDay)) throw new Error('农历月日无效。');
  const year = value.year === '' || value.year == null ? null : Number(value.year);
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()))
    throw new Error('出生年份无效。');
  if (calendar === 'solar' && year !== null) dateValue(`${year}-${monthDay}`, '生日', false);
  if (!['feb28', 'mar01', undefined].includes(value.leapDay)) throw new Error('闰日提醒规则无效。');
  return {
    monthDay,
    calendar,
    year,
    leapMonth: value.leapMonth === true,
    leapDay: value.leapDay || 'feb28',
    thisYearDate: dateValue(value.thisYearDate),
    advance: value.advance === true,
  };
}

function recentNameHistory(history = [], currentName = '') {
  const seen = new Set([currentName]);
  return [...history]
    .reverse()
    .filter((item) => {
      if (!item.name || seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    })
    .slice(0, 3)
    .reverse();
}

function profilePatch(input) {
  const result = {};
  const fields = {
    alias: 100,
    summary: 300,
    notes: 20000,
    nextTopic: 2000,
    zodiac: 30,
    mbtiNote: 500,
  };
  for (const [key, max] of Object.entries(fields)) {
    if (Object.hasOwn(input, key)) result[key] = text(input[key], key, max);
  }
  if (Object.hasOwn(input, 'identity')) result.identity = identity(input.identity);
  if (Object.hasOwn(input, 'birthday')) result.birthday = birthday(input.birthday);
  if (Object.hasOwn(input, 'mbti')) {
    const value = text(input.mbti, 'MBTI', 4).toUpperCase();
    if (value && !/^[IE][NS][FT][JP]$/.test(value)) throw new Error('请选择有效的 MBTI 类型或未知。');
    result.mbti = value;
  }
  if (Object.hasOwn(input, 'mbtiConfirmedAt')) result.mbtiConfirmedAt = dateValue(input.mbtiConfirmedAt);
  for (const key of ['favorite', 'archived', 'milestoneReminders', 'expiryReminders']) {
    if (Object.hasOwn(input, key)) {
      if (typeof input[key] !== 'boolean') throw new Error('开关值无效。');
      result[key] = input[key];
    }
  }
  if (Object.hasOwn(input, 'tags')) {
    if (!Array.isArray(input.tags) || input.tags.length > 30) throw new Error('最多填写 30 个标签。');
    result.tags = [...new Set(input.tags.map((tag) => text(tag, '标签', 50)).filter(Boolean))];
  }
  if (Object.hasOwn(input, 'formerNames')) {
    if (!Array.isArray(input.formerNames) || input.formerNames.length > 3) throw new Error('最多填写 3 个曾用名。');
    result.nameHistory = recentNameHistory(
      input.formerNames
        .map((name) => ({
          name: text(name, '曾用名', 200),
          observedAt: '',
        }))
        .reverse(),
    );
  }
  return result;
}

function count(value, label) {
  if (value === '' || value == null) return null;
  const number = typeof value === 'number' ? value : NaN;
  if (!Number.isSafeInteger(number) || number < 0 || number > 100000) throw new Error(`${label}必须为非负整数。`);
  return number;
}

function membership(input) {
  if (!['interval', 'baseline', 'observation', 'first'].includes(input.type)) throw new Error('大航海记录类型无效。');
  const result = {
    type: input.type,
    reason: text(input.reason, '依据说明'),
    decision: 'adopted',
  };
  if (input.type === 'interval') {
    result.precision = input.precision === 'instant' ? 'instant' : 'date';
    if (result.precision === 'date') {
      result.start = dateValue(input.start, '开始日期', false);
      result.end = dateValue(input.end, '有效至', false);
      result.startAt = new Date(dayStart(result.start)).toISOString();
      result.endAt = new Date(dayStart(result.end) + DAY_MS).toISOString();
    } else {
      result.startAt = timestamp(input.startAt, '生效时间');
      result.endAt = timestamp(input.endAt, '到期时间');
    }
    if (result.startAt >= result.endAt) throw new Error('有效期开始必须早于结束。');
  }
  if (input.type === 'interval' || input.type === 'observation') {
    if (![1, 2, 3].includes(input.level)) throw new Error('请选择大航海等级。');
    result.level = input.level;
  }
  if (input.type === 'observation') {
    result.observedAt = timestamp(input.observedAt);
    result.status = input.status === 'inactive' ? 'inactive' : 'observed';
  }
  if (input.type === 'baseline') {
    result.totalDays = count(input.totalDays, '累计天数');
    result.continuousDays = count(input.continuousDays, '连续天数');
    if (result.totalDays === null && result.continuousDays === null) throw new Error('请填写累计或连续天数。');
    result.asOf = dateValue(input.asOf, '天数截至日期', false);
    if (result.totalDays !== null && result.continuousDays !== null && result.totalDays < result.continuousDays) {
      throw new Error('同一截至日期的累计天数不能少于连续天数。');
    }
  }
  if (input.type === 'first') result.date = dateValue(input.date, '首次上舰日期', false);
  return result;
}

function recordData(kind, input) {
  if (kind === 'membership') return membership(input);
  if (kind === 'song') {
    const name = text(input.songName, '歌名', 300);
    if (!name) throw new Error('请填写歌名。');
    return {
      songName: name,
      artist: text(input.artist, '歌手', 300),
      category: text(input.category, '曲库分类', 300),
      note: text(input.note, '说明'),
      excludeFromStats: input.excludeFromStats === true,
      excluded: input.excluded === true,
    };
  }
  if (kind === 'preference') {
    if (!['like', 'dislike'].includes(input.sentiment)) throw new Error('请选择喜欢或不喜欢。');
    const label = text(input.label, '偏好', 300);
    if (!label) throw new Error('请填写偏好内容。');
    return {
      label,
      sentiment: input.sentiment,
      reason: text(input.reason, '依据'),
      archived: input.archived === true,
    };
  }
  if (kind === 'anniversary') {
    const name = text(input.name, '纪念日名称', 100);
    if (!name) throw new Error('请填写纪念日名称。');
    const advanceDays = count(input.advanceDays ?? 0, '提前天数');
    if (advanceDays > 30) throw new Error('最多提前 30 天。');
    return {
      name,
      date: dateValue(input.date, '纪念日', false),
      annual: input.annual === true,
      advanceDays,
      note: text(input.note, '纪念日说明'),
      archived: input.archived === true,
    };
  }
  if (!['note', 'topic', 'caution', 'followup'].includes(kind)) throw new Error('记录类型无效。');
  const body = text(input.body, '内容', 10000);
  if (!body) throw new Error('请填写内容。');
  return {
    body,
    tag: text(input.tag, '标签', 50),
    pinned: input.pinned === true,
    reviewDate: dateValue(input.reviewDate),
    archived: input.archived === true,
    completed: input.completed === true,
  };
}

module.exports = {
  text,
  timestamp,
  identity,
  identityKey,
  birthday,
  profilePatch,
  recentNameHistory,
  recordData,
};
