'use strict';

const { dayOf, addDays, daysBetween, anniversaryDate } = require('./dates');
const { prepareMembership } = require('./membership');
const { MEMBERSHIP_MILESTONES } = require('./membership-milestones');
const { accompanySettings, getGuardAccompany } = require('./guard-accompany');

function buildReminders(profile, records, states, now = Date.now(), settings = {}, options = {}) {
  if (profile.archived) return [];
  const today = dayOf(now);
  const earliest = addDays(today, -7);
  const horizon = addDays(today, 366);
  const latest = addDays(today, options.daysAhead ?? 366);
  const year = Number(today.slice(0, 4));
  const statesByKey = new Map(states.map((state) => [state.key, state]));
  const result = [];
  const summarize = options.summarize || prepareMembership(records);
  const membership = options.membership || summarize(now);
  const accompany = getGuardAccompany(profile, now);
  const metricDays = (metric) => metric === 'accompany' ? accompany?.days : membership[`${metric}Days`];

  function add(key, date, title, basis, advance = 0, extra = {}) {
    const state = statesByKey.get(key);
    const isResolved = ['handled', 'ignored'].includes(state?.status);
    if (!date || date < earliest || date > horizon || (date > latest && !isResolved)) return;
    const scheduled = addDays(date, -advance);
    const snoozed = state?.status === 'snoozed' && state.until > today;
    result.push({
      key,
      profileId: profile.id,
      name: profile.alias || profile.platformName || '未命名档案',
      date,
      scheduled,
      title,
      basis,
      status: state?.status || 'pending',
      ...extra,
      handledAt: state?.handledAt,
      until: state?.until,
      revisedBelowThreshold: Boolean(
        extra.metric && (metricDays(extra.metric) ?? -1) < extra.threshold && isResolved,
      ),
      group: isResolved
        ? 'history'
        : date < today
          ? 'missed'
          : date === today
            ? 'today'
            : daysBetween(today, date) <= 7
              ? 'week'
              : 'later',
      actionable: !isResolved && !snoozed && scheduled <= today,
    });
  }

  const birthday = profile.birthday;
  if (birthday?.monthDay) {
    if (birthday.calendar === 'solar') {
      for (const y of [year - 1, year, year + 1])
        add(
          `birthday:${y}`,
          anniversaryDate(birthday.monthDay, y, birthday.leapDay),
          '生日',
          '公历生日',
          birthday.advance ? 7 : 0,
        );
    } else if (birthday.thisYearDate) {
      add(
        `birthday:${birthday.thisYearDate.slice(0, 4)}`,
        birthday.thisYearDate,
        '生日',
        '农历生日 · 本年手动对应日期',
        birthday.advance ? 7 : 0,
      );
    }
  }

  for (const record of records.filter((r) => !r.data.archived)) {
    if (record.kind === 'anniversary') {
      const data = record.data;
      if (data.annual) {
        for (const y of [year - 1, year, year + 1]) {
          if (y < Number(data.date.slice(0, 4))) continue;
          add(
            `anniversary:${record.id}:${y}`,
            anniversaryDate(data.date.slice(5), y),
            data.name,
            '手动纪念日',
            data.advanceDays,
          );
        }
      } else add(`anniversary:${record.id}`, data.date, data.name, '手动纪念日', data.advanceDays);
    }
    if (['followup', 'caution'].includes(record.kind) && record.data.reviewDate && !record.data.completed) {
      add(
        `followup:${record.id}`,
        record.data.reviewDate,
        record.kind === 'caution' ? '相处提醒待复查' : '约定待跟进',
        '手动设置',
      );
    }
  }
  if (membership.firstDate) {
    for (const y of [year - 1, year, year + 1]) {
      const count = y - Number(membership.firstDate.slice(0, 4));
      if (count > 0)
        add(
          `first-anniversary:${y}`,
          anniversaryDate(membership.firstDate.slice(5), y),
          `首次上舰 ${count} 周年`,
          '已确认首次上舰日期',
        );
    }
  }
  if (membership.status !== 'pending') {
    if (profile.expiryReminders && membership.expiry)
      add(
        `expiry:${membership.expiry.recordId}`,
        membership.expiry.date,
        '已确认会员有效期结束',
        membership.expiry.source === 'platform' ? '平台确认' : '手动确认',
        7,
      );
    if ((membership.totalDays !== null || membership.continuousDays !== null) && profile.milestoneReminders !== false)
      addMilestones();
  }

  if (accompany && !accompany.stale && !accompany.inactive && profile.milestoneReminders !== false) {
    const observedDate = dayOf(accompany.observedAt);
    for (const threshold of accompanySettings(settings).accompanyMilestones) {
      // A snapshot establishes only that day's count, never an unknown past achievement date.
      if (threshold < accompany.days) continue;
      const date = addDays(observedDate, threshold - accompany.days);
      add(`accompany:${accompany.roomId}:${threshold}`, date, `陪伴满 ${threshold} 天`,
        `B 站陪伴天数 · ${observedDate} 同步${threshold > accompany.days ? ' · 按持续陪伴估算' : ''}`, 3,
        { predicted: threshold > accompany.days, threshold, metric: 'accompany' });
    }
  }

  function addMilestones() {
    const baselineDates = {};
    for (const type of ['total', 'continuous']) {
      baselineDates[type] = new Set(
        records
          .filter(
            (r) =>
              r.kind === 'membership' &&
              r.data.type === 'baseline' &&
              r.data.decision === 'adopted' &&
              r.data[`${type}Days`] !== null,
          )
          .map((r) => r.data.asOf),
      );
    }
    const seen = new Set();
    // A revised baseline can move a handled milestone outside the short window.
    // Re-resolve those saved dates when the shared result includes history.
    const hasMilestoneHistory = states.some(state =>
      /^(total|continuous):/.test(state.key) && ['handled', 'ignored'].includes(state.status));
    const summaries = new Map([[today, membership]]);
    function at(date) {
      if (!summaries.has(date)) summaries.set(date, summarize(date));
      return summaries.get(date);
    }
    for (const date of summarize.milestoneDates(earliest, hasMilestoneHistory ? horizon : latest, now)) {
      const current = at(date);
      const previous = at(addDays(date, -1));
      for (const type of ['total', 'continuous']) {
        const value = current[`${type}Days`];
        const prior = previous[`${type}Days`];
        for (const threshold of MEMBERSHIP_MILESTONES) {
          // A newly entered baseline establishes today's count, not the dates
          // when smaller milestones were reached in the unknown past.
          if (value > threshold && baselineDates[type].has(date)) continue;
          if (value === null || value < threshold || (prior !== null && prior >= threshold)) continue;
          if (type === 'continuous' && current.continuousAsOf !== date) continue;
          const key = type === 'total' ? `total:${threshold}` : `continuous:${current.cycleId}:${threshold}`;
          if (seen.has(key)) continue;
          seen.add(key);
          add(
            key,
            date,
            `${type === 'total' ? '累计' : '连续'}在舰满 ${threshold} 天`,
            `${current.totalBasis}${current.datePrecision ? ' · 按日期补录' : ''}`,
            0,
            { predicted: date > today, threshold, metric: type },
          );
        }
      }
    }
  }

  for (const state of states) {
    if (!['handled', 'ignored'].includes(state.status) || result.some((r) => r.key === state.key)) continue;
    const match = /^(total|continuous|accompany):.*?(\d+)$/.exec(state.key);
    const revised = match && (metricDays(match[1]) ?? -1) < Number(match[2]);
    result.push({
      ...state,
      profileId: profile.id,
      name: profile.alias || profile.platformName,
      title: state.title || '已处理提醒',
      group: 'history',
      actionable: false,
      revisedBelowThreshold: Boolean(revised),
    });
  }
  return result.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.key.localeCompare(b.key));
}

module.exports = { buildReminders };
