'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { fanFixture } = require('../helpers/fan-profile-fixture');

const ROOT = path.join(__dirname, '../..');

function actionTags(markup, action) {
  return markup.match(new RegExp(`<[^>]+\\sdata-fan-action=["']${action}["'][^>]*>`, 'g')) || [];
}

test('expiry badges escape names and follow the current guard level', async () => {
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const profile = { id: 'expiry-fan', alias: '<很长的称呼>', currentGuardLevel: 3, summary: '摘要' };
  const expiry = { observedAt: '2026-10-12T04:00:00Z', badges: [{ profileId: profile.id, level: 3, days: 0 }] };
  const markup = view.renderPeople([profile], null, false, false, expiry);
  assert.match(markup, /&lt;很长的称呼&gt;/);
  assert.match(markup, /fan-expiry-badge/);
  assert.doesNotMatch(view.renderPeople([profile], null, false), /fan-expiry-badge/);
  for (const changed of [{ ...profile, archived: true }, { ...profile, currentGuardLevel: 2 }])
    assert.doesNotMatch(view.renderPeople([changed], null, false, false, expiry), /fan-expiry-badge/);
});

test('reminder view keeps recent groups and history without displaying distant predictions', async () => {
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const items = ['today', 'week', 'missed', 'history', 'later'].map((group) => ({
    profileId: 'fan-reminder-view', name: '测试粉丝', date: '2026-10-10',
    key: group, title: `reminder-${group}`, group, status: group === 'history' ? 'handled' : 'pending',
  }));
  const rendered = view.renderReminders(items);
  for (const group of ['today', 'week', 'missed', 'history']) assert.ok(rendered.includes(`reminder-${group}`));
  assert.doesNotMatch(rendered, /reminder-later|之后/);
});

test('reminders share one profile entry per day while each item keeps its own actions and escaped content', async () => {
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const person = { profileId: 'fan-id', name: '<小海>', date: '2026-10-10', group: 'today', status: 'pending' };
  const rendered = view.renderReminders([
    { ...person, key: 'birthday:2026', title: '生日', basis: '<公历生日>' },
    { ...person, key: 'accompany:1234:500', title: '陪伴满 500 天', predicted: true },
    { ...person, key: 'past', title: '往年生日', group: 'history', status: 'handled', date: '2025-10-10' },
  ]);
  const links = actionTags(rendered, 'open-reminder');
  assert.equal(links.length, 2, 'same person and day share a single profile entry');
  assert.ok(links.every((tag) => tag.includes('data-profile-id="fan-id"')));
  assert.match(rendered, /&lt;公历生日&gt;/);
  assert.doesNotMatch(rendered, /<小海>|<公历生日>/);
  for (const state of ['handled', 'snoozed', 'ignored']) {
    assert.deepEqual(actionTags(rendered, `reminder-${state}`).map((tag) =>
      tag.match(/data-reminder-key="([^"]+)"/)[1]), ['birthday:2026', 'accompany:1234:500']);
  }
});

test('people and detail escape platform and former names while former names remain editable', async (t) => {
  const f = fanFixture(t);
  const p = f.create({ formerNames: ['<旧昵称>', '较早昵称'] });
  f.consume([{ name: '<新昵称>' }]);
  const profile = f.detail(p.id);
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const rendered = view.renderPeople([profile], p.id, false);
  assert.match(rendered, /&lt;新昵称&gt;/);
  assert.doesNotMatch(rendered, /<新昵称>/);
  const detail = view.renderDetail(profile);
  assert.match(detail, /&lt;新昵称&gt;/);
  assert.doesNotMatch(detail, /<旧昵称>|<新昵称>/);
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'), {
    FormData: class {
      constructor(form) {
        return Object.entries(form);
      }
    },
  });
  const description = forms.profileForm(profile);
  assert.match(description.fields, /<textarea\b[^>]*\sname=["']formerNames["'][^>]*>&lt;旧昵称&gt;\n较早昵称/);
  const payload = description.read({
    alias: '', tags: '', formerNames: ' 修订名字\n较早昵称\n', identityValue: profile.identity.value,
  });
  assert.deepEqual(Array.from(payload.formerNames), ['修订名字', '较早昵称']);
  const saved = f.run('save', payload);
  assert.deepEqual(saved.formerNames, ['修订名字', '较早昵称']);
  assert.equal(saved.platformName, '<新昵称>');
});

test('people names escape aliases and omit missing or duplicate platform names', async () => {
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const aliased = view.renderPeople([{ id: 'alias', alias: '<小海>', platformName: '海风' }], null, false);
  assert.match(aliased.replace(/<[^>]*>/g, ''), /&lt;小海&gt;（海风）/);
  assert.doesNotMatch(aliased, /<小海>/);
  for (const [alias, platformName, expected] of [
    ['', '海风', '海风'],
    ['海风', '海风', '海风'],
  ]) {
    const rendered = view.renderPeople([{ id: 'name', alias, platformName }], null, false);
    assert.equal(rendered.replace(/<[^>]*>/g, '').trim(), expected);
  }
});

test('manual profiles bind a UID while editing retains an existing open platform identity', async () => {
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'), {
    FormData: class { constructor(form) { return Object.entries(form); } },
  });
  const data = { alias: '小海', tags: '', formerNames: '', identityValue: '123', identityType: 'open_id' };
  assert.equal(forms.profileForm().read(data).identity.type, 'uid');
  const profile = { identity: { platform: 'bilibili', type: 'open_id', value: 'open-identity' } };
  assert.deepEqual({ ...forms.profileForm(profile).read({ ...data, identityValue: 'open-identity', identityType: 'uid' }).identity }, profile.identity);
});

test('daily update settings default off and return the selected values', async () => {
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'));
  const description = forms.settingsForm({});
  assert.equal(description.settingsEditor, true);
  assert.doesNotMatch(description.fields, /name="autoSyncGuardRoster"[^>]*checked/);
  assert.match(forms.settingsForm({ autoSyncGuardRoster: true }).fields, /name="autoSyncGuardRoster"[^>]*checked/);
  const values = description.read({
    elements: {
      autoUpdate: { checked: true },
      autoCreate: { checked: false },
      autoSyncGuardRoster: { checked: true },
      accompanyMilestones: { value: '100, 365，500 1000' },
      showAccompanyInCalendar: { checked: true },
    },
  });
  assert.equal(values.autoSyncGuardRoster, true);
  assert.equal(values.autoCreate, false);
  assert.deepEqual(Array.from(values.accompanyMilestones), [100, 365, 500, 1000]);
  assert.equal(values.showAccompanyInCalendar, true);
});

test('milestone chip editor adds, removes and validates days while dispatching change for autosave', async () => {
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'), { Event });
  const description = forms.settingsForm({ accompanyMilestones: [365, 100, 365] });
  assert.match(description.fields, /name="accompanyMilestones" value="100, 365"/);

  const listeners = (node) => {
    const map = new Map();
    return Object.assign(node, {
      addEventListener: (type, fn) => { map.set(type, [...(map.get(type) || []), fn]); },
      fire: (type, event = {}) => { for (const fn of map.get(type) || []) fn(event); },
    });
  };
  let changes = 0;
  const hidden = listeners({ value: '100, 365', dispatchEvent: (event) => { if (event.type === 'change' && event.bubbles) changes++; } });
  const list = { innerHTML: '' };
  const addButton = { hidden: false, focus() {} };
  const input = listeners({ value: '', focus() {} });
  const confirmButton = listeners({});
  const inlineWrap = listeners({ hidden: true, contains: () => false });
  const errorNode = { textContent: '', hidden: true };
  const box = listeners({
    querySelector: (selector) => ({
      'input[name="accompanyMilestones"]': hidden,
      '[data-milestone-list]': list,
      '[data-add-milestone]': addButton,
      '[data-milestone-inline]': inlineWrap,
      '[data-milestone-input]': input,
      '[data-milestone-confirm]': confirmButton,
    })[selector] || null,
    closest: () => ({ querySelector: () => errorNode }),
  });

  description.bind({ querySelector: (selector) => selector === '[data-milestones-editor]' ? box : null });

  box.fire('click', { target: { closest: (s) => s === '[data-add-milestone]' ? addButton : null } });
  assert.equal(inlineWrap.hidden, false);
  input.value = '0';
  input.fire('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(errorNode.hidden, false);
  assert.equal(changes, 0);

  input.value = '500';
  input.fire('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(hidden.value, '100, 365, 500');
  assert.equal(inlineWrap.hidden, true);
  assert.equal(changes, 1);

  box.fire('click', { target: { closest: (s) => s === '[data-remove-milestone]' ? { dataset: { removeMilestone: '365' } } : null } });
  assert.equal(hidden.value, '100, 500');
  assert.equal(changes, 2);
});

test('fan detail renders platform companion days independently of unknown local duration', async () => {
  const profile = {
    platformName: '测试粉丝', records: [],
    guardAccompany: { days: 499, observedAt: '2026-09-18T04:00:00.000Z' },
    membership: { status: 'unknown', totalDays: null, continuousDays: null },
  };
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const rendered = view.renderDetail(profile, 'membership');
  assert.match(rendered, /499 天/);
  assert.match(rendered, /累计在舰<\/dt><dd>未知/);
  assert.doesNotMatch(view.renderDetail({ ...profile, guardAccompany: null }, 'membership'), /499 天/);
});

test('an inactive observation is recorded without presenting it as a past membership', async t => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'membership', { type: 'observation', level: 3, status: 'inactive', observedAt: '2026-09-17T04:00:00Z' });
  const { renderDetail } = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const detail = renderDetail(f.detail(p.id), 'membership');
  assert.match(detail, /当时未在舰/);
  assert.doesNotMatch(detail, /上次上舰记录/);
});

test('roster notices separate success, skips and lookup failures and omit empty categories', async () => {
  const { rosterUpdateNotices } = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const result = { roomId: '1234', total: 30, created: 0, updated: 30, skipped: 0,
    profileRefresh: { updated: 2, skipped: 0, failed: 0 } };
  for (const skipped of [0, 1]) {
    for (const failed of [0, 1]) {
      const notices = rosterUpdateNotices({ ...result, skipped,
        skippedDetails: skipped ? [{ uid: '123', name: '小海', reason: 'archived' }] : [],
        profileRefresh: { updated: 2, skipped: 0, failed },
      });
      assert.deepEqual(Array.from(notices, n => n.type), ['success', ...(skipped ? ['info'] : []), ...(failed ? ['warning'] : [])]);
    }
  }
  const offRoster = rosterUpdateNotices({ ...result, profileRefresh: { updated: 0, skipped: 2, failed: 0 } });
  assert.equal(offRoster.length, 2);
});

test('global fan update polling reports incomplete or failed updates and stops after pagehide', async () => {
  const { initFanProfileAutoUpdate } = await loadModuleExports(
    path.join(ROOT, 'public/js/admin/fans/automatic-update.js'),
  );
  let result = { ok: true, data: { reason: 'scheduled', status: 'success', roomId: '1234', total: 3, created: 1, updated: 2, skipped: 0 } };
  const notices = [];
  const listeners = new Map();
  let cleared = false;
  const windowRef = {
    fanProfiles: {
      invoke: async (request) => {
        assert.equal(request.action, 'auto-update-status');
        return result;
      },
    },
    setInterval: () => 1,
    clearInterval: () => {
      cleared = true;
    },
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
  };
  const ui = initFanProfileAutoUpdate({ windowRef, notify: (message, options) => notices.push({ message, options }) });
  await new Promise(setImmediate);
  assert.equal(notices.length, 0);
  result = { ok: true, data: null };
  await ui.poll();
  assert.equal(notices.length, 0);
  result = { ok: true, data: { reason: 'startup', status: 'success', roomId: '1234', total: 4, created: 0, updated: 3, skipped: 1,
    skippedDetails: [{ rank: '2', reason: 'hidden-identity' }],
    profileRefresh: { updated: 2, failed: 1, skipped: 0 } } };
  await ui.poll();
  assert.deepEqual(notices.map((notice) => notice.options?.type), ['info', 'warning']);
  result = { ok: true, data: { reason: 'startup', status: 'error', error: '请检查网络' } };
  await ui.poll();
  assert.equal(notices[2].options.type, 'error');
  let complete;
  windowRef.fanProfiles.invoke = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const pending = ui.poll();
  listeners.get('pagehide')();
  complete(result);
  await pending;
  assert.equal(notices.length, 3);
  assert.equal(cleared, true);
  assert.equal(listeners.size, 0);
});

test('guard roster confirmation escapes the room identity and keeps the expected room', async () => {
  const forms = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/fans/forms.js'));
  const description = forms.guardRosterForm('1743356673', {
    name: '海边直播间 <测试>',
    avatarSource: '/api/bilibili/avatar?token=synthetic&url=avatar',
  });
  assert.match(description.fields, /海边直播间 &lt;测试&gt;/);
  assert.match(description.fields, /token=synthetic&amp;url=avatar/);
  assert.equal(description.read().expectedRoomId, '1743356673');
});

test('detail proxies face and collection avatars and rejects unsafe sources', async () => {
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'), { URL, URLSearchParams });
  const profile = { records: [] };
  const token = 'synthetic&avatar';
  const avatars = [
    'https://i0.hdslb.com/bfs/face/viewer.jpg',
    'https://i0.hdslb.com/bfs/garb/collection.png',
  ];
  for (const avatar of avatars) {
    const detail = view.renderDetail({ ...profile, avatar }, 'overview', token);
    const images = [...detail.matchAll(/<img\b[^>]*\ssrc="([^"]+)"[^>]*>/g)];
    assert.equal(images.length, 1);
    const source = new URL(images[0][1].replaceAll('&amp;', '&'), 'http://localhost');
    assert.equal(source.pathname, '/api/bilibili/avatar');
    assert.equal(source.searchParams.get('url'), avatar);
    assert.equal(source.searchParams.get('token'), token);
  }
  for (const avatar of ['', 'javascript:alert(1)', 'https://hdslb.com.attacker.test/avatar.webp']) {
    assert.doesNotMatch(view.renderDetail({ ...profile, avatar }), /fan-detail-avatar|<img\b/);
  }
});

test('song summaries escape titles and notes while active and archived preferences remain editable', async (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const preference = f.record(p.id, 'preference', { sentiment: 'like', label: '民谣' });
  const archived = f.record(p.id, 'preference', { sentiment: 'dislike', label: '太吵的歌', archived: true });
  const profile = {
    ...f.detail(p.id),
    songs: [
      { id: 'song-a', data: { songName: 'Song <A>', artist: 'Artist', count: 2, recentDates: ['2026-09-18'], note: '<说明>' } },
      { id: 'song-b', data: { songName: 'Song <A>', artist: '另一个歌手', count: 1, recentDates: ['2026-09-17'] } },
    ],
  };
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const rendered = view.renderDetail(profile, 'music');
  assert.match(rendered, /&lt;说明&gt;/);
  assert.doesNotMatch(rendered, /<A>|<a>|<说明>/);
  for (const record of [preference, archived]) {
    assert.equal(actionTags(rendered, 'edit-record').filter((tag) => tag.includes(record.id)).length, 1);
  }
});

test('manual song entry converts local time and omits per-request preference fields', async () => {
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'), {
    FormData: class {
      constructor(form) {
        return Object.entries(form);
      }
    },
  });
  const description = forms.recordForm('song');
  const payload = description.read({ songName: '雨爱', artist: '测试歌手', category: '流行', note: '补记', occurredAt: '2026-10-12T12:00' });
  assert.equal(payload.kind, 'song');
  assert.equal(payload.occurredAt, '2026-10-12T04:00:00.000Z');
  assert.equal(payload.data.songName, '雨爱');
  assert.equal(Object.hasOwn(payload.data, 'excludeFromStats'), false);
  assert.equal(Object.hasOwn(payload.data, 'excluded'), false);
});

test('membership editor saves an instant interval and its original timestamp at full precision', async (t) => {
  const { fanFixture, interval } = require('../helpers/fan-profile-fixture');
  const f = fanFixture(t);
  const profile = f.create();
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'), {
    FormData: class { constructor(form) { return Object.entries(form); } },
  });
  function saveForm(record, changes) {
    const form = forms.recordForm('membership', record);
    const inputs = Object.fromEntries([...form.fields.matchAll(/<input name="([^"]+)" type="[^"]+" value="([^"]*)"/g)]
      .map(([, name, value]) => [name, value]));
    const payload = form.read({ ...inputs, type: record.data.type, level: '3', ...changes });
    return f.run('save-record', { ...payload, profileId: profile.id }).record;
  }
  const dated = f.record(profile.id, 'membership', interval('2026-11-07', '2026-11-08'));
  const datedEdit = saveForm(dated, { reason: '按日期' });
  assert.deepEqual([datedEdit.data.precision, datedEdit.data.endAt], ['date', '2026-11-08T16:00:00.000Z']);
  const instant = f.record(profile.id, 'membership', {
    type: 'interval', precision: 'instant', level: 3,
    startAt: '2026-11-09T14:00:00.123+08:00', endAt: '2026-11-09T16:00:01.456+08:00',
  }, { occurredAt: '2026-11-09T06:01:02.789Z' });
  const edit = saveForm(instant, { reason: '只改说明' });
  assert.deepEqual([edit.data.precision, edit.data.startAt, edit.data.endAt, edit.occurredAt],
    ['instant', instant.data.startAt, instant.data.endAt, instant.occurredAt]);
  f.setNow(instant.data.endAt);
  assert.equal(f.detail(profile.id).membership.status, 'expired');
  const changed = saveForm(edit, { endAt: '2026-11-10T00:00', reason: '修订到期时刻' });
  assert.equal(changed.data.endAt, '2026-11-09T16:00:00.000Z');
  assert.equal(changed.original.endAt, instant.data.endAt);

  const observation = f.record(profile.id, 'membership', {
    type: 'observation', status: 'inactive', level: 3, observedAt: instant.data.startAt,
  });
  const reviewed = saveForm(observation, { status: 'inactive', reason: '只改观察说明' });
  assert.deepEqual([reviewed.data.observedAt, reviewed.data.decision, reviewed.data.conflicts],
    [instant.data.startAt, 'pending', [instant.id]]);
});

test('switching membership mode excludes the hidden invalid count from native validation and submission', async t => {
  const { chromium } = require('playwright');
  const { startComponentPreviewServer } = require('../helpers/component-preview-server');
  const server = await startComponentPreviewServer({ parentHtml: '<!doctype html><form></form>' });
  t.after(() => server.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const url = `${server.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async () => {
    const { recordForm } = await import('/js/admin/fans/forms.js');
    const form = document.querySelector('form');
    const editor = recordForm('membership');
    form.innerHTML = editor.fields;
    editor.bind(form);
    window.saves = [];
    form.addEventListener('submit', e => { e.preventDefault(); window.saves.push(editor.read(form)); });
  });
  const type = page.locator('[name=type]');
  await type.selectOption('baseline');
  await page.locator('[name=totalDays]').fill('1.5');
  assert.equal(await page.locator('form').evaluate(form => form.checkValidity()), false);
  await type.selectOption('interval');
  await page.locator('[name=start]').fill('2026-11-20');
  await page.locator('[name=end]').fill('2026-11-27');
  const saves = await page.locator('form').evaluate(form => { form.requestSubmit(); return window.saves; });
  assert.equal(saves.length, 1);
  assert.equal(Object.hasOwn(saves[0].data, 'totalDays'), false);
  const f = fanFixture(t);
  const profile = f.create();
  f.run('save-record', { ...saves[0], profileId: profile.id });
  assert.equal(f.detail(profile.id).records[0].data.end, '2026-11-27');
  await type.selectOption('baseline');
  assert.equal(await page.locator('[name=totalDays]').inputValue(), '1.5');
});

test('editing a zero-day baseline preserves zero and keeps the other metric unknown', async t => {
  const f = fanFixture(t);
  const profile = f.create();
  const record = f.record(profile.id, 'membership', { type: 'baseline', asOf: '2026-09-18', totalDays: 0 });
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'), {
    FormData: class { constructor(form) { return Object.entries(form); } },
  });
  const editor = forms.recordForm('membership', record);
  const inputs = Object.fromEntries([...editor.fields.matchAll(/<input name="([^"]+)" type="[^"]+" value="([^"]*)"/g)]
    .map(([, name, value]) => [name, value]));
  assert.deepEqual([inputs.totalDays, inputs.continuousDays], ['0', '']);
  const payload = editor.read({ ...inputs, type: 'baseline', reason: '核对零值' });
  const saved = f.run('save-record', { ...payload, profileId: profile.id }).record;
  assert.deepEqual([saved.data.totalDays, saved.data.continuousDays, saved.data.reason], [0, null, '核对零值']);
});

test('membership conflicts retain both resolution choices and escape raw data', async () => {
  const confirmed = {
    id: 'confirmed-membership', kind: 'membership', original: { source: 'manual' },
    data: { type: 'interval', level: 3, startAt: '2026-08-31T16:00:00.000Z',
      endAt: '2026-12-31T16:00:00.000Z', decision: 'adopted', reason: '<上次确认>' },
  };
  const pending = {
    id: 'pending-membership', kind: 'membership', original: { source: 'platform' },
    data: { type: 'interval', level: 3, startAt: '2026-08-31T16:00:00.000Z',
      endAt: '2026-11-30T16:00:00.000Z', decision: 'pending', conflicts: [confirmed.id] },
  };
  const profile = {
    membership: { status: 'pending', totalDays: null, continuousDays: null },
    records: [confirmed, pending],
  };
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const rendered = view.renderDetail(profile, 'membership');
  assert.match(rendered, /&lt;上次确认&gt;/);
  for (const action of ['resolve-adopt', 'resolve-keep']) {
    const buttons = actionTags(rendered, action);
    assert.equal(buttons.length, 1);
    assert.match(buttons[0], new RegExp(`\\sdata-record-id=["']${pending.id}["']`));
  }
  assert.doesNotMatch(rendered, /<pre|<上次确认>|decision|conflicts/);
});

test('merge preview uses readable escaped fields and preserves the selected merge policy', async (t) => {
  const f = fanFixture(t);
  const target = f.create({ alias: '已有称呼', notes: '已有备注' });
  const draft = f.create({
    identity: null,
    alias: '<新称呼>',
    notes: '新增备注',
    birthday: { calendar: 'lunar', monthDay: '09-18', advance: true, thisYearDate: '2026-10-28' },
  });
  f.record(draft.id, 'note', { body: '聊天记录' });
  const { createFanTransferUi } = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/transfer-ui.js'));
  let description;
  let save;
  let savedProfile;
  const transfer = createFanTransferUi({
    request: async (action, input) => f.run(action, input),
    beginIntent: () => () => true,
    openForm: (form, submit) => {
      description = form;
      save = submit;
    },
    onProfile: (profile) => {
      savedProfile = profile;
    },
  });
  await transfer.mergeDraft(f.detail(draft.id), target.id);
  assert.match(description.fields, /&lt;新称呼&gt;/);
  assert.doesNotMatch(description.fields, /<pre|<新称呼>|monthDay|"calendar"|JSON/);
  const payload = description.read({ elements: { prefer: { value: 'target' } } });
  assert.equal(payload.targetId, target.id);
  assert.equal(payload.targetRevision, target.revision);
  await save(payload);
  assert.equal(savedProfile.notes, '已有备注');
  assert.equal(savedProfile.records[0].data.body, '聊天记录');
});
