'use strict';

const MAX_PAGE_SIZE = 200;
const MAX_EPOCH_LENGTH = 128;
const MAX_PAGE_TOKEN_LENGTH = 4096;

function createGiftSyncStore(options = {}) {
  const giftDb = options.giftDb;
  if (!giftDb || typeof giftDb.prepare !== 'function') {
    throw new Error('giftDb is required to create GiftSyncStore.');
  }
  const now = typeof options.now === 'function' ? options.now : nowIso;
  const importHistoryRecord = options.importHistoryRecord;
  const importLiveEvent = options.importLiveEvent;

  function resolveSource(sourceKey) {
    const key = normalizeSourceKey(sourceKey);
    const timestamp = normalizeTimestamp(now());
    return withImmediateTransaction(giftDb, () => {
      giftDb
        .prepare(
          `
          INSERT INTO gift_sources (source_key, created_at, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(source_key) DO UPDATE SET updated_at = excluded.updated_at
        `,
        )
        .run(key, timestamp, timestamp);
      const source = giftDb
        .prepare(
          'SELECT id, source_key FROM gift_sources WHERE source_key = ?',
        )
        .get(key);
      giftDb
        .prepare(
          `
          INSERT OR IGNORE INTO gift_sync_state (source_id, updated_at)
          VALUES (?, ?)
        `,
        )
        .run(source.id, timestamp);
      return Object.freeze({
        id: Number(source.id),
        sourceKey: source.source_key,
      });
    });
  }

  function getState(sourceId) {
    const id = normalizeSourceId(sourceId);
    const row = giftDb
      .prepare('SELECT * FROM gift_sync_state WHERE source_id = ?')
      .get(id);
    if (!row) throw new Error('GIFT_SOURCE_NOT_FOUND');
    return mapState(row);
  }

  function commitHistoryPage(input = {}) {
    if (typeof importHistoryRecord !== 'function') {
      throw new Error('GIFT_HISTORY_IMPORTER_REQUIRED');
    }
    const page = normalizeHistoryPageCommit(input);
    return withImmediateTransaction(giftDb, () => {
      const state = assertProjectionFence(
        giftDb,
        page.sourceId,
        page.projectionGeneration,
      );
      if (Number(state.bootstrap_complete) === 1) {
        throw new Error('GIFT_BOOTSTRAP_ALREADY_COMPLETE');
      }
      assertBootstrapSnapshot(state, page);
      for (const record of page.records) {
        importHistoryRecord(record, page.sourceId, {
          projectionGeneration: page.projectionGeneration,
        });
      }
      const timestamp = normalizeTimestamp(now());
      if (page.hasMore) {
        giftDb
          .prepare(
            `
            UPDATE gift_sync_state
            SET bootstrap_page_token = ?,
                bootstrap_recovery_cursor = ?,
                bootstrap_sync_epoch = ?,
                updated_at = ?
            WHERE source_id = ? AND projection_generation = ?
          `,
          )
          .run(
            page.nextPageToken,
            page.recoveryCursor,
            page.syncEpoch,
            timestamp,
            page.sourceId,
            page.projectionGeneration,
          );
      } else {
        giftDb
          .prepare(
            `
            UPDATE gift_sync_state
            SET sync_epoch = ?, final_cursor = ?, bootstrap_complete = 1,
                bootstrap_page_token = NULL,
                bootstrap_recovery_cursor = NULL,
                bootstrap_sync_epoch = NULL,
                last_validated_at = NULL,
                updated_at = ?
            WHERE source_id = ? AND projection_generation = ?
          `,
          )
          .run(
            page.syncEpoch,
            page.recoveryCursor,
            timestamp,
            page.sourceId,
            page.projectionGeneration,
          );
      }
      return readStateRow(giftDb, page.sourceId);
    });
  }

  function commitCatchUpPage(input = {}) {
    if (typeof importLiveEvent !== 'function') {
      throw new Error('GIFT_LIVE_IMPORTER_REQUIRED');
    }
    const page = normalizeCatchUpPageCommit(input);
    return withImmediateTransactionAndEffects(giftDb, (registerAfterCommit) => {
      const state = assertProjectionFence(
        giftDb,
        page.sourceId,
        page.projectionGeneration,
      );
      if (
        Number(state.bootstrap_complete) !== 1 ||
        state.sync_epoch !== page.syncEpoch
      ) {
        throw new Error('GIFT_SYNC_STATE_MISMATCH');
      }
      const currentCursor = Number(state.final_cursor);
      if (page.nextCursor < currentCursor) {
        throw new Error('GIFT_CURSOR_REGRESSION');
      }
      validateEventCursors(page.events, currentCursor, page.nextCursor, {
        contiguous: true,
      });
      for (const event of page.events) {
        importLiveEvent(event, page.sourceId, {
          projectionGeneration: page.projectionGeneration,
          registerAfterCommit,
        });
      }
      const timestamp = normalizeTimestamp(now());
      const validatedAt = page.validatedAt || null;
      giftDb
        .prepare(
          `
          UPDATE gift_sync_state
          SET final_cursor = ?,
              last_validated_at = COALESCE(?, last_validated_at),
              updated_at = ?
          WHERE source_id = ? AND projection_generation = ?
        `,
        )
        .run(
          page.nextCursor,
          validatedAt,
          timestamp,
          page.sourceId,
          page.projectionGeneration,
        );
      return readStateRow(giftDb, page.sourceId);
    });
  }

  function commitLegacyPage(input = {}) {
    if (typeof importLiveEvent !== 'function') {
      throw new Error('GIFT_LIVE_IMPORTER_REQUIRED');
    }
    const page = normalizeLegacyPageCommit(input);
    return withImmediateTransactionAndEffects(giftDb, (registerAfterCommit) => {
      const state = assertProjectionFence(
        giftDb,
        page.sourceId,
        page.projectionGeneration,
      );
      const currentCursor =
        state.final_cursor === null ? null : Number(state.final_cursor);
      if (currentCursor !== null && page.nextCursor < currentCursor) {
        throw new Error('GIFT_CURSOR_REGRESSION');
      }
      if (page.events.length > 0) {
        validateEventCursors(page.events, currentCursor ?? 0, page.nextCursor);
      }
      for (const event of page.events) {
        importLiveEvent(event, page.sourceId, {
          projectionGeneration: page.projectionGeneration,
          registerAfterCommit,
        });
      }
      giftDb
        .prepare(
          `
          UPDATE gift_sync_state
          SET final_cursor = ?, bootstrap_complete = 0,
              sync_epoch = NULL, bootstrap_page_token = NULL,
              bootstrap_recovery_cursor = NULL,
              bootstrap_sync_epoch = NULL,
              last_validated_at = NULL, updated_at = ?
          WHERE source_id = ? AND projection_generation = ?
        `,
        )
        .run(
          page.nextCursor,
          normalizeTimestamp(now()),
          page.sourceId,
          page.projectionGeneration,
        );
      return readStateRow(giftDb, page.sourceId);
    });
  }

  function resetProjectionForRebuild(sourceId) {
    const id = normalizeSourceId(sourceId);
    return withImmediateTransaction(giftDb, () => {
      const state = giftDb
        .prepare('SELECT * FROM gift_sync_state WHERE source_id = ?')
        .get(id);
      if (!state) throw new Error('GIFT_SOURCE_NOT_FOUND');
      giftDb
        .prepare(
          `
          DELETE FROM overtime_settlements
          WHERE gift_event_id IN (
            SELECT id FROM gift_events
            WHERE source_id = ? AND cmd = 'LIRA_SERVER_GIFT'
          )
        `,
        )
        .run(id);
      giftDb
        .prepare(
          `
          DELETE FROM gift_events
          WHERE source_id = ? AND cmd = 'LIRA_SERVER_GIFT'
        `,
        )
        .run(id);
      giftDb
        .prepare(
          `
          UPDATE gift_sync_state
          SET sync_epoch = NULL, final_cursor = NULL,
              bootstrap_complete = 0, bootstrap_page_token = NULL,
              bootstrap_recovery_cursor = NULL,
              bootstrap_sync_epoch = NULL,
              projection_generation = projection_generation + 1,
              last_validated_at = NULL, updated_at = ?
          WHERE source_id = ?
        `,
        )
        .run(normalizeTimestamp(now()), id);
      return readStateRow(giftDb, id);
    });
  }

  function restartHistoryBootstrap(sourceId, projectionGeneration) {
    const id = normalizeSourceId(sourceId);
    const generation = normalizeGeneration(projectionGeneration);
    return withImmediateTransaction(giftDb, () => {
      const state = assertProjectionFence(giftDb, id, generation);
      if (Number(state.bootstrap_complete) === 1) {
        throw new Error('GIFT_BOOTSTRAP_ALREADY_COMPLETE');
      }
      giftDb
        .prepare(
          `
          UPDATE gift_sync_state
          SET bootstrap_page_token = NULL,
              bootstrap_recovery_cursor = NULL,
              bootstrap_sync_epoch = NULL,
              updated_at = ?
          WHERE source_id = ? AND projection_generation = ?
        `,
        )
        .run(normalizeTimestamp(now()), id, generation);
      return readStateRow(giftDb, id);
    });
  }

  return {
    resolveSource,
    getState,
    commitHistoryPage,
    commitCatchUpPage,
    commitLegacyPage,
    restartHistoryBootstrap,
    resetProjectionForRebuild,
  };
}

function normalizeHistoryPageCommit(input) {
  const records = normalizePageRecords(input.records);
  const hasMore = input.hasMore;
  const nextPageToken = normalizePageToken(input.nextPageToken);
  if (
    typeof hasMore !== 'boolean' ||
    (hasMore && !nextPageToken) ||
    (!hasMore && nextPageToken !== null)
  ) {
    throw new Error('INVALID_GIFT_HISTORY_COMMIT');
  }
  return Object.freeze({
    sourceId: normalizeSourceId(input.sourceId),
    projectionGeneration: normalizeGeneration(input.projectionGeneration),
    records,
    nextPageToken,
    hasMore,
    recoveryCursor: normalizeCursor(input.recoveryCursor),
    syncEpoch: normalizeEpoch(input.syncEpoch),
  });
}

function normalizeCatchUpPageCommit(input) {
  const events = normalizePageRecords(input.events);
  return Object.freeze({
    sourceId: normalizeSourceId(input.sourceId),
    projectionGeneration: normalizeGeneration(input.projectionGeneration),
    events,
    nextCursor: normalizeCursor(input.nextCursor),
    syncEpoch: normalizeEpoch(input.syncEpoch),
    validatedAt:
      input.validatedAt === null || input.validatedAt === undefined
        ? null
        : normalizeTimestamp(input.validatedAt),
  });
}

function normalizeLegacyPageCommit(input) {
  return Object.freeze({
    sourceId: normalizeSourceId(input.sourceId),
    projectionGeneration: normalizeGeneration(input.projectionGeneration),
    events: normalizePageRecords(input.events),
    nextCursor: normalizeCursor(input.nextCursor),
  });
}

function assertProjectionFence(giftDb, sourceId, generation) {
  const state = giftDb
    .prepare('SELECT * FROM gift_sync_state WHERE source_id = ?')
    .get(sourceId);
  if (!state) throw new Error('GIFT_SOURCE_NOT_FOUND');
  if (Number(state.projection_generation) !== generation) {
    throw new Error('STALE_GIFT_PROJECTION');
  }
  return state;
}

function assertBootstrapSnapshot(state, page) {
  if (
    (state.bootstrap_sync_epoch !== null &&
      state.bootstrap_sync_epoch !== page.syncEpoch) ||
    (state.bootstrap_recovery_cursor !== null &&
      Number(state.bootstrap_recovery_cursor) !== page.recoveryCursor)
  ) {
    throw new Error('GIFT_BOOTSTRAP_SNAPSHOT_MISMATCH');
  }
}

function validateEventCursors(
  events,
  currentCursor,
  nextCursor,
  options = {},
) {
  let previous = currentCursor;
  for (const event of events) {
    const cursor = normalizeCursor(event?.cursor);
    const valid = options.contiguous
      ? cursor === previous + 1
      : cursor > previous;
    if (!valid) throw new Error('INVALID_GIFT_CATCH_UP_PAGE');
    previous = cursor;
  }
  if (previous !== nextCursor) throw new Error('INVALID_GIFT_CATCH_UP_PAGE');
}

function readStateRow(giftDb, sourceId) {
  return mapState(
    giftDb
      .prepare('SELECT * FROM gift_sync_state WHERE source_id = ?')
      .get(sourceId),
  );
}

function mapState(row) {
  if (!row) throw new Error('GIFT_SOURCE_NOT_FOUND');
  return Object.freeze({
    sourceId: Number(row.source_id),
    syncEpoch: row.sync_epoch,
    finalCursor:
      row.final_cursor === null ? null : Number(row.final_cursor),
    bootstrapComplete: Number(row.bootstrap_complete) === 1,
    bootstrapPageToken: row.bootstrap_page_token,
    bootstrapRecoveryCursor:
      row.bootstrap_recovery_cursor === null
        ? null
        : Number(row.bootstrap_recovery_cursor),
    bootstrapSyncEpoch: row.bootstrap_sync_epoch,
    projectionGeneration: Number(row.projection_generation),
    lastValidatedAt: row.last_validated_at,
    updatedAt: row.updated_at,
  });
}

function normalizePageRecords(value) {
  if (!Array.isArray(value) || value.length > MAX_PAGE_SIZE) {
    throw new Error('INVALID_GIFT_SYNC_PAGE');
  }
  return value.slice();
}

function normalizeSourceKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('INVALID_GIFT_SOURCE');
  return key;
}

function normalizeSourceId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error('INVALID_GIFT_SOURCE');
  }
  return id;
}

function normalizeGeneration(value) {
  const generation = Number(value);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('INVALID_GIFT_PROJECTION_GENERATION');
  }
  return generation;
}

function normalizeCursor(value) {
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error('INVALID_GIFT_CURSOR');
  }
  return cursor;
}

function normalizeEpoch(value) {
  const epoch = String(value || '').trim();
  if (!epoch || epoch.length > MAX_EPOCH_LENGTH) {
    throw new Error('INVALID_GIFT_SYNC_EPOCH');
  }
  return epoch;
}

function normalizePageToken(value) {
  if (value === null || value === undefined || value === '') return null;
  const token = String(value);
  if (token.length > MAX_PAGE_TOKEN_LENGTH) {
    throw new Error('INVALID_GIFT_BOOTSTRAP_TOKEN');
  }
  return token;
}

function normalizeTimestamp(value) {
  const milliseconds = Date.parse(String(value || ''));
  if (!Number.isFinite(milliseconds)) throw new Error('INVALID_GIFT_TIMESTAMP');
  return new Date(milliseconds).toISOString();
}

function withImmediateTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function withImmediateTransactionAndEffects(db, operation) {
  const effects = [];
  const result = withImmediateTransaction(db, () =>
    operation((effect) => {
      if (typeof effect !== 'function') {
        throw new Error('INVALID_GIFT_AFTER_COMMIT_EFFECT');
      }
      effects.push(effect);
    }),
  );
  for (const effect of effects) effect();
  return result;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  createGiftSyncStore,
};
