'use strict';

const { normalizeGuardAccompany, newerGuardAccompany } = require('../shared/bilibili-guard-accompany');
const { dayOf, daysBetween } = require('./dates');

const DEFAULT_ACCOMPANY_MILESTONES = [100, 365, 500, 1000];

function accompanySettings(input = {}) {
  const milestones = input.accompanyMilestones ?? DEFAULT_ACCOMPANY_MILESTONES;
  if (!Array.isArray(milestones) || milestones.length > 10 ||
    milestones.some((day) => !Number.isSafeInteger(day) || day < 1 || day > 100000) ||
    (input.showAccompanyInCalendar !== undefined && typeof input.showAccompanyInCalendar !== 'boolean')) {
    throw new Error('陪伴纪念日须为 1–100000 的整数，最多 10 个；请选择是否在日历显示。');
  }
  return {
    accompanyMilestones: [...new Set(milestones)].sort((a, b) => a - b),
    showAccompanyInCalendar: input.showAccompanyInCalendar !== false,
  };
}

function getGuardAccompany(profile, now = Date.now()) {
  const value = normalizeGuardAccompany(profile.guardAccompany);
  if (!value) return null;
  const observedDate = dayOf(value.observedAt);
  // Outside the supported calendar range an observation remains display-only.
  const age = observedDate < '1900-01-01' || observedDate > '2200-12-31'
    ? Infinity : daysBetween(observedDate, dayOf(now));
  const roster = profile.guardRoster;
  const inactive = Boolean(roster && roster.observedAt >= value.observedAt &&
    (roster.roomId !== value.roomId || roster.level === null));
  return { ...value, stale: age > 7 || age < 0, inactive };
}

module.exports = { accompanySettings, getGuardAccompany, normalizeGuardAccompany, newerGuardAccompany };
