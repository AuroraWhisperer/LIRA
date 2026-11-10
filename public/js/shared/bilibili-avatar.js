export function bilibiliAvatarSource(value, token = '') {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.hdslb.com')) {
      return '';
    }
    const query = new URLSearchParams({ url: url.toString() });
    const apiToken = String(token || '').trim();
    if (apiToken) query.set('token', apiToken);
    return `/api/bilibili/avatar?${query.toString()}`;
  } catch (_) {
    return '';
  }
}
