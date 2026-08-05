// 编写人：Aurora
// 签到持久化：按 Bilibili uid 记录累计签到天数与最近签到日期。
'use strict';

const { cleanText, now } = require('../shared/utils');

function createCheckinStore(db) {
  return {
    checkIn(input = {}) {
      const uid = cleanText(input.uid);
      if (!uid || uid === '0') throw new Error('签到需要有效 uid。');

      const userName = cleanText(input.userName) || '观众';
      const dateKey = cleanText(input.dateKey);
      const atIso = cleanText(input.atIso) || now();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('签到日期格式无效。');

      db.exec('BEGIN');
      try {
        const row = db.prepare(`
          SELECT uid, user_name, total_days, first_checkin_at, last_checkin_at, last_checkin_date
          FROM checkin_users
          WHERE uid = ?
        `).get(uid);

        if (!row) {
          db.prepare(`
            INSERT INTO checkin_users (
              uid, user_name, total_days, first_checkin_at,
              last_checkin_at, last_checkin_date, updated_at
            ) VALUES (?, ?, 1, ?, ?, ?, ?)
          `).run(uid, userName, atIso, atIso, dateKey, atIso);
          db.exec('COMMIT');
          return formatCheckinRecord({
            uid, user_name: userName, total_days: 1,
            first_checkin_at: atIso, last_checkin_at: atIso, last_checkin_date: dateKey
          }, false);
        }

        const alreadyCheckedToday = row.last_checkin_date === dateKey;
        const totalDays = Math.max(0, Number(row.total_days) || 0) + (alreadyCheckedToday ? 0 : 1);
        db.prepare(`
          UPDATE checkin_users
          SET user_name = ?,
              total_days = ?,
              last_checkin_at = CASE WHEN ? = 1 THEN last_checkin_at ELSE ? END,
              last_checkin_date = CASE WHEN ? = 1 THEN last_checkin_date ELSE ? END,
              updated_at = ?
          WHERE uid = ?
        `).run(
          userName,
          totalDays,
          alreadyCheckedToday ? 1 : 0,
          atIso,
          alreadyCheckedToday ? 1 : 0,
          dateKey,
          atIso,
          uid
        );
        db.exec('COMMIT');
        return formatCheckinRecord({
          ...row,
          user_name: userName,
          total_days: totalDays,
          last_checkin_at: alreadyCheckedToday ? row.last_checkin_at : atIso,
          last_checkin_date: alreadyCheckedToday ? row.last_checkin_date : dateKey
        }, alreadyCheckedToday);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    clear() {
      const result = db.prepare('DELETE FROM checkin_users').run();
      return Number(result.changes) || 0;
    }
  };
}

function formatCheckinRecord(row, alreadyCheckedToday) {
  return {
    uid: cleanText(row.uid),
    userName: cleanText(row.user_name) || '观众',
    totalDays: Math.max(0, Number(row.total_days) || 0),
    firstCheckinAt: cleanText(row.first_checkin_at),
    lastCheckinAt: cleanText(row.last_checkin_at),
    lastCheckinDate: cleanText(row.last_checkin_date),
    alreadyCheckedToday: Boolean(alreadyCheckedToday)
  };
}

module.exports = { createCheckinStore };
