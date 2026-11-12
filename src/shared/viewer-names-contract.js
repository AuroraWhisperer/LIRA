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
  fields(value, ['enabled']);
  if (typeof value.enabled !== 'boolean') fail();
  return { enabled: value.enabled };
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
  return { ok: true, enabled: value.enabled };
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
