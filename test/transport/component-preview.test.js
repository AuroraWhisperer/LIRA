'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createComponentPreviewSessions, SESSION_TTL_MS } = require('../../src/server/component-preview-sessions');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const state = (draft = { label: '示例' }) => ({ draft, saved: draft, generation: 0, loaded: true });

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

test('capabilities isolate components and expire with the parent heartbeat, identity and generation', () => {
  let time = 0;
  let owner = { scope: 'synthetic-a', epoch: 1 };
  const sessions = createComponentPreviewSessions({ now: () => time, getOwner: () => owner });
  const open = (component = 'clock') => sessions.open({ component, state: state() });
  const first = open();
  const other = open('queue');
  assert.throws(() => sessions.browser({ id: first.id, action: 'read' }, other.token), { statusCode: 403 });
  assert.throws(() => sessions.browser({ id: first.id, action: 'read' }, ''), { statusCode: 403 });
  time = SESSION_TTL_MS + 1;
  assert.throws(() => sessions.browser({ id: first.id, action: 'read' }, first.token), { statusCode: 410 });
  const second = open();
  owner = { scope: 'synthetic-b', epoch: 2 };
  assert.throws(() => sessions.browser({ id: second.id, action: 'read' }, second.token), { statusCode: 410 });
  const third = open();
  assert.throws(() => sessions.exchange({ id: third.id, ack: 0, state: { ...state(), generation: 1 } }), { statusCode: 410 });
  const fourth = open();
  open();
  assert.throws(() => sessions.browser({ id: fourth.id, action: 'read' }, fourth.token), { statusCode: 410 });
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
