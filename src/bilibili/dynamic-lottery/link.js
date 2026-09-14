'use strict';

const MAX_LINK_LENGTH = 2048;

function createLinkError(message) {
  const error = new TypeError(`Invalid Bilibili dynamic link: ${message}`);
  error.code = 'LOTTERY_DYNAMIC_LINK_INVALID';
  return error;
}

function normalizeDynamicLink(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw || raw.length > MAX_LINK_LENGTH) {
    throw createLinkError('URL is empty or too long.');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw createLinkError('URL cannot be parsed.');
  }
  if (parsed.protocol !== 'https:') {
    throw createLinkError('HTTPS is required.');
  }
  if (parsed.username || parsed.password || parsed.port) {
    throw createLinkError('credentials and non-default ports are not allowed.');
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 't.bilibili.com') {
    const match = parsed.pathname.match(/^\/([1-9]\d{0,63})\/?$/u);
    if (!match) throw createLinkError('unsupported t.bilibili.com path.');
    return {
      url: `https://t.bilibili.com/${match[1]}`,
      dynamicId: match[1],
      needsRedirect: false,
    };
  }

  if (host === 'www.bilibili.com') {
    const match = parsed.pathname.match(/^\/opus\/([1-9]\d{0,63})\/?$/u);
    if (!match) throw createLinkError('unsupported bilibili.com path.');
    return {
      url: `https://www.bilibili.com/opus/${match[1]}`,
      dynamicId: match[1],
      needsRedirect: false,
    };
  }

  if (host === 'b23.tv') {
    const match = parsed.pathname.match(/^\/([A-Za-z0-9_-]{1,128})\/?$/u);
    if (!match) throw createLinkError('unsupported b23.tv path.');
    return {
      url: `https://b23.tv/${match[1]}`,
      dynamicId: null,
      needsRedirect: true,
    };
  }

  throw createLinkError('host is not allowed.');
}

module.exports = { normalizeDynamicLink };
