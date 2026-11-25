import { baseCities, cityFilter } from './base-cities.js';
import { CITY_CATALOG } from './city-catalog.js';

const catalog = CITY_CATALOG.map(([id, name, english, country, zone, lat, lon, region, aliases]) =>
  ({ id, name, english, country, zone, lat, lon, region, aliases }));
const catalogById = new Map(catalog.map(city => [city.id, city]));

const originalCities = baseCities.map(city => ({ ...catalogById.get(city.id), ...city }));
const originalIds = new Set(originalCities.map(city => city.id));
export const CITIES = [...originalCities, ...catalog.filter(city => !originalIds.has(city.id))];

export function matchesCity(city, query) {
  return cityFilter(query)(city);
}
