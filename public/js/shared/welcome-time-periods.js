// Keep this portable contract in sync with Server src/lib/welcome-time-periods.mjs.
export const WELCOME_TIME_PERIODS = Object.freeze([
  { id: 'earlyMorning', label: '早晨', range: '05:00–09:00', start: 5, end: 9 },
  { id: 'morning', label: '上午', range: '09:00–12:00', start: 9, end: 12 },
  { id: 'afternoon', label: '下午', range: '12:00–18:00', start: 12, end: 18 },
  { id: 'evening', label: '晚上', range: '18:00–23:00', start: 18, end: 23 },
  { id: 'lateNight', label: '深夜', range: '23:00–05:00', start: 23, end: 5 },
].map(Object.freeze));

export function welcomeTimePeriod(timestamp) {
  const hour = new Date(timestamp + 8 * 60 * 60 * 1000).getUTCHours();
  return WELCOME_TIME_PERIODS.find(({ start, end }) =>
    start < end ? hour >= start && hour < end : hour >= start || hour < end);
}

export function normalizeTimeWelcomeMessages(value, normalizeMessages, partial = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.keys(value).length
    || (!partial && Object.keys(value).length !== WELCOME_TIME_PERIODS.length)
    || Object.keys(value).some(key => !WELCOME_TIME_PERIODS.some(({ id }) => key === id))) {
    throw Object.assign(new Error('INVALID_WELCOME_MESSAGES'), { code: 'INVALID_WELCOME_MESSAGES' });
  }
  return Object.fromEntries(WELCOME_TIME_PERIODS.filter(({ id }) => Object.hasOwn(value, id))
    .map(({ id }) => [id, normalizeMessages(value[id])]));
}
