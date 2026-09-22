'use strict';

const { CHECKIN_BLESSINGS, FORTUNES } = require('../shared/bot-defaults');

function createDailyBotLegacyReader(db, settingsStore) {
  function libraries() {
    const settings = settingsStore.getSettings();
    const parse = (value, defaults) => {
      if (value === undefined || value === null || value === '') return defaults;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };
    return {
      blessings: parse(settings.checkinBlessings, CHECKIN_BLESSINGS),
      fortunes: parse(settings.fortunePool, FORTUNES),
    };
  }
  return {
    summary() {
      const row = db
        .prepare(
          `SELECT count(*) AS count,min(total_days) AS minDays,
        max(total_days) AS maxDays,max(last_checkin_date) AS lastDate FROM checkin_users`,
        )
        .get();
      const saved = libraries();
      return {
        ...row,
        customLibraries:
          JSON.stringify(saved.blessings) !== JSON.stringify(CHECKIN_BLESSINGS) ||
          JSON.stringify(saved.fortunes) !== JSON.stringify(FORTUNES),
      };
    },
    read() {
      db.exec('BEGIN');
      try {
        const count = db.prepare('SELECT count(*) AS count FROM checkin_users').get().count;
        if (count > 50000) throw new Error('DAILY_BOT_IMPORT_TOO_LARGE');
        const checkins = db
          .prepare(
            `SELECT uid,user_name AS userName,total_days AS totalDays,
          first_checkin_at AS firstCheckinAt,last_checkin_at AS lastCheckinAt,last_checkin_date AS lastCheckinDate
          FROM checkin_users ORDER BY uid COLLATE BINARY`,
          )
          .all()
          .map((row) => ({ ...row }));
        const result = { checkins, ...libraries() };
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
module.exports = { createDailyBotLegacyReader };
