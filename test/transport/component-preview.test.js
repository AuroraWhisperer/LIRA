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

test('canvas edit baselines are bounded UUID metadata and remain optional for older clients', () => {
  const sessions = createComponentPreviewSessions();
  const document = { id: randomUUID(), items: [] };
  const canvas = sessions.open({ component: 'canvas', state: state({ document }) });
  const send = command => sessions.browser({ id: canvas.id, action: 'edit', change: { document }, ...command }, canvas.token);
  const baseItemIds = [randomUUID()];
  send({ baseItemIds });
  send({});
  const { commands } = sessions.exchange({ id: canvas.id, state: state({ document }), ack: 0 });
  assert.deepEqual(commands[0].baseItemIds, baseItemIds);
  assert.equal(Object.hasOwn(commands[1], 'baseItemIds'), false);
  for (const invalid of [null, {}, ['invalid'], [42]]) assert.throws(() => send({ baseItemIds: invalid }), { statusCode: 400 });
  assert.throws(() => send({ action: 'save', baseItemIds }), { statusCode: 400 });
  assert.throws(() => send({ baseItemIds: ['x'.repeat(MAX_SCENE_BYTES)] }), { statusCode: 413 });
  const clock = sessions.open({ component: 'clock', state: state() });
  assert.throws(() => sessions.browser({ id: clock.id, action: 'edit', change: { label: 'changed' }, baseItemIds }, clock.token), { statusCode: 400 });
});

test('preview focus needs management authority and confirmation from the current page', async t => {
  const fixture = await startComponentPreviewServer();
  t.after(() => fixture.close());
  const { data: canvas } = await fixture.post({ action: 'open', component: 'canvas', state: state() });
  const { data: { key } } = await fixture.post({ action: 'link', links: [canvas], selectedId: 'opening' });
  for (const token of [canvas.token, key]) {
    assert.equal((await fixture.post({ action: 'focus', key }, token)).status, 401);
  }
  assert.deepEqual((await fixture.post({ action: 'focus', key })).data, { focused: false });
  assert.equal((await fixture.post({ action: 'focus', key: 'x'.repeat(22) })).status, 410);

  const sessions = createComponentPreviewSessions();
  const local = sessions.open({ component: 'canvas', state: state() });
  const linked = sessions.link({ links: [local], selectedId: 'opening' });
  const attachmentId = randomUUID();
  const browser = body => sessions.browser({ id: local.id, attachmentId, ...body }, local.token);
  browser({ action: 'attach', previousAttachmentId: null });
  const pending = sessions.focus(linked);
  const { focus } = browser({ action: 'read' });
  assert.equal(focus.selectedId, 'opening');
  assert.equal(focus.selectedSize, null);
  assert.equal(browser({ action: 'read', attachmentId: undefined, focusId: focus.id }).focus.id, focus.id,
    'An unbound startup read cannot confirm delivery.');
  assert.throws(() => browser({ action: 'read', attachmentId: randomUUID(), focusId: focus.id }), { statusCode: 409 });
  assert.equal(browser({ action: 'read', focusId: 'wrong' }).focus.id, focus.id);
  assert.equal(Object.hasOwn(browser({ action: 'read', focusId: focus.id }), 'focus'), false);
  assert.deepEqual(await pending, { focused: true });
  assert.equal(sessions.exchange({ id: local.id, state: state(), ack: 0 }).commands.length, 0);
});

test('preview focus expires or is cancelled without discarding drafts and accepted edits', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sessions = createComponentPreviewSessions();
  t.after(() => sessions.clear());
  const canvas = sessions.open({ component: 'canvas', state: state() });
  const link = sessions.link({ links: [canvas] });
  const attachmentId = randomUUID();
  const browser = body => sessions.browser({ id: canvas.id, attachmentId, ...body }, canvas.token);
  browser({ action: 'attach', previousAttachmentId: null });
  browser({ action: 'edit', change: { label: 'pending' } });
  const expired = sessions.focus(link);
  const oldId = browser({ action: 'read' }).focus.id;
  t.mock.timers.tick(2000);
  assert.deepEqual(await expired, { focused: false });
  assert.equal(Object.hasOwn(browser({ action: 'read' }), 'focus'), false);
  const superseded = sessions.focus(link);
  const latest = sessions.focus(link);
  assert.deepEqual(await superseded, { focused: false });
  assert.notEqual(browser({ action: 'read', focusId: oldId }).focus.id, oldId);
  browser({ action: 'attach', attachmentId: randomUUID(), previousAttachmentId: attachmentId });
  assert.deepEqual(await latest, { focused: false });
  assert.equal(sessions.exchange({ id: canvas.id, state: state(), ack: 0 }).commands[0].change.label, 'pending');
  const revoked = sessions.focus(link);
  sessions.revoke(canvas.id);
  assert.deepEqual(await revoked, { focused: false });
});

test('canvas preset relay only selects desktop-listed presets and isolates their recovery keys', () => {
  const sessions = createComponentPreviewSessions();
  const first = randomUUID();
  const second = randomUUID();
  const initial = { ...state({ document: { id: first } }),
    presets: [{ id: first, title: 'First' }, { id: second, title: 'Second' }] };
  const canvas = sessions.open({ component: 'canvas', state: initial });
  const linked = sessions.link({ links: [canvas], selectedId: 'text-box' });
  const select = id => sessions.browser({ id: canvas.id, action: 'preset', change: { action: 'select', id } }, canvas.token);
  assert.throws(() => select(randomUUID()), { statusCode: 400 });
  const accepted = select(second);
  const exchanged = sessions.exchange({ id: canvas.id, state: initial, ack: 0 });
  assert.deepEqual(exchanged.commands, [{ sequence: accepted.sequence, action: 'preset', change: { action: 'select', id: second } }]);
  sessions.exchange({ id: canvas.id, state: { ...initial, ...state({ document: { id: second } }) }, ack: accepted.sequence });
  const current = sessions.browser({ id: canvas.id, action: 'read' }, canvas.token);
  assert.notEqual(current.draftKey, canvas.draftKey);
  const resolved = sessions.resolveLink(linked.key);
  assert.equal(resolved.selectedId, null, 'Refreshing an old entry must not add its component to another preset.');
  assert.equal(resolved.links[0].draftKey, current.draftKey);
  const remove = id => sessions.browser({ id: canvas.id, action: 'preset', change: { action: 'delete', id } }, canvas.token);
  assert.throws(() => remove(first), { statusCode: 400 }, 'Deletion must target the selected preset.');
  assert.throws(() => remove(randomUUID()), { statusCode: 400 });
  const deleted = remove(second);
  assert.deepEqual(sessions.exchange({ id: canvas.id, state: { ...initial, ...state({ document: { id: second } }) },
    ack: accepted.sequence }).commands, [{ sequence: deleted.sequence, action: 'preset', change: { action: 'delete', id: second } }]);
  const clock = sessions.open({ component: 'clock', state: state() });
  assert.throws(() => sessions.browser({ id: clock.id, action: 'preset', change: { action: 'select', id: first } }, clock.token), { statusCode: 400 });
});

test('short editor links resolve only their verified sessions and cannot grant management authority', async t => {
  let owner = { scope: 'short-link-owner', epoch: 1 };
  const fixture = await startComponentPreviewServer({ getOwner: () => owner });
  t.after(() => fixture.close());
  const { data: clock } = await fixture.post({ action: 'open', component: 'clock', state: state() });
  const { data: canvas } = await fixture.post({ action: 'open', component: 'canvas', state: state() });
  assert.equal((await fixture.post({ action: 'link', links: [clock, canvas] }, clock.token)).status, 401);
  assert.equal((await fixture.post({ action: 'link', links: [clock, { ...canvas, token: clock.token }] })).status, 403);
  assert.equal((await fixture.post({ action: 'link', links: [clock, clock] })).status, 400);
  const linked = await fixture.post({ action: 'link', links: [clock, canvas] });
  assert.equal(linked.status, 200);
  const { key } = linked.data;
  assert.match(key, /^[A-Za-z0-9_-]{22}$/);
  const resolved = await fixture.post({ action: 'resolve' }, key);
  assert.equal(resolved.status, 200);
  assert.deepEqual(resolved.data.links, [{ component: 'clock', ...clock }, { component: 'canvas', ...canvas }]);
  assert.equal((await fixture.post({ action: 'resolve' }, key, { Origin: 'https://untrusted.test' })).status, 403);
  assert.equal((await fixture.post({ action: 'resolve' }, key, { Origin: 'null' })).status, 403);
  assert.equal((await fixture.post({ action: 'resolve' }, 'x'.repeat(22))).status, 410);
  assert.equal((await fixture.post({ action: 'open', component: 'queue', state: state() }, key)).status, 401);
  assert.equal((await fixture.post({ action: 'read', id: canvas.id }, key)).status, 403);
  owner = { scope: 'other-owner', epoch: 2 };
  assert.equal((await fixture.post({ action: 'resolve' }, key)).status, 410);
});

test('compact links retain each entry selection and size while reusing the same component sessions', () => {
  const sessions = createComponentPreviewSessions();
  const links = ['clock', 'queue', 'canvas'].map(component => sessions.open({ component, state: state() }));
  const canvas = sessions.link({ links });
  const clock = sessions.link({ links, selectedId: 'clock', selectedSize: { width: 580, height: 210 } });
  const queue = sessions.link({ links, selectedId: 'queue' });
  assert.notEqual(canvas.key, clock.key);
  assert.notEqual(queue.key, clock.key);
  assert.equal(sessions.link({ links }).key, canvas.key);
  assert.equal(sessions.link({ links, selectedId: 'clock', selectedSize: { width: 800, height: 300 } }).key, clock.key);
  assert.deepEqual(sessions.resolveLink(clock.key), { links: links.map((entry, index) => ({
    ...entry, component: ['clock', 'queue', 'canvas'][index] })), selectedId: 'clock', selectedSize: { width: 800, height: 300 } });
  assert.equal(sessions.resolveLink(canvas.key).selectedId, null);
  assert.equal(sessions.resolveLink(queue.key).selectedId, 'queue');
  for (const selectedId of ['gift-frame', 'guard-thanks']) {
    const entry = sessions.link({ links, selectedId });
    assert.equal(sessions.resolveLink(entry.key).selectedId, selectedId);
    assert.throws(() => sessions.link({ links: [links[0]], selectedId }), { statusCode: 400 });
  }
  assert.equal(sessions.resolveLink(queue.key).selectedSize, null);
  for (const selection of [{ selectedId: 'danmaku' }, { selectedId: '__proto__' },
    { selectedSize: { width: 580, height: 210 } }, { selectedId: 'clock', selectedSize: { width: -1, height: 210 } },
    { selectedId: 'clock', selectedSize: { width: 580, height: 9000 } }]) {
    assert.throws(() => sessions.link({ links, ...selection }), { statusCode: 400 });
  }
  assert.equal(sessions.resolveLink(clock.key).selectedSize.width, 800);
});

test('short links expire when any bound component is closed, replaced or revoked', () => {
  for (const end of ['close', 'replace', 'revoke', 'generation', 'clear']) {
    const sessions = createComponentPreviewSessions();
    const clock = sessions.open({ component: 'clock', state: state() });
    const canvas = sessions.open({ component: 'canvas', state: state() });
    const { key } = sessions.link({ links: [clock, canvas] });
    if (end === 'close') sessions.browser({ id: clock.id, action: 'close' }, clock.token);
    if (end === 'replace') sessions.open({ component: 'clock', state: state() });
    if (end === 'revoke') sessions.revoke(clock.id);
    if (end === 'clear') sessions.clear();
    if (end === 'generation') assert.throws(() => sessions.exchange({ id: clock.id, ack: 0,
      state: { ...state(), generation: 1 } }), { statusCode: 410 });
    assert.throws(() => sessions.resolveLink(key), { statusCode: 410 });
  }
});

test('instance links retain distinct same-type selections and require the current canvas item and type', () => {
  const sessions = createComponentPreviewSessions();
  const items = [{ id: randomUUID(), type: 'text-box' }, { id: randomUUID(), type: 'text-box' },
    { id: randomUUID(), type: 'clock' }];
  const canvas = sessions.open({ component: 'canvas', state: state({ document: { items } }) });
  const clock = sessions.open({ component: 'clock', state: state() });
  const links = [clock, canvas];
  const select = (selectedItemId, selectedId = 'text-box') => sessions.link({ links, selectedId, selectedItemId });
  const first = select(items[0].id);
  const second = select(items[1].id);
  assert.notEqual(first.key, second.key);
  assert.equal(select(items[0].id).key, first.key);
  assert.equal(select(items[1].id).key, second.key);
  assert.equal(sessions.resolveLink(first.key).selectedItemId, items[0].id);
  assert.equal(sessions.resolveLink(second.key).selectedItemId, items[1].id);
  const generic = sessions.link({ links, selectedId: 'text-box' });
  assert.notEqual(generic.key, first.key);
  assert.equal(Object.hasOwn(sessions.resolveLink(generic.key), 'selectedItemId'), false);
  for (const id of [null, '', randomUUID(), items[2].id]) assert.throws(() => select(id), { statusCode: 400 });
  assert.throws(() => select(items[0].id, 'clock'), { statusCode: 400 });
  assert.throws(() => sessions.link({ links: [clock], selectedId: 'clock', selectedItemId: items[2].id }), { statusCode: 400 });
  sessions.exchange({ id: canvas.id, ack: 0, state: state({ document: { items: items.slice(0, 1) } }) });
  assert.throws(() => sessions.resolveLink(second.key), { statusCode: 400 });
  assert.equal(sessions.resolveLink(first.key).selectedItemId, items[0].id);
});
test('A03: UTF-8 scene pairs fit open/edit/exchange while documents and envelopes remain bounded', async t => {
  const fixture = await startComponentPreviewServer();
  t.after(fixture.close);
  const config = normalizeSceneConfig('danmaku', { style: 'signal', fullscreenDurationSeconds: 6, layout: createLayout(),
    styleOptions: Object.fromEntries(Object.keys(DANMAKU_STYLE_OPTIONS).map(style => [style, { fontFamily: '"' + '测'.repeat(200) + '"' }])) });
  const input = { schemaVersion: 1, id: randomUUID(), title: '大小边界', canvas: { width: 1920, height: 1080 }, items: [] };
  while (Buffer.byteLength(JSON.stringify(input)) < MAX_SCENE_BYTES * 0.8) {
    input.items.push({ id: randomUUID(), type: 'danmaku', name: '弹幕', x: 0, y: 0,
      width: 320, height: 180, visible: true, locked: false, appearance: { mode: 'independent', config } });
  }
  const document = normalizeSceneDocument(input, { normalizeConfig: normalizeSceneConfig });
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
  const { key } = sessions.link({ links: [session] });
  const browser = (body) => sessions.browser({ id: session.id, ...body }, session.token);
  browser({ action: 'edit', commandId: 1, change: { label: 'pending' } });
  time += 10 * 60000;
  assert.equal(sessions.resolveLink(key).links[0].id, session.id);
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
  const compact = await fetch(`${fixture.origin}/c`);
  assert.equal(compact.status, 200);
  assert.equal(compact.headers.get('x-frame-options'), 'DENY');
  assert.equal(await compact.text(), html);
  const direct = await fetch(`${fixture.origin}/component-preview`);
  assert.equal(direct.status, 200);
  assert.match(await direct.text(), /data-clock-style-option/);
  const frame = await fetch(`${fixture.origin}/clock?componentPreview=1`);
  assert.equal(frame.status, 200);
  assert.doesNotMatch(await frame.text(), /lira-overlay-bootstrap/);
  assert.equal((await fixture.post({ action: 'edit', id: session.id, change: { label: 'x'.repeat(270000) } }, session.token)).status, 413);
});
