'use strict';

const { randomUUID } = require('node:crypto');
const { hostname } = require('node:os');
const { CHECKIN_BLESSINGS, FORTUNES } = require('../shared/bot-defaults');
const { canonical, digest, invalid, exact, sanitizeSettings, sanitizeTakeover } = require('../shared/daily-bot-contract');

function createDailyBotController({ licenseManager, getLegacyReader, sourceLabel, now = Date.now }) {
  let current = null, draft = null, disposed = false, busy = false;
  const unsubscribe = licenseManager.onStateChanged(() => { context(); });
  function context() {
    const identity = licenseManager.getCloudSyncIdentity();
    const owner = !disposed && licenseManager.isAuthorized() && identity?.streamerId
      ? JSON.stringify([licenseManager.getRemoteBaseUrl(), identity.streamerId, licenseManager.getAuthorizationEpoch()]) : null;
    if (current?.owner !== owner) { current = owner ? { owner, id: randomUUID() } : null; draft = null; }
    return current;
  }
  function same(captured) {
    if (!captured || context()?.id !== captured.id) invalid('DAILY_BOT_ACCOUNT_CHANGED');
  }
  async function call(captured, operation, input = {}) {
    same(captured);
    const result = await licenseManager.dailyBotRequestInternal(operation, input);
    same(captured); return result;
  }
  const read = async (captured) => sanitizeSettings(await call(captured, 'read'));
  function reader() {
    const value = getLegacyReader();
    if (!value) invalid('DAILY_BOT_LOCAL_UNAVAILABLE');
    return value;
  }
  function summary() { return { ...reader().summary(), sourceLabel }; }
  function confirmed(input) {
    if (input.legacyStoppedConfirmed !== true || input.ownershipConfirmed !== true) invalid();
  }
  async function prepare(captured, input) {
    exact(input, ['legacyStoppedConfirmed', 'ownershipConfirmed', 'libraryChoice', 'blessings', 'fortunes'],
      ['legacyStoppedConfirmed', 'ownershipConfirmed', 'libraryChoice']);
    confirmed(input); exact(input.libraryChoice, ['checkin', 'fortune']);
    if (Object.values(input.libraryChoice).some((v) => !['legacy', 'builtin', 'corrected'].includes(v))) invalid();
    const settings = await read(captured);
    if (settings.takeover.state === 'ready') invalid('DAILY_BOT_TAKEOVER_CONFLICT');
    const status = settings.takeover.state === 'importing'
      ? await call(captured, 'status', { id: settings.takeover.importId }) : null;
    const legacy = reader().read();
    const sourceHash = digest(legacy);
    const data = { schemaVersion: 1, sourceId: digest({ host: hostname(), path: sourceLabel }),
      cutoffAt: status?.cutoffAt || new Date(now()).toISOString(), libraryChoice: input.libraryChoice,
      checkins: legacy.checkins,
      blessings: input.libraryChoice.checkin === 'builtin' ? CHECKIN_BLESSINGS
        : input.libraryChoice.checkin === 'corrected' ? input.blessings : legacy.blessings,
      fortunes: input.libraryChoice.fortune === 'builtin' ? FORTUNES
        : input.libraryChoice.fortune === 'corrected' ? input.fortunes : legacy.fortunes };
    // Invalid libraries remain visible for one-time correction, never silently replaced.
    if (data.blessings === undefined || data.fortunes === undefined) invalid();
    if (Buffer.byteLength(canonical(data)) > 16 * 1024 * 1024) invalid('DAILY_BOT_IMPORT_TOO_LARGE');
    const hash = digest(data);
    if (status && hash !== status.digest) invalid('DAILY_BOT_SOURCE_CHANGED');
    draft = { id: status?.id || randomUUID(), sourceHash, data, digest: hash,
      expectedRevision: settings.takeover.revision - (status ? 1 : 0) };
    return { draftId: draft.id, summary: summary(), blessings: data.blessings, fortunes: data.fortunes,
      cutoffAt: data.cutoffAt, digest: hash, resumed: Boolean(status) };
  }
  async function unchanged(captured, item, startedRevision) {
    same(captured);
    if (digest(reader().read()) === item.sourceHash) return;
    if (startedRevision !== undefined) {
      await call(captured, 'cancel', { id: item.id, body: { expectedRevision: startedRevision } });
    }
    draft = null; invalid('DAILY_BOT_SOURCE_CHANGED');
  }
  async function apply(captured, input) {
    exact(input, ['draftId']);
    const item = draft;
    if (!item || item.id !== input.draftId) invalid('DAILY_BOT_DRAFT_REQUIRED');
    await unchanged(captured, item);
    const { data } = item;
    const totalBatches = Math.max(1, Math.ceil(data.checkins.length / 250));
    const state = sanitizeTakeover(await call(captured, 'start', { body: {
      id: item.id, sourceId: data.sourceId, cutoffAt: data.cutoffAt, digest: item.digest,
      totalRows: data.checkins.length, totalBatches, libraryChoice: data.libraryChoice,
      expectedRevision: item.expectedRevision, legacyStoppedConfirmed: true, ownershipConfirmed: true,
    } }));
    const status = await call(captured, 'status', { id: item.id });
    if (status.status !== 'committed') {
      for (let sequence = 0; sequence < totalBatches; sequence++) {
        same(captured);
        const body = { checkins: data.checkins.slice(sequence * 250, (sequence + 1) * 250),
          ...(sequence === 0 ? { blessings: data.blessings, fortunes: data.fortunes } : {}) };
        await call(captured, 'upload', { id: item.id, sequence, body });
      }
      const preflight = await call(captured, 'preflight', { id: item.id, body: {} });
      if (preflight.valid !== true) return { data: await read(captured), preflight: safePreflight(preflight) };
      await unchanged(captured, item, state.revision);
    }
    await call(captured, 'commit', { id: item.id, body: { expectedRevision: state.revision } });
    // A lost commit response is retried with the same ID and receipt, never a new base.
    if (digest(reader().read()) !== item.sourceHash) invalid('DAILY_BOT_COMMITTED_SOURCE_CHANGED');
    draft = null;
    return { data: await read(captured), imported: true };
  }
  async function invoke(request) {
    exact(request, ['action', 'contextId', 'payload'], ['action']);
    const captured = context();
    if (!captured) invalid('LICENSE_NOT_AUTHORIZED');
    if (request.action !== 'open' && request.contextId !== captured.id) invalid('DAILY_BOT_ACCOUNT_CHANGED');
    if (busy) invalid('DAILY_BOT_BUSY');
    busy = true;
    try {
      const input = request.payload || {}; let result;
      switch (request.action) {
        case 'open': exact(input, []); result = { data: await read(captured) }; break;
        case 'summary': exact(input, []); result = { summary: summary() }; break;
        case 'update': {
          exact(input, ['kind', 'enabled', 'expectedRevision']);
          if (!['checkin', 'fortune'].includes(input.kind) || typeof input.enabled !== 'boolean' ||
            !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) invalid();
          result = { data: sanitizeSettings(await call(captured, 'update', { kind: input.kind,
            body: { enabled: input.enabled, expectedRevision: input.expectedRevision } })) }; break;
        }
        case 'decide': {
          exact(input, ['decision', 'expectedRevision', 'legacyStoppedConfirmed']);
          if (!['no-legacy', 'fresh-start'].includes(input.decision) || input.legacyStoppedConfirmed !== true ||
            !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) invalid();
          if (input.decision === 'no-legacy' && (summary().count || summary().customLibraries)) invalid('DAILY_BOT_LEGACY_PRESENT');
          await call(captured, 'decide', { body: input }); result = { data: await read(captured) }; break;
        }
        case 'prepare': result = await prepare(captured, input); break;
        case 'apply': result = await apply(captured, input); break;
        case 'cancel': {
          exact(input, ['id', 'expectedRevision']);
          if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) invalid();
          await call(captured, 'cancel', { id: input.id, body: { expectedRevision: input.expectedRevision } });
          draft = null; result = { data: await read(captured) }; break;
        }
        default: invalid();
      }
      same(captured);
      return { ...result, contextId: captured.id, accountName: String(licenseManager.getCloudSyncIdentity()?.accountName || '') };
    } finally { busy = false; }
  }
  return { invoke, dispose() { disposed = true; current = null; draft = null; unsubscribe?.(); } };
}
function safePreflight(value) {
  return { valid: false, issues: Array.isArray(value.issues) ? value.issues.slice(0, 100).map((item) => ({
    field: ['cutoffAt', 'checkins', 'checkin', 'fortune'].includes(item.field) ? item.field : 'checkins',
    index: Number.isSafeInteger(item.index) && item.index >= 0 ? item.index : 0,
    reason: ['invalid-date', 'invalid-or-duplicate-uid', 'invalid-record', 'invalid-library', 'invalid-entry', 'reply-too-long'].includes(item.reason) ? item.reason : 'invalid-entry',
  })) : [] };
}
module.exports = { createDailyBotController };
