'use strict';

const { createRequestBudgetStore } = require('./dynamic-lottery-budget-store');

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredText(value, field, maximum = 512) {
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

function json(value, field) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    throw new TypeError(`${field} must be JSON serializable.`);
  }
}

function parseJson(value, field) {
  try {
    return JSON.parse(value);
  } catch (_) {
    throw storeError('LOTTERY_DATA_CORRUPT', `${field} contains invalid JSON.`);
  }
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

function toTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    streamerId: row.streamer_id,
    ownerUid: row.owner_uid,
    dynamicId: row.dynamic_id,
    target: parseJson(row.target_json, 'task target'),
    rules: parseJson(row.rules_json, 'task rules'),
    status: row.status,
    revision: Number(row.revision),
    requestId: row.request_id,
    activeScanId: row.active_scan_id || null,
    previousTaskId: row.previous_task_id || null,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function toScan(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    sessionEpoch: Number(row.session_epoch),
    status: row.status,
    sources: parseJson(row.source_state_json, 'scan source state'),
    readCount: Number(row.read_count),
    pauseReason: row.pause_reason,
    startedAtMs: Number(row.started_at_ms),
    completedAtMs:
      row.completed_at_ms === null ? null : Number(row.completed_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function normalizeEvidence(record, source) {
  if (!record || typeof record !== 'object' || record.source !== source) {
    throw new TypeError('Evidence source does not match the committed page.');
  }
  const recordId = requiredText(record.recordId, 'evidence record ID', 64);
  const uid = requiredText(record.uid, 'evidence UID', 64);
  if (!/^\d+$/u.test(recordId) || !/^\d+$/u.test(uid)) {
    throw new TypeError('Evidence IDs must be decimal strings.');
  }
  const occurredAtMs =
    record.occurredAtMs === null
      ? null
      : normalizeMs(record.occurredAtMs, 'evidence time');
  const text = record.text === null ? null : String(record.text);
  if (text !== null && text.length > 1024 * 1024) {
    throw new TypeError('Evidence text is too large.');
  }
  const parentId =
    record.parentId === null
      ? null
      : requiredText(record.parentId, 'evidence parent ID', 64);
  const level =
    record.level === null
      ? null
      : normalizeMs(record.level, 'evidence user level');
  return { source, recordId, uid, occurredAtMs, text, parentId, level };
}

function normalizePage(page, source) {
  if (
    !page ||
    !Array.isArray(page.records) ||
    typeof page.ended !== 'boolean'
  ) {
    throw new TypeError('Collection page is invalid.');
  }
  const nextCursor = page.nextCursor === null ? null : String(page.nextCursor);
  if ((page.ended && nextCursor !== null) || (!page.ended && !nextCursor)) {
    throw new TypeError('Collection page cursor does not match its end state.');
  }
  return {
    records: page.records.map((record) => normalizeEvidence(record, source)),
    nextCursor,
    ended: page.ended,
  };
}

function createDynamicLotteryStore(lotteryDb) {
  if (!lotteryDb || typeof lotteryDb.prepare !== 'function') {
    throw new TypeError('A migrated lottery database is required.');
  }

  function getTask(taskId) {
    return toTask(
      lotteryDb
        .prepare('SELECT * FROM lottery_tasks WHERE id = ?')
        .get(requiredText(taskId, 'task ID')),
    );
  }

  function createTask(input) {
    const id = requiredText(input?.id, 'task ID');
    const streamerId = requiredText(input?.streamerId, 'streamer ID', 128);
    const ownerUid = requiredText(input?.ownerUid, 'owner UID', 64);
    const dynamicId = requiredText(input?.dynamicId, 'dynamic ID', 64);
    const requestId = requiredText(input?.requestId, 'request ID');
    const nowMs = normalizeMs(input?.nowMs, 'task creation time');
    lotteryDb
      .prepare(
        `
        INSERT INTO lottery_tasks (
          id, streamer_id, owner_uid, dynamic_id, target_json, rules_json,
          status, revision, request_id, previous_task_id,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        streamerId,
        ownerUid,
        dynamicId,
        json(input.target, 'task target'),
        json(input.rules, 'task rules'),
        input.status || 'draft',
        requestId,
        input.previousTaskId || null,
        nowMs,
        nowMs,
      );
    return getTask(id);
  }

  function getScan(scanId) {
    return toScan(
      lotteryDb
        .prepare('SELECT * FROM lottery_scans WHERE id = ?')
        .get(requiredText(scanId, 'scan ID')),
    );
  }

  function getActiveScan(taskId) {
    const task = getTask(taskId);
    return task?.activeScanId ? getScan(task.activeScanId) : null;
  }

  function beginScan(input) {
    const id = requiredText(input?.id, 'scan ID');
    const taskId = requiredText(input?.taskId, 'task ID');
    const sessionEpoch = normalizeMs(input?.sessionEpoch, 'session epoch');
    const startedAtMs = normalizeMs(input?.startedAtMs, 'scan start time');
    const sources = [...new Set(input?.sources || [])];
    if (
      sources.length === 0 ||
      sources.some((source) => !['comment', 'repost', 'like'].includes(source))
    ) {
      throw new TypeError(
        'At least one supported collection source is required.',
      );
    }
    const sourceState = Object.fromEntries(
      sources.map((source) => [
        source,
        { cursor: null, coverage: 'unknown', readCount: 0 },
      ]),
    );

    transaction(lotteryDb, () => {
      if (!getTask(taskId)) {
        throw storeError('LOTTERY_TASK_NOT_FOUND', 'Task not found.');
      }
      lotteryDb
        .prepare(
          `
          INSERT INTO lottery_scans (
            id, task_id, session_epoch, status, source_state_json,
            started_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, 'running', ?, ?, ?)
        `,
        )
        .run(
          id,
          taskId,
          sessionEpoch,
          json(sourceState, 'scan sources'),
          startedAtMs,
          startedAtMs,
        );
      lotteryDb
        .prepare(
          `
          UPDATE lottery_tasks
          SET status = 'collecting', active_scan_id = ?, revision = revision + 1,
              updated_at_ms = ?
          WHERE id = ?
        `,
        )
        .run(id, startedAtMs, taskId);
    });
    return getScan(id);
  }

  function applyPage(input) {
    const taskId = requiredText(input?.taskId, 'task ID');
    const scanId = requiredText(input?.scanId, 'scan ID');
    const source = requiredText(input?.source, 'collection source', 32);
    const expectedCursor =
      input.expectedCursor === null ? null : String(input.expectedCursor);
    const sessionEpoch = normalizeMs(input?.sessionEpoch, 'session epoch');
    const committedAtMs = normalizeMs(input?.committedAtMs, 'page commit time');
    const page = normalizePage(input?.page, source);

    const scan = getScan(scanId);
    if (!scan || scan.taskId !== taskId) {
      throw storeError('LOTTERY_SCAN_NOT_FOUND', 'Scan not found for task.');
    }
    if (scan.status !== 'running') {
      throw storeError('LOTTERY_SCAN_NOT_RUNNING', 'Scan is not running.');
    }
    if (scan.sessionEpoch !== sessionEpoch) {
      throw storeError('LOTTERY_STALE_SESSION', 'Scan session changed.');
    }
    const state = scan.sources[source];
    if (!state) {
      throw storeError(
        'LOTTERY_SOURCE_MISMATCH',
        'Source is not part of scan.',
      );
    }
    if ((state.cursor ?? null) !== expectedCursor) {
      throw storeError('LOTTERY_CURSOR_CONFLICT', 'Scan cursor changed.');
    }
    if (
      state.coverage === 'exhausted' ||
      (page.nextCursor !== null &&
        (state.seenCursors || []).includes(page.nextCursor))
    ) {
      throw storeError(
        'LOTTERY_CURSOR_CONFLICT',
        'Repeated or completed pagination.',
      );
    }
    if (
      scan.readCount + page.records.length > 100_000 ||
      (state.seenCursors || []).length >= 10_000
    ) {
      throw storeError(
        'LOTTERY_COLLECTION_LIMIT',
        'Collection exceeds the supported size; no partial draw is allowed.',
      );
    }

    const insert = lotteryDb.prepare(
      `
        INSERT OR IGNORE INTO lottery_evidence (
          scan_id, source, record_id, uid, occurred_at_ms, text,
          parent_id, level, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    for (const record of page.records) {
      insert.run(
        scanId,
        record.source,
        record.recordId,
        record.uid,
        record.occurredAtMs,
        record.text,
        record.parentId,
        record.level,
        committedAtMs,
      );
    }

    const nextSources = structuredClone(scan.sources);
    nextSources[source] = {
      cursor: page.nextCursor,
      coverage: page.ended ? 'exhausted' : 'unknown',
      readCount: Number(state.readCount || 0) + page.records.length,
      seenCursors: [
        ...(state.seenCursors || []),
        ...(expectedCursor === null ? [] : [expectedCursor]),
      ],
    };
    const completed = Object.values(nextSources).every(
      (entry) => entry.coverage === 'exhausted',
    );
    if (completed) {
      const task = getTask(taskId);
      for (const requiredSource of task.rules.requiredActions || []) {
        const expected = task.target.expectedReactions?.[requiredSource];
        const count = lotteryDb
          .prepare(
            'SELECT COUNT(*) AS count FROM lottery_evidence WHERE scan_id = ? AND source = ?',
          )
          .get(scanId, requiredSource).count;
        if (Number.isSafeInteger(expected) && count < expected) {
          throw storeError(
            'LOTTERY_REACTION_INCOMPLETE',
            'Reaction membership is smaller than the content count; no partial draw is allowed.',
          );
        }
      }
    }
    lotteryDb
      .prepare(
        `
          UPDATE lottery_scans
          SET source_state_json = ?, read_count = read_count + ?,
              status = ?, completed_at_ms = ?, updated_at_ms = ?
          WHERE id = ?
        `,
      )
      .run(
        json(nextSources, 'scan sources'),
        page.records.length,
        completed ? 'completed' : 'running',
        completed ? committedAtMs : null,
        committedAtMs,
        scanId,
      );
    lotteryDb
      .prepare(
        `
          UPDATE lottery_tasks
          SET status = ?, revision = revision + 1, updated_at_ms = ?
          WHERE id = ?
        `,
      )
      .run(completed ? 'ready' : 'collecting', committedAtMs, taskId);
    return getScan(scanId);
  }

  function commitPage(input) {
    return transaction(lotteryDb, () => applyPage(input));
  }

  function commitPages(inputs) {
    return transaction(lotteryDb, () => inputs.map(applyPage).at(-1));
  }

  function setScanStatus(taskId, status, reason, nowMs, sessionEpoch) {
    const normalizedTaskId = requiredText(taskId, 'task ID');
    const timestamp = normalizeMs(nowMs, 'scan status time');
    transaction(lotteryDb, () => {
      const task = getTask(normalizedTaskId);
      const scan = task?.activeScanId ? getScan(task.activeScanId) : null;
      if (!task || !scan) {
        throw storeError('LOTTERY_SCAN_NOT_FOUND', 'Active scan not found.');
      }
      if (scan.status === 'completed') return;
      const nextReason = reason || '';
      const nextSessionEpoch =
        sessionEpoch === undefined ? scan.sessionEpoch : sessionEpoch;
      if (
        scan.status === status &&
        scan.pauseReason === nextReason &&
        scan.sessionEpoch === nextSessionEpoch
      ) {
        return;
      }
      lotteryDb
        .prepare(
          `
          UPDATE lottery_scans
          SET status = ?, pause_reason = ?, session_epoch = ?, updated_at_ms = ?
          WHERE id = ?
        `,
        )
        .run(status, nextReason, nextSessionEpoch, timestamp, scan.id);
      lotteryDb
        .prepare(
          `
          UPDATE lottery_tasks
          SET status = ?, revision = revision + 1, updated_at_ms = ?
          WHERE id = ?
        `,
        )
        .run(status === 'running' ? 'collecting' : status, timestamp, task.id);
    });
    return getTask(normalizedTaskId);
  }

  const requestBudget = createRequestBudgetStore(lotteryDb);
  return {
    createTask,
    getTask,
    beginScan,
    getScan,
    getActiveScan,
    commitPage,
    commitPages,
    listTasks(streamerId) {
      return lotteryDb
        .prepare(
          'SELECT * FROM lottery_tasks WHERE streamer_id = ? ORDER BY created_at_ms DESC, id DESC LIMIT 50',
        )
        .all(requiredText(streamerId, 'streamer ID'))
        .map(toTask);
    },
    findTaskByRequest(streamerId, requestId) {
      return toTask(
        lotteryDb
          .prepare(
            'SELECT * FROM lottery_tasks WHERE streamer_id = ? AND request_id = ?',
          )
          .get(
            requiredText(streamerId, 'streamer ID'),
            requiredText(requestId, 'request ID'),
          ),
      );
    },
    recoverInterrupted(nowMs) {
      transaction(lotteryDb, () => {
        lotteryDb
          .prepare(
            "UPDATE lottery_scans SET status = 'paused', pause_reason = 'LOTTERY_INTERRUPTED', updated_at_ms = ? WHERE status = 'running'",
          )
          .run(nowMs);
        lotteryDb
          .prepare(
            "UPDATE lottery_tasks SET status = 'paused', revision = revision + 1, updated_at_ms = ? WHERE status = 'collecting'",
          )
          .run(nowMs);
      });
    },
    pauseScan: ({ taskId, reason, nowMs }) =>
      setScanStatus(taskId, 'paused', String(reason || ''), nowMs),
    resumeScan: ({ taskId, sessionEpoch, nowMs }) =>
      setScanStatus(
        taskId,
        'running',
        '',
        nowMs,
        normalizeMs(sessionEpoch, 'session epoch'),
      ),
    failScan: ({ taskId, reason, nowMs }) =>
      setScanStatus(taskId, 'failed', String(reason || ''), nowMs),
    getEvidence(scanId) {
      return lotteryDb
        .prepare(
          `
          SELECT source, record_id, uid, occurred_at_ms, text, parent_id, level
          FROM lottery_evidence
          WHERE scan_id = ?
          ORDER BY source, length(record_id), record_id
        `,
        )
        .all(requiredText(scanId, 'scan ID'))
        .map((row) => ({
          source: row.source,
          recordId: row.record_id,
          uid: row.uid,
          occurredAtMs:
            row.occurred_at_ms === null ? null : Number(row.occurred_at_ms),
          text: row.text,
          parentId: row.parent_id,
          level: row.level === null ? null : Number(row.level),
        }));
    },
    requestBudget,
  };
}

module.exports = { createDynamicLotteryStore };
