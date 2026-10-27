'use strict';

const SONG_REQUEST_CONTROL_DEFAULTS = Object.freeze({
  scSongRequestEnabled: 'true',
  songRequestCancelEnabled: 'true',
  userQueueLimit: '0',
  userCooldownCaptainSeconds: '',
  userCooldownAdmiralSeconds: '',
  userCooldownGovernorSeconds: '',
  songRequestMinMedalLevel: '0',
  songRequestGuardLevel: '0',
  songRequestGuardMedalBypass: 'false',
  songRequestUserBlacklist: '[]',
});
const SONG_REQUEST_CONTROL_KEYS = Object.freeze(Object.keys(SONG_REQUEST_CONTROL_DEFAULTS));
const IDENTITY_COOLDOWN_KEYS = Object.freeze([
  'userCooldownCaptainSeconds', 'userCooldownAdmiralSeconds', 'userCooldownGovernorSeconds',
]);

function normalizeSongRequestUserBlacklist(input) {
  if (!Array.isArray(input) || input.length > 200) return null;
  const uids = new Set();
  const entries = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((key) => !['uid', 'name', 'expiresAt'].includes(key))) return null;
    const { uid, name = '', expiresAt = 0 } = entry;
    if (typeof uid !== 'string' || !/^[1-9][0-9]{0,24}$/.test(uid) || uids.has(uid)
      || typeof name !== 'string' || [...name].length > 80
      || !Number.isSafeInteger(expiresAt) || expiresAt < 0 || expiresAt > 253402300799999) return null;
    uids.add(uid);
    entries.push({ uid, name: name.trim(), expiresAt });
  }
  return entries;
}

function normalizeSongRequestSettingValue(key, rawValue) {
  if (key === 'songRequestUserBlacklist') {
    let entries;
    try {
      entries = normalizeSongRequestUserBlacklist(typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue);
    } catch {
      return null;
    }
    return entries === null ? null : JSON.stringify(entries);
  }
  if (['scSongRequestEnabled', 'songRequestCancelEnabled', 'songRequestGuardMedalBypass'].includes(key)) {
    if ([true, 1, 'true', '1'].includes(rawValue)) return 'true';
    if ([false, 0, 'false', '0'].includes(rawValue)) return 'false';
    return null;
  }
  const identityCooldown = IDENTITY_COOLDOWN_KEYS.includes(key);
  if (identityCooldown && rawValue === '') return '';
  if (!['number', 'string'].includes(typeof rawValue)
    || (typeof rawValue === 'string' && !/^\s*[0-9]+\s*$/u.test(rawValue))) return null;
  const value = Number(rawValue);
  const max = identityCooldown ? 3600 : key === 'userQueueLimit' ? 300 : key === 'songRequestMinMedalLevel' ? 100 : 3;
  return Number.isInteger(value) && value >= 0 && value <= max ? String(value) : null;
}

function serializeSongRequestSettings(settings) {
  return Object.fromEntries(SONG_REQUEST_CONTROL_KEYS.map((key) => {
    const value = settings[key] ?? SONG_REQUEST_CONTROL_DEFAULTS[key];
    if (key === 'songRequestUserBlacklist') return [key, JSON.parse(value)];
    if (['scSongRequestEnabled', 'songRequestCancelEnabled', 'songRequestGuardMedalBypass'].includes(key)) return [key, value === 'true'];
    return [key, value === '' ? '' : Number(value)];
  }));
}

module.exports = {
  SONG_REQUEST_CONTROL_DEFAULTS,
  SONG_REQUEST_CONTROL_KEYS,
  IDENTITY_COOLDOWN_KEYS,
  normalizeSongRequestUserBlacklist,
  normalizeSongRequestSettingValue,
  serializeSongRequestSettings,
};
