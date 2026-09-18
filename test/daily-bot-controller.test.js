'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDailyBotController } = require('../src/electron/daily-bot-controller');
const { registerDailyBotIpc } = require('../src/electron/ipc/daily-bot-ipc');
const { digest, sanitizeSettings } = require('../src/shared/daily-bot-contract');
const fixture = require('./fixtures/daily-bots-v1.json');
function setup(t, remote) {
  let identity = { streamerId: 1, accountName: 'synthetic' }, listener;
  const source = { checkins: structuredClone(fixture.snapshot.checkins), blessings: fixture.snapshot.blessings, fortunes: fixture.snapshot.fortunes };
  const manager = { isAuthorized: () => Boolean(identity), getCloudSyncIdentity: () => identity,
    getRemoteBaseUrl: () => 'https://lira.test', getAuthorizationEpoch: () => identity?.streamerId,
    onStateChanged(fn) { listener = fn; return () => {}; }, dailyBotRequestInternal: remote };
  const controller = createDailyBotController({ licenseManager: manager, sourceLabel: 'synthetic-local-source',
    now: () => Date.parse(fixture.snapshot.cutoffAt), getLegacyReader: () => ({
      summary: () => ({ count: source.checkins.length, minDays: 128, maxDays: 128, lastDate: '2026-09-18', customLibraries: true }),
      read: () => structuredClone(source),
    }) });
  t.after(() => controller.dispose());
  return { controller, source, switchAccount() { identity = { streamerId: 2, accountName: 'second' }; listener(); } };
}
test('shared snapshot bytes agree with server fixture and settings strip extra fields', () => {
  assert.equal(digest(fixture.snapshot), fixture.digest);
  assert.deepEqual(sanitizeSettings({ ...fixture.defaultResponse, token: 'private' }), fixture.defaultResponse);
  assert.throws(() => sanitizeSettings({ ...fixture.defaultResponse, checkin: { enabled: true } }), /INVALID_RESPONSE/);
});
test('main rejects stale contexts and unconfirmed migration and discards late account responses', async (t) => {
  let resolve;
  const { controller, switchAccount } = setup(t, () => new Promise((done) => { resolve = done; }));
  const pending = controller.invoke({ action: 'open' });
  switchAccount(); resolve(fixture.defaultResponse);
  await assert.rejects(pending, /ACCOUNT_CHANGED/);
  await assert.rejects(controller.invoke({ action: 'decide', contextId: 'old' }), /ACCOUNT_CHANGED/);
});
test('migration stages only confirmed local snapshot, detects resumed old writers, and never adds a second base', async (t) => {
  const calls = []; let state = structuredClone(fixture.defaultResponse), importStatus = 'importing';
  const { controller, source } = setup(t, async (operation, input) => {
    calls.push({ operation, input });
    if (operation === 'read') return state;
    if (operation === 'start') return { ...state.takeover, state: 'importing', revision: 1, importId: input.body.id };
    if (operation === 'status') return { status: importStatus };
    if (operation === 'upload') return {};
    if (operation === 'preflight') { source.checkins[0].totalDays++; return { valid: true }; }
    if (operation === 'cancel') return { ...state.takeover, revision: 2 };
    throw Error(operation);
  });
  const opened = await controller.invoke({ action: 'open' });
  const invoke = (action, payload) => controller.invoke({ action, contextId: opened.contextId, payload });
  await assert.rejects(invoke('prepare', { legacyStoppedConfirmed: false, ownershipConfirmed: true, libraryChoice: { checkin: 'legacy', fortune: 'legacy' } }), /INVALID_REQUEST/);
  await assert.rejects(invoke('decide', { decision: 'no-legacy', expectedRevision: 0, legacyStoppedConfirmed: true }), /LEGACY_PRESENT/);
  const draft = await invoke('prepare', { legacyStoppedConfirmed: true, ownershipConfirmed: true, libraryChoice: { checkin: 'legacy', fortune: 'legacy' } });
  await assert.rejects(invoke('apply', { draftId: draft.draftId }), /SOURCE_CHANGED/);
  assert.ok(calls.some((call) => call.operation === 'cancel'));
  assert.equal(calls.some((call) => call.operation === 'commit'), false);
});
test('restricted IPC refuses other windows/frames/origins and never returns arbitrary errors', async () => {
  let handler, removed;
  const frame = { url: 'http://127.0.0.1:3000/admin' }, win = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const dispose = registerDailyBotIpc({ ipcMain: { handle: (_name, fn) => { handler = fn; }, removeHandler: (name) => { removed = name; } },
    controller: { invoke: () => { throw new Error('secret cookie'); }, dispose() {} }, getMainWindow: () => win,
    getDesktopBaseUrl: () => 'http://127.0.0.1:3000' });
  assert.equal((await handler({ sender: {}, senderFrame: frame }, {})).error, 'IPC_SOURCE_INVALID');
  assert.equal((await handler({ sender: win.webContents, senderFrame: { ...frame } }, {})).error, 'IPC_SOURCE_INVALID');
  assert.deepEqual(await handler({ sender: win.webContents, senderFrame: frame }, {}), { ok: false, error: 'DAILY_BOT_UNAVAILABLE' });
  frame.url = 'http://127.0.0.1:3000/playback';
  assert.equal((await handler({ sender: win.webContents, senderFrame: frame }, {})).error, 'IPC_SOURCE_INVALID');
  dispose(); assert.equal(removed, 'daily-bots:invoke');
});

test('a lost commit reply retries the original receipt without uploading or adding the base twice', async (t) => {
  const calls = []; let state = structuredClone(fixture.defaultResponse), startReceipt, committed = false, commits = 0;
  const { controller } = setup(t, async (operation, input) => {
    calls.push({ operation, input });
    if (operation === 'read') return state;
    if (operation === 'start') {
      startReceipt ||= { ...state.takeover, state: 'importing', revision: 1, importId: input.body.id };
      return startReceipt;
    }
    if (operation === 'status') return { status: committed ? 'committed' : 'importing' };
    if (operation === 'upload') return {};
    if (operation === 'preflight') return { valid: true };
    if (operation === 'commit') {
      commits++;
      if (committed) return state.takeover;
      committed = true;
      state = { ...state, takeover: { ...startReceipt, state: 'ready', revision: 2, decision: 'imported' } };
      throw new Error('synthetic lost response after commit');
    }
    throw new Error(operation);
  });
  const { contextId } = await controller.invoke({ action: 'open' });
  const invoke = (action, payload) => controller.invoke({ action, contextId, payload });
  const draft = await invoke('prepare', { legacyStoppedConfirmed: true, ownershipConfirmed: true,
    libraryChoice: { checkin: 'legacy', fortune: 'legacy' } });
  await assert.rejects(invoke('apply', { draftId: draft.draftId }), /lost response/);
  const result = await invoke('apply', { draftId: draft.draftId });
  assert.equal(result.imported, true);
  assert.equal(result.data.takeover.revision, 2);
  assert.equal(commits, 2);
  assert.equal(calls.filter((call) => call.operation === 'upload').length, 1);
  const starts = calls.filter((call) => call.operation === 'start');
  assert.deepEqual(starts[0].input, starts[1].input);
});
