'use strict';

const { dayOf, dayStart, addDays, daysBetween, anniversaryDate } = require('./dates');
const { summarizeMembership } = require('./membership');

function buildReminders(profile, records, states, now = Date.now()) {
  if (profile.archived) return [];
  const today = dayOf(now);
  const earliest = addDays(today, -7);
  const latest = addDays(today, 366);
  const year = Number(today.slice(0, 4));
  const handled = new Map(states.map((state) => [state.key, state]));
  const result = [];
  const membership = summarizeMembership(records, now);

  function add(key, date, title, basis, advance = 0, extra = {}) {
    if (!date || date < earliest || date > latest) return;
    const state = handled.get(key);
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
        extra.metric &&
        (membership[`${extra.metric}Days`] ?? -1) < extra.threshold &&
        ['handled', 'ignored'].includes(state?.status),
      ),
      group: ['handled', 'ignored'].includes(state?.status)
        ? 'history'
        : date < today
          ? 'missed'
          : date === today
            ? 'today'
            : daysBetween(today, date) <= 7
              ? 'week'
              : 'later',
      actionable: !['handled', 'ignored'].includes(state?.status) && !snoozed && scheduled <= today,
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
    if (membership.hasHistory && profile.milestoneReminders !== false) addMilestones();
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
    const previous = summarizeMembership(records, addDays(earliest, -1));
    const seen = new Set();
    let last = previous;
    for (let date = earliest; date <= latest; date = addDays(date, 1)) {
      const current = summarizeMembership(records, date === today ? now : dayStart(date) + 86400000 - 1);
      for (const type of ['total', 'continuous']) {
        const value = current[`${type}Days`];
        const prior = last[`${type}Days`];
        for (const threshold of [30, 100, 365]) {
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
      last = current;
    }
  }

  for (const state of states) {
    if (!['handled', 'ignored'].includes(state.status) || result.some((r) => r.key === state.key)) continue;
    const match = /^(total|continuous):.*?(\d+)$/.exec(state.key);
    const revised = match && (membership[`${match[1]}Days`] ?? -1) < Number(match[2]);
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
