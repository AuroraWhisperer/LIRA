'use strict';

const DAY_MS = 86_400_000;
const OFFSET_MS = 8 * 3_600_000;

function dayOf(value = Date.now()) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('日期无效。');
  return new Date(time + OFFSET_MS).toISOString().slice(0, 10);
}

function dateValue(value, label = '日期', optional = true) {
  if ((value === '' || value == null) && optional) return '';
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > '2200-12-31' ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${label}无效。`);
  }
  return value;
}

function dayStart(date) {
  return Date.parse(`${dateValue(date, '日期', false)}T00:00:00+08:00`);
}

function addDays(date, days) {
  return dayOf(dayStart(date) + days * DAY_MS);
}

function daysBetween(start, end) {
  return Math.round((dayStart(end) - dayStart(start)) / DAY_MS);
}

function anniversaryDate(monthDay, year, leapDay = 'feb28') {
  const date = `${year}-${monthDay}`;
  if (
    monthDay === '02-29' &&
    new Date(`${year}-02-29T00:00:00Z`).getUTCMonth() !== 1
  ) {
    return `${year}-${leapDay === 'mar01' ? '03-01' : '02-28'}`;
  }
  return dateValue(date, '纪念日', false);
}

function zodiacFor(birthday) {
  if (!birthday?.monthDay || birthday.calendar !== 'solar') return '';
  const boundaries = [
    120, 219, 321, 420, 521, 622, 723, 823, 923, 1024, 1123, 1222,
  ];
  const signs = [
    '摩羯座',
    '水瓶座',
    '双鱼座',
    '白羊座',
    '金牛座',
    '双子座',
    '巨蟹座',
    '狮子座',
    '处女座',
    '天秤座',
    '天蝎座',
    '射手座',
    '摩羯座',
  ];
  const value = Number(birthday.monthDay.replace('-', ''));
  const index = boundaries.findIndex((boundary) => value < boundary);
  return signs[index < 0 ? 12 : index];
}

module.exports = {
  DAY_MS,
  dayOf,
  dateValue,
  dayStart,
  addDays,
  daysBetween,
  anniversaryDate,
  zodiacFor,
};
