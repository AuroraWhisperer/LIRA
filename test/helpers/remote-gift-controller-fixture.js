'use strict';

const assert = require('node:assert/strict');

function createFixture(options = {}) {
  const source = { id: 7, sourceKey: null };
  const state = { value: 'AUTHORIZED' };
  const authorization = { epoch: options.authorizationEpoch ?? 3 };
  const historyCalls = [];
  const pullCalls = [];
  const historySignals = [];
  const activeContexts = [];
  const resetCalls = [];
  const restartCalls = [];
  const historyImports = [];
  const liveImports = [];
  const catchUpCommits = [];
  const streamSignals = [];
  const timerDelays = [];
  const scheduledTimers = [];
  const baseState = {
    sourceId: source.id,
    syncEpoch: null,
    finalCursor: null,
    bootstrapComplete: false,
    bootstrapPageToken: null,
    bootstrapRecoveryCursor: null,
    bootstrapSyncEpoch: null,
    projectionGeneration: 1,
    lastValidatedAt: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...(options.initialState || {}),
  };
  const runtimeState = { ...baseState };
  const discovery = options.discovery || capabilityPage({ latestCursor: 10 });
  const historyPages =
    options.historyPages ||
    new Map([[null, historyPage({ eventIds: [], recoveryCursor: 10 })]]);
  const catchUpPages =
    options.catchUpPages ||
    new Map([
      [
        discovery.latestCursor,
        capabilityPage({
          events: [],
          nextCursor: discovery.latestCursor,
          latestCursor: discovery.latestCursor,
          syncEpoch: discovery.syncEpoch,
        }),
      ],
    ]);
  let stream = null;
  let streamOpenCount = 0;

  const licenseManager = {
    LicenseState: { AUTHORIZED: 'AUTHORIZED' },
    getState: () => state.value,
    getAuthorizationEpoch: () => authorization.epoch,
    getCloudSyncIdentity: () => ({ accountName: 'alice', streamerId: 10 }),
    getSnapshot: () => ({
      streamer: { accountName: 'alice', subdomain: 'mutable-subdomain' },
      device: { id: 'mutable-device' },
    }),
    getRemoteBaseUrl: () => options.remoteBaseUrl || 'https://api.example.test',
    async getGiftEventsInternal(input = {}) {
      const after = input.after === undefined ? null : input.after;
      pullCalls.push(after);
      if (options.getGiftEventsPage) {
        return options.getGiftEventsPage(input);
      }
      if (after === null) return discovery;
      const page = catchUpPages.get(after);
      if (!page) throw new Error(`unexpected cursor ${after}`);
      if (page instanceof Error) throw page;
      return page;
    },
    async getGiftHistoryInternal(input = {}) {
      const pageToken = input.pageToken ?? null;
      historyCalls.push(pageToken);
      historySignals.push(input.signal);
      if (options.getHistoryPage) {
        return options.getHistoryPage(pageToken, input.signal);
      }
      const page = historyPages.get(pageToken);
      if (!page) throw new Error(`unexpected page token ${pageToken}`);
      if (page instanceof Error) throw page;
      return page;
    },
    watchGiftEventsInternal(streamOptions) {
      stream = streamOptions;
      streamSignals.push(streamOptions.signal);
      const configuredEpoch = Array.isArray(options.streamEpochs)
        ? options.streamEpochs[
            Math.min(streamOpenCount, options.streamEpochs.length - 1)
          ]
        : options.streamEpoch;
      streamOpenCount += 1;
      streamOptions.onOpen({
        syncEpoch:
          configuredEpoch === undefined
            ? discovery.syncEpoch || null
            : configuredEpoch,
      });
      if (options.closeStreamImmediately) return Promise.resolve();
      return new Promise((resolve) => {
        if (streamOptions.signal.aborted) return resolve();
        streamOptions.signal.addEventListener('abort', resolve, { once: true });
      });
    },
  };

  const runtime = {
    resolveGiftSource(sourceKey) {
      source.sourceKey = sourceKey;
      return { ...source };
    },
    getGiftSyncState(sourceId) {
      assert.equal(sourceId, source.id);
      return Object.freeze({ ...runtimeState });
    },
    commitGiftHistoryPage(input) {
      assertFence(input);
      for (const record of input.records) historyImports.push(record.eventId);
      runtimeState.bootstrapPageToken = input.hasMore
        ? input.nextPageToken
        : null;
      runtimeState.bootstrapRecoveryCursor = input.hasMore
        ? input.recoveryCursor
        : null;
      runtimeState.bootstrapSyncEpoch = input.hasMore ? input.syncEpoch : null;
      if (!input.hasMore) {
        runtimeState.bootstrapComplete = true;
        runtimeState.syncEpoch = input.syncEpoch;
        runtimeState.finalCursor = input.recoveryCursor;
      }
      return Object.freeze({ ...runtimeState });
    },
    restartGiftHistoryBootstrap(sourceId, projectionGeneration) {
      const input = { sourceId, projectionGeneration };
      assertFence(input);
      restartCalls.push({
        sourceId: input.sourceId,
        projectionGeneration: input.projectionGeneration,
      });
      runtimeState.bootstrapPageToken = null;
      runtimeState.bootstrapRecoveryCursor = null;
      runtimeState.bootstrapSyncEpoch = null;
      return Object.freeze({ ...runtimeState });
    },
    commitGiftCatchUpPage(input) {
      assertFence(input);
      catchUpCommits.push({ ...input });
      for (const event of input.events) liveImports.push(event.eventId);
      runtimeState.finalCursor = input.nextCursor;
      if (input.validatedAt) runtimeState.lastValidatedAt = input.validatedAt;
      return Object.freeze({ ...runtimeState });
    },
    commitLegacyGiftPage(input) {
      assertFence(input);
      for (const event of input.events) liveImports.push(event.eventId);
      runtimeState.finalCursor = input.nextCursor;
      return Object.freeze({ ...runtimeState });
    },
    resetGiftProjectionForRebuild(sourceId) {
      assert.equal(sourceId, source.id);
      resetCalls.push(sourceId);
      Object.assign(runtimeState, {
        syncEpoch: null,
        finalCursor: null,
        bootstrapComplete: false,
        bootstrapPageToken: null,
        bootstrapRecoveryCursor: null,
        bootstrapSyncEpoch: null,
        projectionGeneration: runtimeState.projectionGeneration + 1,
        lastValidatedAt: null,
      });
      return Object.freeze({ ...runtimeState });
    },
    setActiveGiftSource(context) {
      activeContexts.push({ ...context });
    },
    async importProcessedGiftEvent(event, sourceId) {
      assert.equal(sourceId, source.id);
      if (options.importProcessedGiftEvent) {
        return options.importProcessedGiftEvent(event, sourceId);
      }
      liveImports.push(event.eventId);
    },
  };

  function assertFence(input) {
    assert.equal(input.sourceId, source.id);
    if (input.projectionGeneration !== runtimeState.projectionGeneration) {
      throw new Error('STALE_GIFT_PROJECTION');
    }
  }

  return {
    source,
    state,
    authorization,
    runtimeState,
    historyCalls,
    pullCalls,
    historySignals,
    activeContexts,
    resetCalls,
    restartCalls,
    historyImports,
    liveImports,
    catchUpCommits,
    streamSignals,
    timerDelays,
    scheduledTimers,
    get stream() {
      return stream;
    },
    options: {
      licenseManager,
      runtime,
      timers: {
        setTimeout(callback, delay) {
          timerDelays.push(delay);
          const timer = { callback, delay, unref() {} };
          scheduledTimers.push(timer);
          return timer;
        },
        clearTimeout(timer) {
          timer.cleared = true;
        },
      },
      now: () => '2026-09-01T02:00:00.000Z',
    },
  };
}

function capabilityPage(overrides = {}) {
  return {
    ok: true,
    events: [],
    nextCursor: overrides.nextCursor ?? overrides.latestCursor ?? 10,
    hasMore: false,
    historyBootstrapVersion: 1,
    syncEpoch: 'epoch-1',
    earliestCursor: 1,
    latestCursor: 10,
    ...overrides,
  };
}

function legacyPage(overrides = {}) {
  return {
    ok: true,
    events: [],
    nextCursor: 5,
    hasMore: false,
    ...overrides,
  };
}

function historyPage(options = {}) {
  return {
    ok: true,
    events: (options.eventIds || []).map(makeHistoryRecord),
    nextPageToken: options.nextPageToken ?? null,
    hasMore: options.hasMore ?? false,
    recoveryCursor: options.recoveryCursor ?? 10,
    syncEpoch: options.syncEpoch || 'epoch-1',
    historyBootstrapVersion: 1,
  };
}

function makeHistoryRecord(eventId) {
  const event = makeEvent(eventId, 1);
  return { eventId: event.eventId, gift: event.gift };
}

function makeEvent(eventId, cursor) {
  return {
    eventId,
    cursor,
    phase: 'final',
    gift: {
      giftId: '33988',
      giftName: '人气票',
      userName: 'Alice',
      num: 1,
      unitPrice: 0.1,
      totalPrice: 0.1,
      coinType: 'gold',
      isBlindBox: false,
      blindBoxId: null,
      blindBoxName: '',
      blindBoxPrice: null,
      blindProfit: null,
      createdAt: '2027-01-15T08:00:00.000Z',
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition not reached');
}

module.exports = {
  capabilityPage,
  createDeferred,
  createFixture,
  historyPage,
  legacyPage,
  makeEvent,
  makeHistoryRecord,
  waitFor,
};
