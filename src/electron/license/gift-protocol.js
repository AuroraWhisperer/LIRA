'use strict';

const { normalizeGiftEffectEvent } = require('../../bilibili/gift/effect-event');
const { normalizeProcessedGiftEvent, normalizeProcessedGiftHistoryPage, normalizeProcessedGiftPage } = require('../../shared/processed-gift-contract');
const { normalizeGiftSummaryPage } = require('../../shared/gift-summary-contract');
const { parseEventBlock } = require('../../shared/bounded-sse-reader');
const { RemoteLicenseError } = require('./remote-license-error');
const { safeHeaderValue } = require('./license-transport');

const MAX_GIFT_CATALOG_BYTES = 32 * 1024 * 1024;

function createGiftEndpoints({ request, readEventStream }) {
  const read = (path, token, signal, headers) =>
    request('GET', path, undefined, token, { maxResponseBytes: 512 * 1024, signal, ...(headers ? { headers } : {}) });
  const headers = { 'X-Lira-Gift-Identity': '1', 'X-Lira-Gift-Display': '1', 'X-Lira-Gift-Retention': '1' };
  async function requestGiftCatalog(etag) {
    const normalizedEtag = safeHeaderValue(etag);
    return request(
      'GET',
      '/api/public/gifts/catalog?schemaVersion=3',
      undefined,
      // The catalog endpoint is public.  Never forward a device session token,
      // even when a caller has one available for other protected operations.
      undefined,
      {
        maxResponseBytes: MAX_GIFT_CATALOG_BYTES,
        allowNotModified: true,
        includeResponseMeta: true,
        headers: normalizedEtag ? { 'If-None-Match': normalizedEtag } : {},
      },
    );
  }

  function clearGiftHistory(token, options = {}) {
    return request('POST', '/api/device/gift-history/clear', { confirm: true }, token, options);
  }

  function watchGiftEvents(token, options = {}) {
    return readEventStream(
      '/api/device/gift-events/stream',
      token,
      options,
      (response) => {
        const rawSyncEpoch = response.headers?.get?.('x-lira-gift-sync-epoch');
        const syncEpoch = normalizeSyncEpochHeader(rawSyncEpoch);
        if (rawSyncEpoch !== null && syncEpoch === null) {
          throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效响应。', {
            status: response.status,
            retryable: true,
          });
        }
        options.onOpen?.({ syncEpoch });
      },
      (block) => handleGiftEventBlock(block, options.onEvent, options.onEffect),
      { 'X-Lira-Gift-Identity': '1', 'X-Lira-Gift-Display': '1', 'X-Lira-Gift-Effects': '1', 'X-Lira-Gift-Retention': '1' },
    );
  }

  return {
    getGiftSummaries(input, token) {
      const query = new URLSearchParams();
      if (input.pageToken) query.set('pageToken', input.pageToken);
      else query.set('afterRevision', String(input.afterRevision ?? 0));
      return read(`/api/device/gift-summaries?${query}`, token, input.signal, headers);
    },
    getGiftEvents(after, limit, token, options = {}) {
      const query = new URLSearchParams();
      if (after !== null && after !== undefined) query.set('after', String(after));
      query.set('limit', String(limit));
      if (options.syncEpoch) query.set('syncEpoch', String(options.syncEpoch));
      return read(`/api/device/gift-events?${query}`, token, options.signal, headers);
    },
    getGiftHistory(pageToken, token, options = {}) {
      const query = new URLSearchParams();
      if (pageToken !== null && pageToken !== undefined) query.set('pageToken', String(pageToken));
      return read(`/api/device/gift-history${query.size ? `?${query}` : ''}`, token, options.signal, headers);
    },
    getGiftCardProfiles(cursor, token, options = {}) {
      const query = new URLSearchParams();
      if (cursor) query.set('cursor', cursor);
      if (options.revision) query.set('revision', options.revision);
      if (options.afterRevision) query.set('afterRevision', options.afterRevision);
      return read(
        `/api/device/gift-card-profiles${query.size ? `?${query}` : ''}`,
        token,
        options.signal,
      );
    },
    clearGiftHistory,
    watchGiftEvents,
    getGiftCatalog: etag => requestGiftCatalog(etag),
  };
}

function handleGiftEventBlock(block, onEvent, onEffect) {
  const { eventName, data } = parseEventBlock(block);
  if (eventName === 'gift-effect' && data) {
    try {
      const event = normalizeGiftEffectEvent(JSON.parse(data));
      if (event) onEffect?.(event);
    } catch {
      return;
    }
    return;
  }
  if (eventName !== 'gift-event' || !data) return;
  try {
    const event = normalizeProcessedGiftEvent(JSON.parse(data));
    onEvent?.(event);
  } catch (error) {
    // A malformed event is isolated to its SSE block. Cursor recovery remains
    // authoritative for valid finalized events after reconnect.
    void error;
    return;
  }
}

function normalizeSyncEpochHeader(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text || text.length > 128 || /[\r\n]/u.test(text)) return null;
  return text;
}

function createGiftOperations({ remote, withAuthorizedToken }) {
  async function getGiftEventsInternal(input = {}) {
    const after = input.after;
    const limit = input.limit === undefined ? 200 : input.limit;
    const syncEpoch = input.syncEpoch === null || input.syncEpoch === undefined ? null : input.syncEpoch;
    if (
      (after !== null && after !== undefined && (!Number.isSafeInteger(after) || after < 0)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      (syncEpoch !== null && (typeof syncEpoch !== 'string' || !syncEpoch || syncEpoch.length > 128))
    ) {
      throw new RemoteLicenseError('INVALID_GIFT_CURSOR', '礼物事件游标无效。');
    }
    return withAuthorizedToken(
      async (token) => {
        const result = await remote.getGiftEvents(after === null || after === undefined ? null : after, limit, token, {
          syncEpoch,
          signal: input.signal,
        });
        try {
          return normalizeProcessedGiftPage(result);
        } catch {
          throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效响应。', { retryable: true });
        }
      },
      { sanitize: false, signal: input.signal },
    );
  }

  async function getGiftHistoryInternal(input = {}) {
    const pageToken = input.pageToken === null || input.pageToken === undefined ? null : input.pageToken;
    if (pageToken !== null && (typeof pageToken !== 'string' || !pageToken || pageToken.length > 4096)) {
      throw new RemoteLicenseError('INVALID_BOOTSTRAP_TOKEN', '礼物历史页令牌无效。');
    }
    return withAuthorizedToken(
      async (token) => {
        const result = await remote.getGiftHistory(pageToken, token, {
          signal: input.signal,
        });
        try {
          return normalizeProcessedGiftHistoryPage(result);
        } catch {
          throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效响应。', { retryable: true });
        }
      },
      { sanitize: false, signal: input.signal },
    );
  }

  async function getGiftSummariesInternal(input = {}) {
    if ((input.pageToken != null && (typeof input.pageToken !== 'string' || !input.pageToken || input.pageToken.length > 4096)) ||
      (input.afterRevision != null && (!Number.isSafeInteger(input.afterRevision) || input.afterRevision < 0))) {
      throw new RemoteLicenseError('INVALID_GIFT_SUMMARY_QUERY', '礼物汇总查询无效。');
    }
    return withAuthorizedToken(async (token) => {
      const result = await remote.getGiftSummaries(input, token);
      try { return normalizeGiftSummaryPage(result); }
      catch { throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效汇总。', { retryable: true }); }
    }, { sanitize: false, signal: input.signal });
  }

  async function clearGiftHistoryInternal(input = {}) {
    return withAuthorizedToken(
      async (token) => {
        const result = await remote.clearGiftHistory(token, {
          signal: input.signal,
        });
        const deletedCounts = result?.deletedCounts;
        const syncEpoch = result?.syncEpoch;
        if (
          result?.ok !== true ||
          !deletedCounts ||
          !Number.isSafeInteger(deletedCounts.giftEvents) ||
          deletedCounts.giftEvents < 0 ||
          !Number.isSafeInteger(deletedCounts.giftEventDeliveries) ||
          deletedCounts.giftEventDeliveries < 0 ||
          typeof syncEpoch !== 'string' ||
          !syncEpoch ||
          syncEpoch.length > 128
        ) {
          throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效响应。', { retryable: true });
        }
        return {
          ok: true,
          deletedCounts: {
            giftEvents: deletedCounts.giftEvents,
            giftEventDeliveries: deletedCounts.giftEventDeliveries,
          },
          syncEpoch,
        };
      },
      { sanitize: false, signal: input.signal },
    );
  }

  async function watchGiftEventsInternal(options = {}) {
    return withAuthorizedToken((token) => remote.watchGiftEvents(token, options), { sanitize: false, signal: options.signal });
  }

  async function getGiftCatalog(input = {}) {
    const etag = String(input?.etag || '')
      .trim()
      .slice(0, 256);
    // This is a public read model. Authorization gates the refresh, but the
    // public endpoint deliberately receives no DeviceBearer token.
    const result = await withAuthorizedToken(() => remote.getGiftCatalog(etag));
    const response = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
    return { ...response, imageBaseUrl: remote.baseUrl };
  }

  return {
    getGiftEventsInternal, getGiftHistoryInternal, getGiftSummariesInternal, clearGiftHistoryInternal, watchGiftEventsInternal, getGiftCatalog,
    getGiftCardProfilesInternal: (input = {}) =>
      withAuthorizedToken(
        (token) => remote.getGiftCardProfiles(input.cursor, token, { signal: input.signal,
          ...(input.revision ? { revision: input.revision } : {}),
          ...(input.afterRevision ? { afterRevision: input.afterRevision } : {}) }), { signal: input.signal },
      ),
  };
}

module.exports = { createGiftEndpoints, createGiftOperations, handleGiftEventBlock };
