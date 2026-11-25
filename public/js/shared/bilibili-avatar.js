export function normalizeBilibiliAvatarUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.hdslb.com') || url.username || url.password) return '';
    return url.toString();
  } catch { return ''; }
}

export function bilibiliAvatarSource(value, token = '') {
  const url = normalizeBilibiliAvatarUrl(value);
  if (!url) return '';
  const query = new URLSearchParams({ url });
  const apiToken = String(token || '').trim();
  if (apiToken) query.set('token', apiToken);
  return `/api/bilibili/avatar?${query.toString()}`;
}
