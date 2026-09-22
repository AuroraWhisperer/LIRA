'use strict';

const { isDnsHostname } = require('../../shared/remote-url-policy');
const BILIBILI_IMAGE_HOST = 'hdslb.com';

function normalizeBilibiliImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== 'https:' ||
      (hostname !== BILIBILI_IMAGE_HOST && !hostname.endsWith(`.${BILIBILI_IMAGE_HOST}`)) ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== '443') ||
      parsed.hash
    )
      return '';
    return parsed.href;
  } catch (_) {
    return '';
  }
}

function normalizeImagePath(value, imageBaseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const baseUrl = normalizeImageBaseUrl(imageBaseUrl);
  // An absolute remote URL is only trusted after the composition root has
  // supplied the configured server origin.  This prevents a startup or
  // tampered response from turning a missing base into an arbitrary image
  // request; the main process supplies the configured base before refresh.
  if (!baseUrl) return '';
  const base = new URL(baseUrl);
  let parsed;
  try {
    parsed = new URL(raw, base);
  } catch (_) {
    return '';
  }
  if (!/^\/gift-media\/images\/[A-Za-z0-9._-]+$/u.test(parsed.pathname)) return '';
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return '';
  if (parsed.origin !== base.origin) return '';
  return parsed.href;
}

function normalizeImageBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:' ||
      !isDnsHostname(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== '/' && parsed.pathname !== '') ||
      parsed.search ||
      parsed.hash
    )
      return '';
    return parsed.origin;
  } catch (_) {
    return '';
  }
}

module.exports = {
  normalizeBilibiliImageUrl,
  normalizeImagePath,
  normalizeImageBaseUrl,
};
