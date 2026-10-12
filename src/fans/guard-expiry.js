'use strict';

const { dayOf } = require('./dates');

function projectGuardExpiry(snapshot, profiles, roomId, now = Date.now()) {
  const empty = (state) => ({ state, observedAt: null, badges: [] });
  if (!snapshot || !['ready', 'loginRequired', 'ownerMismatch', 'roomNotConfigured', 'sourceChanged', 'unavailable'].includes(snapshot.state))
    return empty('unavailable');
  if (snapshot.state !== 'ready') return empty(snapshot.state);
  if (snapshot.roomId !== roomId) return empty('sourceChanged');
  const observed = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observed) || now < observed || now - observed >= 300000 || dayOf(now) !== dayOf(observed) ||
      !Array.isArray(snapshot.expiring) || !Array.isArray(snapshot.expired)) return empty('unavailable');
  const warnings = new Map();
  const conflicts = new Set(snapshot.expired.map((item) => item.uid));
  for (const item of snapshot.expiring) {
    if (warnings.has(item.uid)) conflicts.add(item.uid);
    warnings.set(item.uid, item);
  }
  const badges = [];
  for (const profile of profiles) {
    const identity = profile.identity;
    if (profile.archived || identity?.platform !== 'bilibili' || identity?.type !== 'uid') continue;
    const warning = warnings.get(identity.value);
    if (!warning || conflicts.has(identity.value) || !/^[1-9]\d{0,19}$/.test(identity.value) ||
        ![1, 2, 3].includes(warning.guardLevel) || warning.guardLevel !== profile.currentGuardLevel ||
        (profile.guardRoster && profile.guardRoster.roomId !== roomId &&
          (!snapshot.account?.uid || profile.guardRoster.ownerUid !== snapshot.account.uid)) ||
        !Number.isInteger(warning.days) || warning.days < 0 || warning.days > 3) continue;
    badges.push({ profileId: profile.id, level: warning.guardLevel, days: warning.days });
  }
  return { state: 'ready', observedAt: snapshot.observedAt, badges };
}

module.exports = { projectGuardExpiry };
