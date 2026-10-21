const formatters = new Map();
const DAY = 86400000;

function formatter(zone, format) {
  const key = `${zone}/${format}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: format === '12' ? 'h12' : 'h23', timeZoneName: 'longOffset',
    }));
  }
  return formatters.get(key);
}

export function clockAt(zone, date = new Date(), format = '24') {
  const parts = Object.fromEntries(formatter(zone, format).formatToParts(date).map(part => [part.type, part.value]));
  const offset = parts.timeZoneName.replace('GMT', 'UTC');
  const match = offset.match(/([+-])(\d{2}):(\d{2})/);
  const offsetMinutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) : 0;
  const localDay = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  return {
    hour: parts.hour.padStart(2, '0'), minute: parts.minute, second: parts.second,
    period: parts.dayPeriod ? (parts.dayPeriod.toLowerCase() === 'am' ? '上午' : '下午') : '',
    date: `${parts.year}-${parts.month}-${parts.day}`, localDay,
    dateLabel: `${Number(parts.month)}月${Number(parts.day)}日`,
    fullDate: `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日`,
    weekday: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][new Date(localDay).getUTCDay()],
    offset: offset === 'UTC' ? 'UTC+00:00' : offset, offsetMinutes,
  };
}

export function dayDifference(clock, reference) {
  const days = Math.round((clock.localDay - reference.localDay) / DAY);
  if (!days) return '';
  return days === -1 ? '前一天' : days === 1 ? '后一天' : `${days > 0 ? '后' : '前'}${Math.abs(days)}天`;
}

export function coordinates(lat, lon) {
  const latitude = lat * Math.PI / 180;
  const longitude = lon * Math.PI / 180;
  return [Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)];
}

// NOAA's approximate solar-position equations, for the visual day/night boundary.
export function sunDirection(date = new Date()) {
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const daysInYear = (Date.UTC(year + 1, 0, 1) - yearStart) / DAY;
  const day = Math.floor((date.getTime() - yearStart) / DAY);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const angle = 2 * Math.PI / daysInYear * (day + (minutes / 60 - 12) / 24);
  const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(angle) - 0.032077 * Math.sin(angle)
    - 0.014615 * Math.cos(2 * angle) - 0.040849 * Math.sin(2 * angle));
  const declination = 0.006918 - 0.399912 * Math.cos(angle) + 0.070257 * Math.sin(angle)
    - 0.006758 * Math.cos(2 * angle) + 0.000907 * Math.sin(2 * angle)
    - 0.002697 * Math.cos(3 * angle) + 0.00148 * Math.sin(3 * angle);
  return coordinates(declination * 180 / Math.PI, 180 - (minutes + equation) / 4);
}

export function isDaylight(city, sun) {
  return coordinates(city.lat, city.lon).reduce((sum, value, index) => sum + value * sun[index], 0) > 0;
}
