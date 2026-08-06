'use strict';

function getCurrentTime(input = {}, options = {}) {
  const timeZone = String(input.timeZone || 'Asia/Shanghai');
  const suppliedNow = typeof options.now === 'function' ? options.now() : options.now;
  const now = suppliedNow ? new Date(suppliedNow) : new Date();
  let formatted;
  try {
    formatted = new Intl.DateTimeFormat('zh-CN', {
      timeZone, dateStyle: 'full', timeStyle: 'medium', hour12: false
    }).format(now);
  } catch {
    throw new Error('时区名称无效，请使用如 Asia/Shanghai。');
  }
  return { timeZone, formatted, isoUtc: now.toISOString() };
}

module.exports = { getCurrentTime };
