'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  closeDatabases,
  createDatabases,
} = require('../../src/storage/database');
const { createGiftSyncStore } = require('../../src/storage/gift-sync-store');

const AS_OF = '2026-09-02T00:00:00.000Z';

function createFixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-query-'));
  const databases = createDatabases({ dataDir });
  const giftDb = databases.giftDb;
  const store = createGiftSyncStore({ giftDb, now: () => AS_OF });
  let activeSource = null;
  const insert = giftDb.prepare(`
    INSERT INTO gift_events (
      source_id, platform_id, cmd, gift_id, gift_name, user_name,
      num, unit_price, total_price, coin_type, is_blind_box,
      blind_box_name, blind_box_price, blind_profit,
      counted_in_sprint, detection_status, gift_stats_eligible,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return {
    databases,
    giftDb,
    context: {
      db: databases,
      now: () => AS_OF,
      settings: () => ({
        enableGiftSprint: 'true',
        giftSprintTargetRmb: 100,
      }),
      getActiveGiftSource: () => activeSource,
    },
    resolveSource: (sourceKey) => store.resolveSource(sourceKey),
    setActiveSource(sourceId, overrides = {}) {
      activeSource = {
        sourceId,
        syncState: 'BOOTSTRAPPING',
        partial: true,
        dirty: true,
        epochValidated: false,
        syncedThroughCursor: null,
        syncedAt: null,
        ...overrides,
      };
    },
    clearActiveSource() {
      activeSource = null;
    },
    insertGift(sourceId, eventId, overrides = {}) {
      const isBlindBox = overrides.isBlindBox === true;
      const totalPrice = overrides.totalPrice ?? 1;
      const blindBoxPrice = isBlindBox
        ? (overrides.blindBoxPrice ?? null)
        : null;
      return insert.run(
        sourceId,
        `lira-server:${eventId}`,
        overrides.cmd || 'LIRA_SERVER_GIFT',
        overrides.giftId || 'gift-1',
        overrides.giftName || '礼物',
        overrides.userName || '观众',
        overrides.num ?? 1,
        overrides.unitPrice ?? totalPrice,
        totalPrice,
        overrides.coinType || 'gold',
        isBlindBox ? 1 : 0,
        overrides.blindBoxName || '',
        blindBoxPrice,
        blindBoxPrice === null ? null : totalPrice - blindBoxPrice,
        overrides.countedInSprint ?? 0,
        overrides.detectionStatus || 'final',
        overrides.giftStatsEligible ?? 1,
        overrides.status || 'active',
        overrides.createdAt || '2026-09-01T12:00:00.000Z',
        overrides.updatedAt || '2026-09-01T12:00:00.000Z',
      );
    },
    close() {
      closeDatabases(databases);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

module.exports = { createFixture };
