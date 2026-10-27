'use strict';

function createRemoteGiftReads(request) {
  const read = (path, token, signal, headers) =>
    request('GET', path, undefined, token, { maxResponseBytes: 512 * 1024, signal, ...(headers ? { headers } : {}) });
  const headers = { 'X-Lira-Gift-Identity': '1', 'X-Lira-Gift-Display': '1', 'X-Lira-Gift-Retention': '1' };
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
      return read(
        `/api/device/gift-card-profiles${query.size ? `?${query}` : ''}`,
        token,
        options.signal,
      );
    },
  };
}

module.exports = { createRemoteGiftReads };
