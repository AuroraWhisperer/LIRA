'use strict';

const PROFILE_FIELDS = Object.freeze(['name', 'avatarUrl']);

function createGameWinnerProfileResolver(options = {}) {
  const getHostIdentity =
    typeof options.getHostIdentity === 'function'
      ? options.getHostIdentity
      : () => null;
  const resolveRoomInfo =
    typeof options.resolveRoomInfo === 'function'
      ? options.resolveRoomInfo
      : async () => null;
  const ensureProfile =
    typeof options.ensureProfile === 'function'
      ? options.ensureProfile
      : async () => null;

  return async function resolveGameWinnerProfile(winner = {}) {
    const role = normalizeWinnerRole(winner && winner.role);
    if (!role) return emptyProfile();

    let identity = role === 'viewer' ? normalizeIdentity(winner) : null;
    try {
      if (role === 'host') identity = await resolveHostIdentity();
      if (!identity.uid) return { avatarUrl: '', name: identity.name };

      const profile = await ensureProfile(identity.uid, {
        fields: [...PROFILE_FIELDS],
      });
      return {
        avatarUrl: cleanText(profile && profile.avatarUrl),
        name: cleanText(profile && profile.name) || identity.name,
      };
    } catch (_) {
      return { avatarUrl: '', name: identity ? identity.name : '' };
    }
  };

  async function resolveHostIdentity() {
    const connectedIdentity = normalizeIdentity(getHostIdentity());
    if (connectedIdentity.uid) return connectedIdentity;
    const roomInfo = await resolveRoomInfo();
    return normalizeIdentity({
      uid: roomInfo && roomInfo.uid,
      name: roomInfo && roomInfo.ownerName,
    });
  }
}

function normalizeWinnerRole(value) {
  return value === 'viewer' || value === 'host' ? value : '';
}

function normalizeIdentity(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const uid = String(source.uid || '').trim();
  return {
    uid: /^\d{1,20}$/.test(uid) ? uid : '',
    name: cleanText(source.name).slice(0, 80),
  };
}

function cleanText(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

function emptyProfile() {
  return { avatarUrl: '', name: '' };
}

module.exports = {
  createGameWinnerProfileResolver,
  normalizeIdentity,
  normalizeWinnerRole,
};
