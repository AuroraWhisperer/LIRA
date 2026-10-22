import { CITY_CATALOG } from './city-catalog.js';

const catalog = CITY_CATALOG.map(([id, name, english, country, zone, lat, lon, region, aliases]) =>
  ({ id, name, english, country, zone, lat, lon, region, aliases }));
const catalogById = new Map(catalog.map(city => [city.id, city]));

// Preserve saved IDs and the original cities' names, coordinates and clock rules.
const originalCities = [
  ['beijing', '北京', 'Beijing', '中国', 'Asia/Shanghai', 39.9042, 116.4074],
  ['singapore', '新加坡', 'Singapore', '新加坡', 'Asia/Singapore', 1.3521, 103.8198],
  ['london', '伦敦', 'London', '英国', 'Europe/London', 51.5074, -0.1278],
  ['los-angeles', '洛杉矶', 'Los Angeles', '美国', 'America/Los_Angeles', 34.0522, -118.2437],
  ['dallas', '达拉斯', 'Dallas', '美国', 'America/Chicago', 32.7767, -96.797],
  ['new-york', '纽约', 'New York', '美国', 'America/New_York', 40.7128, -74.006],
  ['tokyo', '东京', 'Tokyo', '日本', 'Asia/Tokyo', 35.6762, 139.6503],
  ['seoul', '首尔', 'Seoul', '韩国', 'Asia/Seoul', 37.5665, 126.978],
  ['hong-kong', '香港', 'Hong Kong', '中国', 'Asia/Hong_Kong', 22.3193, 114.1694],
  ['shanghai', '上海', 'Shanghai', '中国', 'Asia/Shanghai', 31.2304, 121.4737],
  ['taipei', '台北', 'Taipei', '中国', 'Asia/Taipei', 25.033, 121.5654],
  ['sydney', '悉尼', 'Sydney', '澳大利亚', 'Australia/Sydney', -33.8688, 151.2093],
  ['melbourne', '墨尔本', 'Melbourne', '澳大利亚', 'Australia/Melbourne', -37.8136, 144.9631],
  ['brisbane', '布里斯班', 'Brisbane', '澳大利亚', 'Australia/Brisbane', -27.4698, 153.0251],
  ['perth', '珀斯', 'Perth', '澳大利亚', 'Australia/Perth', -31.9523, 115.8613],
  ['auckland', '奥克兰', 'Auckland', '新西兰', 'Pacific/Auckland', -36.8485, 174.7633],
  ['paris', '巴黎', 'Paris', '法国', 'Europe/Paris', 48.8566, 2.3522],
  ['berlin', '柏林', 'Berlin', '德国', 'Europe/Berlin', 52.52, 13.405],
  ['rome', '罗马', 'Rome', '意大利', 'Europe/Rome', 41.9028, 12.4964],
  ['madrid', '马德里', 'Madrid', '西班牙', 'Europe/Madrid', 40.4168, -3.7038],
  ['amsterdam', '阿姆斯特丹', 'Amsterdam', '荷兰', 'Europe/Amsterdam', 52.3676, 4.9041],
  ['zurich', '苏黎世', 'Zurich', '瑞士', 'Europe/Zurich', 47.3769, 8.5417],
  ['stockholm', '斯德哥尔摩', 'Stockholm', '瑞典', 'Europe/Stockholm', 59.3293, 18.0686],
  ['helsinki', '赫尔辛基', 'Helsinki', '芬兰', 'Europe/Helsinki', 60.1699, 24.9384],
  ['dublin', '都柏林', 'Dublin', '爱尔兰', 'Europe/Dublin', 53.3498, -6.2603],
  ['lisbon', '里斯本', 'Lisbon', '葡萄牙', 'Europe/Lisbon', 38.7223, -9.1393],
  ['moscow', '莫斯科', 'Moscow', '俄罗斯', 'Europe/Moscow', 55.7558, 37.6173],
  ['istanbul', '伊斯坦布尔', 'Istanbul', '土耳其', 'Europe/Istanbul', 41.0082, 28.9784],
  ['dubai', '迪拜', 'Dubai', '阿联酋', 'Asia/Dubai', 25.2048, 55.2708],
  ['riyadh', '利雅得', 'Riyadh', '沙特阿拉伯', 'Asia/Riyadh', 24.7136, 46.6753],
  ['new-delhi', '新德里', 'New Delhi', '印度', 'Asia/Kolkata', 28.6139, 77.209],
  ['mumbai', '孟买', 'Mumbai', '印度', 'Asia/Kolkata', 19.076, 72.8777],
  ['kathmandu', '加德满都', 'Kathmandu', '尼泊尔', 'Asia/Kathmandu', 27.7172, 85.324],
  ['bangkok', '曼谷', 'Bangkok', '泰国', 'Asia/Bangkok', 13.7563, 100.5018],
  ['kuala-lumpur', '吉隆坡', 'Kuala Lumpur', '马来西亚', 'Asia/Kuala_Lumpur', 3.139, 101.6869],
  ['jakarta', '雅加达', 'Jakarta', '印度尼西亚', 'Asia/Jakarta', -6.2088, 106.8456],
  ['manila', '马尼拉', 'Manila', '菲律宾', 'Asia/Manila', 14.5995, 120.9842],
  ['ho-chi-minh', '胡志明市', 'Ho Chi Minh City', '越南', 'Asia/Ho_Chi_Minh', 10.8231, 106.6297],
  ['san-francisco', '旧金山', 'San Francisco', '美国', 'America/Los_Angeles', 37.7749, -122.4194],
  ['seattle', '西雅图', 'Seattle', '美国', 'America/Los_Angeles', 47.6062, -122.3321],
  ['chicago', '芝加哥', 'Chicago', '美国', 'America/Chicago', 41.8781, -87.6298],
  ['houston', '休斯敦', 'Houston', '美国', 'America/Chicago', 29.7604, -95.3698],
  ['denver', '丹佛', 'Denver', '美国', 'America/Denver', 39.7392, -104.9903],
  ['phoenix', '凤凰城', 'Phoenix', '美国', 'America/Phoenix', 33.4484, -112.074],
  ['washington', '华盛顿', 'Washington D.C.', '美国', 'America/New_York', 38.9072, -77.0369],
  ['boston', '波士顿', 'Boston', '美国', 'America/New_York', 42.3601, -71.0589],
  ['miami', '迈阿密', 'Miami', '美国', 'America/New_York', 25.7617, -80.1918],
  ['honolulu', '檀香山', 'Honolulu Hawaii', '美国', 'Pacific/Honolulu', 21.3099, -157.8581],
  ['anchorage', '安克雷奇', 'Anchorage Alaska', '美国', 'America/Anchorage', 61.2181, -149.9003],
  ['vancouver', '温哥华', 'Vancouver', '加拿大', 'America/Vancouver', 49.2827, -123.1207],
  ['toronto', '多伦多', 'Toronto', '加拿大', 'America/Toronto', 43.6532, -79.3832],
  ['mexico-city', '墨西哥城', 'Mexico City', '墨西哥', 'America/Mexico_City', 19.4326, -99.1332],
  ['sao-paulo', '圣保罗', 'São Paulo', '巴西', 'America/Sao_Paulo', -23.5505, -46.6333],
  ['buenos-aires', '布宜诺斯艾利斯', 'Buenos Aires', '阿根廷', 'America/Argentina/Buenos_Aires', -34.6037, -58.3816],
  ['santiago', '圣地亚哥', 'Santiago', '智利', 'America/Santiago', -33.4489, -70.6693],
  ['lima', '利马', 'Lima', '秘鲁', 'America/Lima', -12.0464, -77.0428],
  ['cairo', '开罗', 'Cairo', '埃及', 'Africa/Cairo', 30.0444, 31.2357],
  ['johannesburg', '约翰内斯堡', 'Johannesburg', '南非', 'Africa/Johannesburg', -26.2041, 28.0473],
  ['nairobi', '内罗毕', 'Nairobi', '肯尼亚', 'Africa/Nairobi', -1.2921, 36.8219],
  ['lagos', '拉各斯', 'Lagos', '尼日利亚', 'Africa/Lagos', 6.5244, 3.3792],
].map(([id, name, english, country, zone, lat, lon]) =>
  ({ ...catalogById.get(id), id, name, english, country, zone, lat, lon }));

const originalIds = new Set(originalCities.map(city => city.id));
export const CITIES = [...originalCities, ...catalog.filter(city => !originalIds.has(city.id))];

export const DEFAULT_IDS = ['beijing', 'singapore', 'tokyo', 'london', 'los-angeles', 'dallas', 'new-york'];

function normalize(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

const searchText = new Map(CITIES.map(city => [city.id,
  normalize(`${city.name} ${city.english} ${city.country} ${city.region || ''} ${city.aliases || ''} ${city.zone}`),
]));

export function matchesCity(city, query) {
  const text = searchText.get(city.id);
  return normalize(query).split(/\s+/).every(term => text.includes(term));
}
