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
