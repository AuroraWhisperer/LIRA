export function formatTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleTimeString('zh-CN', { hour12: false });
}

export function formatDateTime(v) {
  if (!v) return '--';
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

export function formatBytes(v) {
  const bytes = Number(v);
  if (!Number.isFinite(bytes) || bytes < 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`;
}

export function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '--';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = Math.floor(total % 60);
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  if (minutes > 0) return `${minutes}分钟${rest}秒`;
  return `${rest}秒`;
}

export function formatSuperChatPrice(v) {
  const number = Number(v);
  if (!Number.isFinite(number)) return '0';
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatMoney(v) {
  const number = Number(v);
  if (!Number.isFinite(number) || number <= 0) return '¥0.00';
  return `¥${number.toFixed(2)}`;
}

export function formatCompactNumber(v) {
  const number = Math.max(0, Number(v) || 0);
  if (number >= 100000000) return `${(number / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  return String(Math.round(number));
}
