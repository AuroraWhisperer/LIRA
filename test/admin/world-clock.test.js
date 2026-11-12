'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadModuleExports } = require('../helpers/frontend-modules');

let CITIES, matchesCity, clockAt, dayDifference, sunDirection, isDaylight;
test.before(async () => {
  const directory = path.resolve(__dirname, '../../public/js/admin/world-clock');
  ({ CITIES, matchesCity } = await loadModuleExports(path.join(directory, 'cities.js')));
  ({ clockAt, dayDifference, sunDirection, isDaylight } = await loadModuleExports(path.join(directory, 'time.js')));
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

test('catalog has distinct saved IDs and valid zones', () => {
  assert.equal(new Set(CITIES.map(city => city.id)).size, CITIES.length);
  for (const zone of new Set(CITIES.map(city => city.zone))) assert.doesNotThrow(() => clockAt(zone));
});

test('Atlanta is searchable in Chinese and English with the correct seasonal clock', () => {
  const cities = CITIES.filter(city => matchesCity(city, '亚特兰大'));
  assert.equal(cities.length, 1);
  const atlanta = cities[0];
  for (const query of [' ATLANTA ', '美国 Atlanta']) assert.ok(matchesCity(atlanta, query), query);
  assert.equal(clockAt(atlanta.zone, new Date('2026-01-15T12:00:00Z')).hour, '07');
  assert.equal(clockAt(atlanta.zone, new Date('2026-07-15T12:00:00Z')).hour, '08');
  assert.equal(matchesCity(atlanta, 'Atlanta Canada'), false);
});

test('catalog disambiguates repeated city names by region and zone', () => {
  const lasVegas = CITIES.filter(city => city.english === 'Las Vegas' && city.country === '美国');
  assert.equal(lasVegas.length, 2);
  assert.ok(lasVegas.some(city => city.region === 'Nevada' && city.zone === 'America/Los_Angeles'));
  assert.ok(lasVegas.some(city => city.region === 'New Mexico' && city.zone === 'America/Denver'));
});

test('corrected catalog entries retain stable IDs and their seasonal local times', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  const summer = new Date('2026-07-15T12:00:00Z');
  for (const [id, name, zone, times] of [
    ['ne-1159151359', '布拉格', 'Europe/Prague', ['13:00', '14:00']],
    ['ne-1159149085', '澳门', 'Asia/Macau', ['20:00', '20:00']],
    ['ne-1159151737', '怀唐伊', 'Pacific/Chatham', ['01:45', '00:45']],
  ]) {
    const city = CITIES.find(value => value.id === id);
    assert.ok(matchesCity(city, name));
    assert.equal(city.zone, zone);
    const winterClock = clockAt(city.zone, winter);
    const summerClock = clockAt(city.zone, summer);
    assert.equal(`${winterClock.hour}:${winterClock.minute}`, times[0]);
    assert.equal(`${summerClock.hour}:${summerClock.minute}`, times[1]);
  }
});

test('catalog generation corrects known erroneous source fallback zones before writing tuples', () => {
  const generator = path.resolve(__dirname, '../../scripts/generate-world-clock-cities.js');
  const places = [
    { NE_ID: 1159151359, ISO_A2: 'CZ', NAME: 'Prague', TIMEZONE: 'America/Chicago', LATITUDE: 50.085283, LONGITUDE: 14.464034 },
    { NE_ID: 1159149085, ISO_A2: 'MO', NAME: 'Macau', TIMEZONE: 'America/Fortaleza', LATITUDE: 22.202998, LONGITUDE: 113.545048 },
    { NE_ID: 1159151737, ISO_A2: 'NZ', NAME: 'Waitangi', TIMEZONE: 'Pacific/Auckland', LATITUDE: -44.026253, LONGITUDE: -176.369579 },
  ];
  let generated;
  vm.runInNewContext(fs.readFileSync(generator, 'utf8'), {
    __dirname: path.dirname(generator), process: { argv: ['node', generator, 'places', 'geonames'] }, console: { log() {} },
    require(name) {
      if (name !== 'node:fs') return require(name);
      return { readFileSync: file => file === 'places' ? JSON.stringify({ features: places.map(properties => ({ properties })) }) : '',
        writeFileSync: (_file, value) => { generated = value; } };
    },
  });
  const rows = JSON.parse(generated.slice(generated.indexOf('export const CITY_CATALOG = [') + 'export const CITY_CATALOG = '.length)
    .trim().replace(/;$/, '').replace(/,\s*]$/, ']'));
  assert.equal(rows.find(row => row[0] === 'ne-1159151359')[4], 'Europe/Prague');
  assert.equal(rows.find(row => row[0] === 'ne-1159149085')[4], 'Asia/Macau');
  assert.equal(rows.find(row => row[0] === 'ne-1159151737')[4], 'Pacific/Chatham');
});

test('day/night approximation puts Greenwich in daylight at equinox noon', () => {
  const sun = sunDirection(new Date('2026-03-20T12:00:00Z'));
  assert.ok(isDaylight({ lat: 0, lon: 0 }, sun));
  assert.equal(isDaylight({ lat: 0, lon: 180 }, sun), false);
});
