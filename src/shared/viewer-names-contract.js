'use strict';

const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });

function fail(code = 'INVALID_VIEWER_NAME_REQUEST') {
  throw Object.assign(new Error(code), { code });
}

function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail();
}

function viewerNameUid(uid, code) {
  if (typeof uid !== 'string' || !/^[1-9]\d{0,19}$/.test(uid)) fail(code);
  return uid;
}

function viewerNameValue(name, code) {
  if (typeof name !== 'string' || !name.trim() || /[\x00-\x1f\x7f]/u.test(name)) fail(code);
  let count = 0;
  for (const _ of graphemes.segment(name.trim())) if (++count > 10) fail(code);
  return name.trim();
}

function viewerNameSettingsParameters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length ||
    Object.keys(value).some((key) => !['enabled', 'blockedWords'].includes(key)) ||
    (Object.hasOwn(value, 'enabled') && typeof value.enabled !== 'boolean')) fail();
  const patch = {};
  if (Object.hasOwn(value, 'enabled')) patch.enabled = value.enabled;
  if (Object.hasOwn(value, 'blockedWords')) patch.blockedWords = blockedWordsValue(value.blockedWords);
  return patch;
}

function blockedWordsValue(value, code = 'INVALID_VIEWER_NAME_SETTINGS') {
  if (!Array.isArray(value) || value.length > 200 || value.some((word) =>
    typeof word !== 'string' || !word.trim() || word.trim().length > 40 || /[\x00-\x1f\x7f]/u.test(word))) fail(code);
  return value.map((word) => word.trim());
}

function viewerNamesPageParameters(value) {
  fields(value, ['page']);
  if (!Number.isInteger(value.page) || value.page < 1 || value.page > 999999999) fail();
  return { page: value.page };
}

function viewerNameParameters(value) {
  fields(value, ['uid', 'name']);
  return { uid: viewerNameUid(value.uid), name: viewerNameValue(value.name) };
}

function sanitizeViewerNameSettings(value) {
  if (typeof value?.enabled !== 'boolean') fail('INVALID_RESPONSE');
  const settings = { ok: true, enabled: value.enabled };
  if (Object.hasOwn(value, 'blockedWords')) settings.blockedWords = blockedWordsValue(value.blockedWords, 'INVALID_RESPONSE');
  return settings;
}

function sanitizeViewerName(value) {
  return { ok: true, uid: viewerNameUid(value?.uid, 'INVALID_RESPONSE'), name: viewerNameValue(value?.name, 'INVALID_RESPONSE') };
}

function sanitizeViewerNames(value) {
  if (!value || !Array.isArray(value.items) || value.items.length > 20 || value.pageSize !== 20 ||
    !Number.isSafeInteger(value.total) || value.total < 0 || !Number.isSafeInteger(value.page) || value.page < 1 ||
    value.page > Math.max(1, Math.ceil(value.total / 20))) fail('INVALID_RESPONSE');
  const items = value.items.map((item) => {
    const { uid, name } = sanitizeViewerName(item);
    return { uid, name };
  });
  if (new Set(items.map((item) => item.uid)).size !== items.length) fail('INVALID_RESPONSE');
  return { ok: true, items, page: value.page, pageSize: 20, total: value.total };
}

module.exports = { viewerNameUid, viewerNameParameters, viewerNamesPageParameters, viewerNameSettingsParameters,
  sanitizeViewerName, sanitizeViewerNames, sanitizeViewerNameSettings };
