'use strict';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function users(value, max, code) {
  if (!Array.isArray(value) || value.length > max) fail(code);
  return value.map((user) => {
    if (
      !user ||
      typeof user.uid !== 'string' ||
      !/^[1-9]\d{0,19}$/u.test(user.uid) ||
      typeof user.name !== 'string' ||
      user.name.length > 80 ||
      /[\x00-\x1f\x7f]/u.test(user.name)
    )
      fail(code);
    return { uid: user.uid, name: user.name };
  });
}

function keywords(value, code) {
  if (
    !Array.isArray(value) ||
    value.length > 200 ||
    value.some((word) => typeof word !== 'string' || !word.trim() || word.length > 100 || /[\x00-\x1f\x7f]/u.test(word))
  )
    fail(code);
  return [...value];
}

function overlayFilterParameters(value) {
  const code = 'INVALID_OVERLAY_FILTERS';
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !['blockedUsers', 'blockedKeywords'].includes(key))) fail(code);
  const result = {};
  if (Object.hasOwn(value, 'blockedUsers')) {
    result.blockedUsers = users(value.blockedUsers, 500, code);
    if (value.blockedUsers.some((user) => Object.keys(user).some((key) => !['uid', 'name'].includes(key)))) fail(code);
  }
  if (Object.hasOwn(value, 'blockedKeywords')) result.blockedKeywords = keywords(value.blockedKeywords, code);
  return result;
}

function sanitizeOverlayFilters(value) {
  return {
    ok: true,
    blockedUsers: users(value?.blockedUsers, 500, 'INVALID_RESPONSE'),
    blockedKeywords: keywords(value?.blockedKeywords, 'INVALID_RESPONSE'),
  };
}

function sanitizeOverlayViewers(value) {
  if (typeof value?.roomId !== 'string' || !/^[1-9]\d{0,19}$/u.test(value.roomId)) fail('INVALID_RESPONSE');
  return { ok: true, roomId: value.roomId, viewers: users(value.viewers, 150, 'INVALID_RESPONSE') };
}

module.exports = { overlayFilterParameters, sanitizeOverlayFilters, sanitizeOverlayViewers };
