'use strict';

const HOUR_MS = 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 4_000;
const BATCH_REST_MS = 60_000;
const BATCH_REQUEST_LIMIT = 50;
const HOURLY_REQUEST_LIMIT = 600;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

function requiredText(value, field, maximum = 128) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\r\n\0]/u.test(normalized)
  ) {
    throw new TypeError(`${field} is invalid.`);
  }
  return normalized;
}

function normalizeMs(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${field} must be a non-negative millisecond value.`);
  }
  return normalized;
}

function parseTimes(value) {
  try {
    const result = JSON.parse(value);
    if (Array.isArray(result)) return result;
  } catch (_) {
    const error = new Error('Request budget contains invalid JSON.');
    error.code = 'LOTTERY_DATA_CORRUPT';
    throw error;
  }
  const error = new Error('Request budget contains invalid JSON.');
  error.code = 'LOTTERY_DATA_CORRUPT';
  throw error;
}

function tryRollback(db) {
  try {
    db.exec('ROLLBACK');
    return true;
  } catch (_) {
    return false;
  }
}

function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    tryRollback(db);
    throw error;
  }
}

function createRequestBudgetStore(db) {
  function scopeKeys(scope) {
    return ['local', `account:${requiredText(scope, 'budget scope')}`];
  }

  function ensureRow(scopeKey, nowMs) {
    db.prepare(
      `
      INSERT OR IGNORE INTO lottery_request_budget (scope_key, updated_at_ms)
      VALUES (?, ?)
    `,
    ).run(scopeKey, nowMs);
    return db
      .prepare('SELECT * FROM lottery_request_budget WHERE scope_key = ?')
      .get(scopeKey);
  }

  function normalizeRow(row, nowMs) {
    return {
      scopeKey: row.scope_key,
      times: parseTimes(row.request_times_json).filter(
        (value) => Number.isSafeInteger(value) && value > nowMs - HOUR_MS,
      ),
      consecutiveCount: Number(row.consecutive_count),
      lastFinishedAtMs: Number(row.last_finished_at_ms),
      earliestResumeAtMs: Number(row.earliest_resume_at_ms),
      holdReason: row.hold_reason,
      rateLimitStrikes: Number(row.rate_limit_strikes),
    };
  }

  function saveRow(row, nowMs) {
    db.prepare(
      `
      UPDATE lottery_request_budget
      SET request_times_json = ?, consecutive_count = ?,
          last_finished_at_ms = ?, earliest_resume_at_ms = ?,
          hold_reason = ?, rate_limit_strikes = ?, updated_at_ms = ?
      WHERE scope_key = ?
    `,
    ).run(
      JSON.stringify(row.times),
      row.consecutiveCount,
      row.lastFinishedAtMs,
      row.earliestResumeAtMs,
      row.holdReason,
      row.rateLimitStrikes,
      nowMs,
      row.scopeKey,
    );
  }

  function evaluate(row, nowMs) {
    if (row.holdReason && row.earliestResumeAtMs === 0) {
      return { reason: row.holdReason, waitUntilMs: null };
    }
    let waitUntilMs = 0;
    if (row.earliestResumeAtMs > nowMs) {
      waitUntilMs = row.earliestResumeAtMs;
    } else if (row.earliestResumeAtMs > 0) {
      row.earliestResumeAtMs = 0;
      row.holdReason = '';
    }
    if (row.times.length >= HOURLY_REQUEST_LIMIT) {
      waitUntilMs = Math.max(waitUntilMs, row.times[0] + HOUR_MS);
    }
    if (row.consecutiveCount >= BATCH_REQUEST_LIMIT) {
      const restUntil = row.lastFinishedAtMs + BATCH_REST_MS;
      if (restUntil > nowMs) waitUntilMs = Math.max(waitUntilMs, restUntil);
      else row.consecutiveCount = 0;
    }
    if (row.lastFinishedAtMs > 0) {
      waitUntilMs = Math.max(
        waitUntilMs,
        row.lastFinishedAtMs + MIN_REQUEST_INTERVAL_MS,
      );
    }
    return { reason: '', waitUntilMs: waitUntilMs > nowMs ? waitUntilMs : 0 };
  }

  function reserve({ scope, kind, nowMs: rawNowMs }) {
    requiredText(kind, 'request kind');
    const nowMs = normalizeMs(rawNowMs, 'request reservation time');
    return transaction(db, () => {
      const rows = scopeKeys(scope).map((key) =>
        normalizeRow(ensureRow(key, nowMs), nowMs),
      );
      const decisions = rows.map((row) => evaluate(row, nowMs));
      for (const row of rows) saveRow(row, nowMs);
      const manual = decisions.find((decision) => decision.reason);
      if (manual) {
        return {
          allowed: false,
          waitUntilMs: null,
          holdReason: manual.reason,
          requestCount: rows[1].times.length,
        };
      }
      const waitUntilMs = Math.max(
        0,
        ...decisions.map((decision) => decision.waitUntilMs || 0),
      );
      if (waitUntilMs > nowMs) {
        return {
          allowed: false,
          waitUntilMs,
          holdReason: '',
          requestCount: rows[1].times.length,
        };
      }
      for (const row of rows) {
        row.times.push(nowMs);
        row.consecutiveCount += 1;
        saveRow(row, nowMs);
      }
      return {
        allowed: true,
        waitUntilMs: 0,
        holdReason: '',
        requestCount: rows[1].times.length,
      };
    });
  }

  function finish({
    scope,
    finishedAtMs: rawFinishedAtMs,
    status,
    retryAfterMs,
  }) {
    const finishedAtMs = normalizeMs(rawFinishedAtMs, 'request finish time');
    const statusCode = Number(status) || 0;
    transaction(db, () => {
      const rows = scopeKeys(scope).map((key) =>
        normalizeRow(ensureRow(key, finishedAtMs), finishedAtMs),
      );
      for (const row of rows) {
        row.lastFinishedAtMs = finishedAtMs;
        if (statusCode === 429) {
          if (row.rateLimitStrikes >= 1) {
            row.holdReason = 'RATE_LIMIT_REPEATED';
            row.earliestResumeAtMs = 0;
            row.rateLimitStrikes += 1;
          } else {
            const cooldown = Math.max(
              DEFAULT_RATE_LIMIT_COOLDOWN_MS,
              Number(retryAfterMs) || 0,
            );
            row.holdReason = 'RATE_LIMIT_COOLDOWN';
            row.earliestResumeAtMs = finishedAtMs + cooldown;
            row.rateLimitStrikes = 1;
          }
        } else if (
          [403, 412].includes(statusCode) &&
          row.scopeKey !== 'local'
        ) {
          row.holdReason = 'VERIFICATION_REQUIRED';
          row.earliestResumeAtMs = 0;
        } else if (statusCode >= 200 && statusCode < 400) {
          if (row.holdReason.startsWith('RATE_LIMIT_')) row.holdReason = '';
          row.earliestResumeAtMs = 0;
          row.rateLimitStrikes = 0;
        }
        saveRow(row, finishedAtMs);
      }
    });
  }

  function setHold({ scope, reason, nowMs: rawNowMs, untilMs = 0 }) {
    const nowMs = normalizeMs(rawNowMs, 'budget hold time');
    const resumeAtMs = normalizeMs(untilMs, 'budget resume time');
    const holdReason = requiredText(reason, 'budget hold reason');
    transaction(db, () => {
      const scopeKey =
        scope === '*'
          ? 'local'
          : `account:${requiredText(scope, 'budget scope')}`;
      const row = normalizeRow(ensureRow(scopeKey, nowMs), nowMs);
      row.holdReason = holdReason;
      row.earliestResumeAtMs = resumeAtMs;
      saveRow(row, nowMs);
    });
  }

  function clearHold({ scope, nowMs: rawNowMs, respectCooldown = false }) {
    const nowMs = normalizeMs(rawNowMs, 'budget hold time');
    transaction(db, () => {
      const scopeKey =
        scope === '*'
          ? 'local'
          : `account:${requiredText(scope, 'budget scope')}`;
      const row = normalizeRow(ensureRow(scopeKey, nowMs), nowMs);
      if (respectCooldown && row.earliestResumeAtMs > nowMs) {
        throw Object.assign(new Error('LOTTERY_COOLING_DOWN'), {
          code: 'LOTTERY_COOLING_DOWN',
        });
      }
      row.holdReason = '';
      row.earliestResumeAtMs = 0;
      row.rateLimitStrikes = 0;
      saveRow(row, nowMs);
    });
  }

  function get({ scope, nowMs: rawNowMs }) {
    const nowMs = normalizeMs(rawNowMs, 'budget read time');
    const rows = scopeKeys(scope).map((key) =>
      normalizeRow(ensureRow(key, nowMs), nowMs),
    );
    const decisions = rows.map((row) => evaluate(row, nowMs));
    const manual = decisions.find((decision) => decision.reason);
    return {
      requestCount: rows[1].times.length,
      consecutiveCount: rows[1].consecutiveCount,
      holdReason:
        manual?.reason || rows.find((row) => row.holdReason)?.holdReason || '',
      waitUntilMs: Math.max(
        0,
        ...decisions.map((decision) => decision.waitUntilMs || 0),
      ),
    };
  }

  return { reserve, finish, setHold, clearHold, get };
}

module.exports = { createRequestBudgetStore };
