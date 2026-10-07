'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServerRuntime } = require('../../src/server');

test('runtime exposes the transactional gift projection sync surface', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gift-runtime-'));
  const runtime = createServerRuntime({
    dataDir,
    licenseGate: { isAuthorized: () => true },
  });

  try {
    await runtime.start({ host: '127.0.0.1', startPort: 0 });
    const sourceKey = 'a'.repeat(64);
    const source = runtime.resolveGiftSource(sourceKey);
    const initial = runtime.getGiftSyncState(source.id);
    assert.equal(initial.projectionGeneration, 1);

    const partial = runtime.commitGiftHistoryPage({
      sourceId: source.id,
      projectionGeneration: initial.projectionGeneration,
      records: [],
      nextPageToken: 'opaque-page-token',
      hasMore: true,
      recoveryCursor: 0,
      syncEpoch: 'runtime-sync-epoch',
    });
    assert.equal(partial.bootstrapPageToken, 'opaque-page-token');

    const restarted = runtime.restartGiftHistoryBootstrap(source.id, initial.projectionGeneration);
    assert.equal(restarted.bootstrapPageToken, null);
    assert.equal(restarted.bootstrapRecoveryCursor, null);
    assert.equal(restarted.bootstrapSyncEpoch, null);

    const complete = runtime.commitGiftHistoryPage({
      sourceId: source.id,
      projectionGeneration: initial.projectionGeneration,
      records: [],
      nextPageToken: null,
      hasMore: false,
      recoveryCursor: 0,
      syncEpoch: 'runtime-sync-epoch',
    });
    assert.equal(complete.bootstrapComplete, true);
    assert.equal(complete.finalCursor, 0);
    runtime.setActiveGiftSource({
      sourceId: source.id,
      syncState: 'LIVE',
      partial: false,
      syncedThroughCursor: 0,
      syncedAt: complete.updatedAt,
      latestCursor: 0,
      dirty: false,
      epochValidated: true,
    });

    const reset = runtime.resetGiftProjectionForRebuild(source.id);
    assert.equal(reset.projectionGeneration, 2);
    assert.equal(reset.bootstrapComplete, false);
  } finally {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
