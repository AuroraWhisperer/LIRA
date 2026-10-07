'use strict';

function normalizeAvatarUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) return '';
  try {
    const url = new URL(value);
    const trusted = url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com');
    return url.protocol === 'https:' && trusted && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
}

module.exports = { normalizeAvatarUrl };
