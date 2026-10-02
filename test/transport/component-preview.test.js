'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { createComponentPreviewSessions, SESSION_TTL_MS } = require('../../src/server/component-preview-sessions');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { normalizeSceneDocument, MAX_SCENE_BYTES } = require('../../src/scenes/scene-contract');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { DANMAKU_STYLE_OPTIONS } = require('../../src/shared/danmaku-style-options');
const { createLayout } = require('../../src/shared/danmaku-layout');

const state = (draft = { label: '示例' }) => ({ draft, saved: draft, generation: 0, loaded: true });

test('A03: UTF-8 scene pairs fit open/edit/exchange while documents and envelopes remain bounded', async t => {
  const fixture = await startComponentPreviewServer();
  t.after(fixture.close);
  const config = normalizeSceneConfig('danmaku', { style: 'signal', fullscreenDurationSeconds: 6, layout: createLayout(),
    styleOptions: Object.fromEntries(Object.keys(DANMAKU_STYLE_OPTIONS).map(style => [style, { fontFamily: '"' + '测'.repeat(250) + '"' }])) });
  const document = normalizeSceneDocument({ schemaVersion: 1, id: randomUUID(), title: '大小边界', canvas: { width: 1920, height: 1080 },
    items: Array.from({ length: 32 }, () => ({ id: randomUUID(), type: 'danmaku', name: '弹幕', x: 0, y: 0,
      width: 320, height: 180, visible: true, locked: false, appearance: { mode: 'independent', config } })) },
  { normalizeConfig: normalizeSceneConfig });
  const bytes = Buffer.byteLength(JSON.stringify(document));
  assert.ok(bytes > MAX_SCENE_BYTES * 0.75 && bytes <= MAX_SCENE_BYTES);
  const draft = { ...structuredClone(document), title: '不同的草稿' };
  const pair = { ...state({ document }), draft: { document: draft } };
  const opened = await fixture.post({ action: 'open', component: 'canvas', state: pair });
  assert.equal(opened.status, 200);
  const { id, token } = opened.data;
  assert.equal((await fixture.post({ action: 'edit', id, change: { document: draft } }, token)).status, 200);
  const exchanged = await fixture.post({ action: 'exchange', id, state: pair, ack: 0 });
  assert.equal(exchanged.status, 200);
  assert.deepEqual(exchanged.data.commands[0].change.document, draft);
  const read = await fixture.post({ action: 'read', id }, token);
  assert.deepEqual(read.data.state.saved.document, document);
  assert.deepEqual(read.data.state.draft.document, draft);
  const oversized = { ...draft, title: '测'.repeat(MAX_SCENE_BYTES / 2) };
  assert.equal((await fixture.post({ action: 'edit', id, change: { document: oversized } }, token)).status, 413);
  assert.equal((await fixture.post({ action: 'exchange', id, state: state({ document: oversized }), ack: 0 })).status, 413);
  const { MAX_PREVIEW_REQUEST_BYTES } = require('../../src/server/component-preview-sessions');
  assert.equal((await fixture.post({ action: 'read', id, junk: 'x'.repeat(MAX_PREVIEW_REQUEST_BYTES) }, token)).status, 413);
  assert.equal((await fixture.post({ action: 'read', id }, token)).status, 200);
});

test('preview commands are ordered, bounded and removed only by the desktop acknowledgement', () => {
  const sessions = createComponentPreviewSessions();
  const session = sessions.open({ component: 'clock', state: state() });
  const command = (action, change) => sessions.browser({ id: session.id, action, change }, session.token);
  command('edit', { label: '改动' });
  command('save');
  const exchange = (ack) => sessions.exchange({ id: session.id, ack, state: state() });
  assert.deepEqual(exchange(0).commands.map(item => item.action), ['edit', 'save']);
  assert.deepEqual(exchange(0).commands.map(item => item.sequence), [1, 2]);
  assert.deepEqual(exchange(1).commands.map(item => item.action), ['save']);
  assert.deepEqual(exchange(2).commands, []);
  assert.throws(() => exchange(1), { statusCode: 400 });
  assert.throws(() => command('edit', { adminToken: 'forged' }), { statusCode: 400 });
  assert.throws(() => command('setTime'), { statusCode: 400 });
  for (let i = 0; i < 64; i++) command('edit', { label: String(i) });
  assert.throws(() => command('save'), { statusCode: 429 });
});

test('capabilities suspend with inactivity and expire with identity and generation changes', () => {
  let time = 0;
  let owner = { scope: 'synthetic-a', epoch: 1 };
  const sessions = createComponentPreviewSessions({ now: () => time, getOwner: () => owner });
  const open = (component = 'clock') => sessions.open({ component, state: state() });
  const first = open();
  const other = open('queue');
  assert.throws(() => sessions.browser({ id: first.id, action: 'read' }, other.token), { statusCode: 403 });
  assert.throws(() => sessions.browser({ id: first.id, action: 'read' }, ''), { statusCode: 403 });
  time = SESSION_TTL_MS + 1;
  assert.throws(() => sessions.browser({ id: first.id, action: 'read' }, first.token), { statusCode: 503 });
  const second = open();
  owner = { scope: 'synthetic-b', epoch: 2 };
  assert.throws(() => sessions.browser({ id: second.id, action: 'read' }, second.token), { statusCode: 410 });
  const third = open();
  assert.throws(() => sessions.exchange({ id: third.id, ack: 0, state: { ...state(), generation: 1 } }), { statusCode: 410 });
  const fourth = open();
  open();
  assert.throws(() => sessions.browser({ id: fourth.id, action: 'read' }, fourth.token), { statusCode: 410 });
});

test('authenticated browser activity keeps an editor alive while desktop exchanges pause', () => {
  let time = 0;
  let owner = 'first';
  const sessions = createComponentPreviewSessions({ now: () => time, getOwner: () => owner });
  const session = sessions.open({ component: 'clock', state: state() });
  const browser = action => sessions.browser({ id: session.id, action }, session.token);
  for (let minute = 0; minute < 180; minute++) {
    time += 60000;
    assert.equal(browser('read').state.loaded, true);
  }
  browser('save');
  assert.equal(sessions.exchange({ id: session.id, ack: 0, state: state() }).commands.length, 1);
  owner = 'second';
  assert.throws(() => browser('read'), { statusCode: 410 });
});

test('invalid capabilities cannot renew the inactivity lease', () => {
  let time = 0;
  const sessions = createComponentPreviewSessions({ now: () => time });
  const session = sessions.open({ component: 'clock', state: state() });
  time = SESSION_TTL_MS - 1;
  assert.throws(() => sessions.browser({ id: session.id, action: 'read' }, 'a'.repeat(64)), { statusCode: 403 });
  time += 2;
  assert.throws(() => sessions.browser({ id: session.id, action: 'read' }, session.token), { statusCode: 503 });
});

test('ten minutes without browser activity stays editable while the desktop remains connected', () => {
  let time = 0;
  const sessions = createComponentPreviewSessions({ now: () => time });
  const session = sessions.open({ component: 'clock', state: state() });
  for (let minute = 0; minute < 10; minute++) {
    time += 60000;
    sessions.exchange({ id: session.id, ack: 0, state: state() });
  }
  assert.equal(sessions.browser({ id: session.id, action: 'read' }, session.token).state.loaded, true);
  assert.equal(sessions.browser({ id: session.id, action: 'edit', change: { label: 'back from a break' } }, session.token).sequence, 1);
});

test('only the original desktop can resume a suspended lease without losing pending commands', () => {
  let time = 0;
  const sessions = createComponentPreviewSessions({ now: () => time });
  const session = sessions.open({ component: 'clock', state: state() });
  const browser = (body) => sessions.browser({ id: session.id, ...body }, session.token);
  browser({ action: 'edit', commandId: 1, change: { label: 'pending' } });
  time += 10 * 60000;
  assert.throws(() => sessions.browser({ id: session.id, action: 'read' }, 'a'.repeat(64)), { statusCode: 403 });
  for (const action of ['read', 'edit', 'attach']) {
    assert.throws(() => browser({ action, change: { label: 'too early' },
      attachmentId: randomUUID(), previousAttachmentId: null }), { statusCode: 503 });
  }
  const resumed = sessions.exchange({ id: session.id, ack: 0, state: state() });
  assert.deepEqual(resumed.commands.map(command => command.change.label), ['pending']);
  assert.equal(browser({ action: 'edit', commandId: 2, change: { label: 'continued' } }).sequence, 2);
  sessions.revoke(session.id);
  assert.throws(() => sessions.exchange({ id: session.id, ack: 0, state: state() }), { statusCode: 410 });
  assert.throws(() => browser({ action: 'attach', attachmentId: randomUUID(), previousAttachmentId: null }), { statusCode: 410 });
});

test('page attachments fence late requests and reset replay IDs without dropping accepted commands', () => {
  const sessions = createComponentPreviewSessions();
  const session = sessions.open({ component: 'canvas', state: state() });
  const browser = (body) => sessions.browser({ id: session.id, ...body }, session.token);
  const firstId = randomUUID();
  const secondId = randomUUID();
  const firstAttach = { action: 'attach', attachmentId: firstId, previousAttachmentId: null };
  const first = browser(firstAttach);
  assert.equal(first.attachmentId, firstId);
  assert.deepEqual(browser(firstAttach), first, 'A lost attach response must be safe to retry.');
  assert.equal(browser({ action: 'edit', attachmentId: firstId, commandId: 1, change: { label: 'before refresh' } }).sequence, 1);
  const secondAttach = { action: 'attach', attachmentId: secondId, previousAttachmentId: firstId };
  const second = browser(secondAttach);
  assert.equal(second.ack, 0);
  assert.equal(second.sequence, 1, 'The next page must wait for accepted commands before restoring drafts.');
  assert.throws(() => browser(firstAttach), { statusCode: 409 });
  assert.throws(() => browser({ ...secondAttach, attachmentId: randomUUID() }), { statusCode: 409 });
  for (const action of ['read', 'edit', 'save', 'publish', 'close']) {
    assert.throws(() => browser({ action, attachmentId: firstId, commandId: 2, change: { label: 'late' } }), { statusCode: 409 });
  }
  assert.throws(() => browser({ action: 'close' }), { statusCode: 409 });
  assert.throws(() => browser({ action: 'edit', change: { label: 'untagged' } }), { statusCode: 409 });
  assert.equal(browser({ action: 'read' }).attachmentId, secondId);
  const edit = { action: 'edit', attachmentId: secondId, commandId: 1, change: { label: 'after refresh' } };
  assert.equal(browser(edit).sequence, 2);
  browser(secondAttach);
  assert.equal(browser(edit).sequence, 2, 'An attach retry must not reset mutation replay receipts.');
  const commands = sessions.exchange({ id: session.id, ack: 0, state: state() }).commands;
  assert.deepEqual(commands.map(command => command.change.label), ['before refresh', 'after refresh']);
  sessions.exchange({ id: session.id, ack: 2, state: state({ label: 'after refresh' }) });
  assert.equal(browser(edit).sequence, 2);
  browser({ action: 'close', attachmentId: secondId });
  assert.throws(() => browser({ action: 'attach', attachmentId: randomUUID(), previousAttachmentId: secondId }), { statusCode: 410 });
});

test('draft recovery keys survive reopening but separate accounts and scenes without granting authority', () => {
  let owner = { scope: 'account-a', epoch: 1 };
  const sessions = createComponentPreviewSessions({ getOwner: () => owner });
  const open = (id = 'scene-a') => sessions.open({ component: 'canvas', state: state({ document: { id } }) });
  const first = open();
  assert.match(first.draftKey, /^[a-f0-9]{64}$/);
  assert.equal(sessions.browser({ id: first.id, action: 'read' }, first.token).draftKey, first.draftKey);
  const second = open();
  assert.equal(second.draftKey, first.draftKey);
  assert.throws(() => sessions.browser({ id: first.id, action: 'read' }, first.token), { statusCode: 410 });
  assert.throws(() => sessions.browser({ id: second.id, action: 'read' }, second.draftKey), { statusCode: 403 });
  assert.notEqual(open('scene-b').draftKey, first.draftKey);
  owner = { scope: 'account-a', epoch: 2 };
  assert.equal(open().draftKey, first.draftKey);
  owner = { scope: 'account-b', epoch: 3 };
  assert.notEqual(open().draftKey, first.draftKey);
});

test('retried mutations keep their sequence after acknowledgement and never run again', () => {
  const sessions = createComponentPreviewSessions();
  const session = sessions.open({ component: 'canvas', state: state() });
  const command = (action, commandId, change) => sessions.browser({ id: session.id, action, commandId, change }, session.token);
  let ack = 0;
  for (const action of ['edit', 'save', 'discard', 'publish', 'source']) {
    const id = ack + 1;
    const change = action === 'edit' ? { label: 'changed' } : undefined;
    const first = command(action, id, change);
    assert.deepEqual(command(action, id, change), first);
    assert.equal(sessions.exchange({ id: session.id, ack, state: state() }).commands.length, 1);
    ack = first.sequence;
    sessions.exchange({ id: session.id, ack, state: state() });
    assert.deepEqual(command(action, id, change), first);
    assert.equal(sessions.exchange({ id: session.id, ack, state: state() }).commands.length, 0);
  }
  assert.throws(() => command('save', 1), { statusCode: 409 });
  for (const invalid of [0, -1, 1.5, '6']) assert.throws(() => command('save', invalid), { statusCode: 400 });
  sessions.revoke(session.id);
  assert.throws(() => command('source', ack), { statusCode: 410 });
});

test('closing the browser drains accepted edits and saves before the desktop releases the session', () => {
  const sessions = createComponentPreviewSessions();
  const session = sessions.open({ component: 'clock', state: state() });
  sessions.browser({ id: session.id, action: 'edit', change: { label: 'pending' } }, session.token);
  sessions.browser({ id: session.id, action: 'save' }, session.token);
  sessions.browser({ id: session.id, action: 'close' }, session.token);
  assert.throws(() => sessions.browser({ id: session.id, action: 'read' }, session.token), { statusCode: 410 });
  const update = sessions.exchange({ id: session.id, state: state(), ack: 0 });
  assert.equal(update.closed, true);
  assert.deepEqual(update.commands.map(item => item.action), ['edit', 'save']);
  sessions.revoke(session.id);
  assert.throws(() => sessions.exchange({ id: session.id, state: state(), ack: 2 }), { statusCode: 410 });
});

test('only canvas capabilities can queue bound publication and source operations', () => {
  const sessions = createComponentPreviewSessions();
  const canvas = sessions.open({ component: 'canvas', state: state({ document: { canvas: { width: 1920, height: 1080 }, items: [] } }) });
  const clock = sessions.open({ component: 'clock', state: state() });
  assert.throws(() => sessions.browser({ id: canvas.id, action: 'read' }, clock.token), { statusCode: 403 });
  assert.throws(() => sessions.browser({ id: clock.id, action: 'edit', change: { label: 'forged' } }, canvas.token), { statusCode: 403 });
  for (const action of ['create', 'rotate']) {
    assert.throws(() => sessions.browser({ id: canvas.id, action }, canvas.token), { statusCode: 400 });
  }
  for (const action of ['publish', 'source']) {
    assert.throws(() => sessions.browser({ id: clock.id, action }, clock.token), { statusCode: 400 });
    assert.ok(sessions.browser({ id: canvas.id, action }, canvas.token).sequence > 0);
  }
  assert.deepEqual(sessions.exchange({ id: canvas.id, state: state({ document: {} }), ack: 0 })
    .commands.map(command => command.action), ['publish', 'source']);
  assert.throws(() => sessions.browser({ id: canvas.id, action: 'edit', change: { title: 'wrong field' } }, canvas.token), { statusCode: 400 });
});

test('browser preview never receives admin authority or bypasses Host/Origin protection', async (t) => {
  const fixture = await startComponentPreviewServer();
  t.after(fixture.close);
  assert.equal((await fixture.post({ action: 'open', component: 'clock', state: state() }, '')).status, 401);
  const { data: session } = await fixture.post({ action: 'open', component: 'clock', state: state() });
  assert.equal((await fixture.post({ action: 'read', id: session.id }, session.token)).status, 200);
  assert.equal((await fixture.post({ action: 'open', component: 'queue', state: state() }, session.token)).status, 401);
  assert.equal((await fixture.post({ action: 'exchange', id: session.id, ack: 0, state: state() }, session.token)).status, 401);
  for (const origin of ['null', 'https://untrusted.example']) {
    assert.equal((await fixture.post({ action: 'read', id: session.id }, session.token, { Origin: origin })).status, 403);
  }
  const admin = await fetch(`${fixture.origin}/admin`);
  assert.equal(admin.status, 401);
  const settings = await fetch(`${fixture.origin}/api/settings`, { method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(settings.status, 401);
  const preview = await fetch(`${fixture.origin}/component-preview?component=clock`);
  assert.equal(preview.status, 200);
  const html = await preview.text();
  assert.match(html, /componentPreviewTemplates/);
  assert.doesNotMatch(html, /__API_TOKEN__|lira-overlay-bootstrap|synthetic-desktop-component-preview-token/);
  assert.equal(preview.headers.get('x-frame-options'), 'DENY');
  const direct = await fetch(`${fixture.origin}/component-preview`);
  assert.equal(direct.status, 200);
  assert.match(await direct.text(), /data-clock-style-option/);
  const frame = await fetch(`${fixture.origin}/clock?componentPreview=1`);
  assert.equal(frame.status, 200);
  assert.doesNotMatch(await frame.text(), /lira-overlay-bootstrap/);
  assert.equal((await fixture.post({ action: 'edit', id: session.id, change: { label: 'x'.repeat(270000) } }, session.token)).status, 413);
});
