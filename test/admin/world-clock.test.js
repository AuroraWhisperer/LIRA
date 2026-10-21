'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

let CITIES, DEFAULT_IDS, matchesCity, clockAt, dayDifference, differenceLabel, sunDirection, isDaylight;
test.before(async () => {
  const directory = path.resolve(__dirname, '../../public/js/admin/world-clock');
  ({ CITIES, DEFAULT_IDS, matchesCity } = await loadModuleExports(path.join(directory, 'cities.js')));
  ({ clockAt, dayDifference, differenceLabel, sunDirection, isDaylight } = await loadModuleExports(path.join(directory, 'time.js')));
});

test('seven default cities use their winter and summer time-zone rules', () => {
  assert.deepEqual([...DEFAULT_IDS], ['beijing', 'singapore', 'tokyo', 'london', 'los-angeles', 'dallas', 'new-york']);
  const cases = [
    ['2026-01-15T12:34:56Z', ['20:34', '20:34', '21:34', '12:34', '04:34', '06:34', '07:34']],
    ['2026-07-15T12:34:56Z', ['20:34', '20:34', '21:34', '13:34', '05:34', '07:34', '08:34']],
    ['2026-10-21T12:34:56Z', ['20:34', '20:34', '21:34', '13:34', '05:34', '07:34', '08:34']],
  ];
  for (const [date, expected] of cases) {
    const actual = [...DEFAULT_IDS].map(id => {
      const clock = clockAt(CITIES.find(city => city.id === id).zone, new Date(date));
      assert.equal(clock.second, '56');
      return `${clock.hour}:${clock.minute}`;
    });
    assert.deepEqual(actual, expected);
  }
});

test('US spring jump and repeated autumn hour keep the correct offsets', () => {
  const before = clockAt('America/New_York', new Date('2026-03-08T06:59:59Z'));
  const after = clockAt('America/New_York', new Date('2026-03-08T07:00:00Z'));
  assert.equal(before.hour, '01');
  assert.equal(after.hour, '03');
  assert.equal(after.offset, 'UTC-04:00');
  const first = clockAt('America/New_York', new Date('2026-11-01T05:30:00Z'));
  const second = clockAt('America/New_York', new Date('2026-11-01T06:30:00Z'));
  assert.equal(first.hour, '01');
  assert.equal(second.hour, '01');
  assert.equal(first.offsetMinutes, -240);
  assert.equal(second.offsetMinutes, -300);
});

test('UK changes independently of US and the Beijing day boundary is explicit', () => {
  const now = new Date('2026-03-20T16:05:00Z');
  const beijing = clockAt('Asia/Shanghai', now);
  const london = clockAt('Europe/London', now);
  const dallas = clockAt('America/Chicago', now);
  assert.equal(beijing.hour, '00');
  assert.equal(beijing.date, '2026-03-21');
  assert.equal(london.offsetMinutes, 0);
  assert.equal(dallas.offsetMinutes, -300);
  assert.equal(dayDifference(london, beijing), '前一天');
  assert.equal(differenceLabel(dallas, beijing), '比北京时间慢 13 小时');
  assert.equal(clockAt('Europe/London', new Date('2026-03-29T00:59:59Z')).hour, '00');
  assert.equal(clockAt('Europe/London', new Date('2026-03-29T01:00:00Z')).hour, '02');
});

test('half-hour and quarter-hour zones, noon and midnight are preserved', () => {
  const now = new Date('2026-01-15T00:00:00Z');
  assert.equal(clockAt('Asia/Kolkata', now).minute, '30');
  assert.equal(clockAt('Asia/Kathmandu', now).minute, '45');
  assert.equal(clockAt('Asia/Kathmandu', now).offset, 'UTC+05:45');
  assert.equal(clockAt('Europe/London', now, '12').hour, '12');
  assert.equal(clockAt('Europe/London', now, '12').period, '上午');
  assert.equal(clockAt('Europe/London', new Date('2026-01-15T12:00:00Z'), '12').period, '下午');
});

test('catalog has distinct IDs, valid zones, and searchable city/country names', () => {
  assert.equal(CITIES.length, 60);
  assert.equal(new Set(CITIES.map(city => city.id)).size, CITIES.length);
  for (const city of CITIES) assert.doesNotThrow(() => clockAt(city.zone));
  assert.ok(matchesCity(CITIES.find(city => city.id === 'dallas'), '达拉斯'));
  assert.ok(matchesCity(CITIES.find(city => city.id === 'london'), '英国'));
  assert.ok(matchesCity(CITIES.find(city => city.id === 'sao-paulo'), 'sao paulo'));
});

test('day/night approximation puts Greenwich in daylight at equinox noon', () => {
  const sun = sunDirection(new Date('2026-03-20T12:00:00Z'));
  assert.ok(isDaylight({ lat: 0, lon: 0 }, sun));
  assert.equal(isDaylight({ lat: 0, lon: 180 }, sun), false);
});
