export function formatClockDisplay(milliseconds, status) {
  const remainingMs = Math.max(0, Number(milliseconds) || 0);
  const finished = status === 'finished' || (status === 'running' && remainingMs === 0);
  return finished ? '该下播了' : formatClock(remainingMs);
}

export function nextClockDelay(remainingMs) {
  const remaining = Math.max(0, Number(remainingMs) || 0);
  const wholeSeconds = Math.ceil(remaining / 1000);
  const resolutionSeconds = wholeSeconds >= 365 * 86400 ? 3600 : wholeSeconds >= 86400 ? 60 : 1;
  // Formatting rounds up seconds before flooring calendar units; wake when that visible value changes.
  const nextSeconds = Math.floor(wholeSeconds / resolutionSeconds) * resolutionSeconds - 1;
  return Math.max(25, Math.ceil(remaining - nextSeconds * 1000));
}

export function formatClock(milliseconds) {
  return formatClockSeconds(Math.ceil((Number(milliseconds) || 0) / 1000));
}

export function formatClockSeconds(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(whole / 86400);
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `${years}年 ${days % 365}天 ${Math.floor((whole % 86400) / 3600)}小时`;
  }
  if (days > 0) {
    const hours = Math.floor((whole % 86400) / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    return `${days}天 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
