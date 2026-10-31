'use strict';

// Usage: node scripts/generate-world-clock-cities.js <populated-places.geojson> <cities15000.txt>
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Keep the IDs already stored by the original 60-city catalog.
const existingIds = new Map([
  [1159151595, 'beijing'], [1159151627, 'singapore'], [1159151577, 'london'],
  [1159151569, 'los-angeles'], [1159151235, 'dallas'], [1159151575, 'new-york'],
  [1159151609, 'tokyo'], [1159151523, 'seoul'], [1159151629, 'hong-kong'],
  [1159151605, 'shanghai'], [1159151567, 'taipei'], [1159151623, 'sydney'],
  [1159151565, 'melbourne'], [1159151169, 'brisbane'], [1159151475, 'perth'],
  [1159151703, 'auckland'], [1159151613, 'paris'], [1159151529, 'berlin'],
  [1159151593, 'rome'], [1159151503, 'madrid'], [1159151519, 'amsterdam'],
  [1159151271, 'zurich'], [1159151507, 'stockholm'], [1159151419, 'helsinki'],
  [1159151309, 'dublin'], [1159151273, 'lisbon'], [1159151585, 'moscow'],
  [1159151579, 'istanbul'], [1159151497, 'dubai'], [1159151581, 'riyadh'],
  [1159151541, 'new-delhi'], [1159151611, 'mumbai'], [1159150655, 'kathmandu'],
  [1159151509, 'bangkok'], [1159151317, 'kuala-lumpur'], [1159151599, 'jakarta'],
  [1159151525, 'manila'], [1159151253, 'ho-chi-minh'], [1159151479, 'san-francisco'],
  [1159151223, 'seattle'], [1159151491, 'chicago'], [1159151485, 'houston'],
  [1159151483, 'denver'], [1159151225, 'phoenix'], [1159151573, 'washington'],
  [1159151239, 'boston'], [1159151487, 'miami'], [1159151221, 'honolulu'],
  [1159151249, 'anchorage'], [1159151555, 'vancouver'], [1159151557, 'toronto'],
  [1159151587, 'mexico-city'], [1159151621, 'sao-paulo'], [1159151559, 'buenos-aires'],
  [1159151615, 'santiago'], [1159151511, 'lima'], [1159151603, 'cairo'],
  [1159151515, 'johannesburg'], [1159151597, 'nairobi'], [1159151591, 'lagos'],
]);

const [placesPath, geonamesPath] = process.argv.slice(2);
if (!placesPath || !geonamesPath) throw new Error('Provide Natural Earth GeoJSON and GeoNames cities15000.txt paths.');
const placesSource = fs.readFileSync(placesPath, 'utf8');
const geonamesSource = fs.readFileSync(geonamesPath, 'utf8');
const places = JSON.parse(placesSource).features.map(feature => feature.properties);
const geonames = new Map(geonamesSource.trim().split('\n').map(line => {
  const fields = line.split('\t');
  return [fields[0], fields];
}));
const countriesZh = new Intl.DisplayNames(['zh-Hans'], { type: 'region' });
const countriesEn = new Intl.DisplayNames(['en'], { type: 'region' });
const clean = value => typeof value === 'string' && value !== '-99' && value !== 'null' ? value.trim() : '';
const rows = [];
const locations = new Map();
const populations = new Map();
let missingZones = 0;
// Correct erroneous fallback zones in this Natural Earth snapshot using IANA zone1970.tab.
const correctedZones = new Map([[1159151359, 'Europe/Prague'], [1159149085, 'Asia/Macau']]);

// Choose a stable ID for source duplicates before sorting the results by population.
places.sort((a, b) => Number(existingIds.has(b.NE_ID)) - Number(existingIds.has(a.NE_ID)) || a.NE_ID - b.NE_ID);
for (const place of places) {
  const match = geonames.get(String(place.GEONAMESID));
  // Some source concordances point at a different place; never borrow its clock.
  const geo = match && match[8] === place.ISO_A2
    && Math.abs(Number(match[4]) - place.LATITUDE) < 1
    && Math.abs(Number(match[5]) - place.LONGITUDE) < 1 ? match : null;
  const zone = correctedZones.get(place.NE_ID)
    || (place.ISO_A2 === 'CN' ? 'Asia/Shanghai' : clean(geo?.[17]) || clean(place.TIMEZONE));
  if (!zone) { missingZones++; continue; }
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); }
  catch { missingZones++; continue; }

  const code = clean(place.ISO_A2);
  const country = ['CN', 'HK', 'MO', 'TW'].includes(code) ? '中国'
    : code ? countriesZh.of(code) : place.ADM0NAME;
  const countryEnglish = code ? countriesEn.of(code) : place.ADM0NAME;
  const name = clean(place.NAME_ZH) || clean(place.NAME_EN) || place.NAME;
  const english = clean(place.NAME_EN) || clean(place.NAMEASCII) || place.NAME;
  const region = clean(place.ADM1NAME);
  const aliases = [...new Set([
    place.NAME_ZHT, place.NAMEALT, place.NAMEASCII, place.NAME, geo?.[1], geo?.[2],
    countryEnglish, code ? countriesZh.of(code) : '',
  ].map(clean).filter(value => value && value !== name && value !== english && value !== country))].join('|');
  const lat = Number(geo?.[4] ?? place.LATITUDE);
  const lon = Number(geo?.[5] ?? place.LONGITUDE);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    throw new Error(`Invalid coordinates for ${place.NAME}`);
  }
  const location = `${country}|${lat}|${lon}`;
  const duplicate = locations.get(location);
  if (duplicate) {
    duplicate[8] = [...new Set([duplicate[8], aliases, name, english].flatMap(value => value.split('|')))]
      .filter(value => value && value !== duplicate[1] && value !== duplicate[2]).join('|');
    continue;
  }
  const row = [existingIds.get(place.NE_ID) || `ne-${place.NE_ID}`, name, english, country, zone, lat, lon, region, aliases];
  locations.set(location, row);
  populations.set(row[0], place.POP_MAX);
  rows.push(row);
}
rows.sort((a, b) => populations.get(b[0]) - populations.get(a[0]) || a[0].localeCompare(b[0], 'en'));
if (new Set(rows.map(row => row[0])).size !== rows.length) throw new Error('Duplicate city IDs.');
const hash = source => createHash('sha256').update(source).digest('hex');
const output = `// Generated by scripts/generate-world-clock-cities.js; do not edit by hand.
// Natural Earth populated places (public domain): https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/
// GeoNames coordinates/time zones (CC BY 4.0): https://download.geonames.org/export/dump/
// License: https://creativecommons.org/licenses/by/4.0/ — filtered and combined for LIRA.
// Natural Earth SHA-256: ${hash(placesSource)}
// GeoNames SHA-256: ${hash(geonamesSource)}
// Fields: id, name, english, country, zone, lat, lon, region, aliases.
export const CITY_CATALOG = [
${rows.map(row => `  ${JSON.stringify(row)},`).join('\n')}
];
`;
fs.writeFileSync(path.resolve(__dirname, '../public/js/admin/world-clock/city-catalog.js'), output);
console.log(`Generated ${rows.length} cities; omitted ${missingZones} places without a supported time zone.`);
