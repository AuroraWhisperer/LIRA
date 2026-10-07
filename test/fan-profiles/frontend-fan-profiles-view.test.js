'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { fanFixture, interval, SCOPE, IDENTITY, NOW } = require('../helpers/fan-profile-fixture');

const ROOT = path.join(__dirname, '../..');

function actionTags(markup, action) {
  return markup.match(new RegExp(`<[^>]+\\sdata-fan-action=["']${action}["'][^>]*>`, 'g')) || [];
}

test('archive scope controls live on the profiles page, not in settings or the notice', () => {
  const markup = fs.readFileSync(path.join(ROOT, 'public/pages/admin/toolbox/fan-profiles.html'), 'utf8');
  const group = markup.match(/<[^>]+\saria-label=["']档案范围["'][^>]*>/)?.[0];
  assert.ok(group);
  assert.match(group, /\srole=["']group["']/);
  for (const [action, pressed] of [['back-profiles', 'true'], ['archived', 'false']]) {
    const buttons = actionTags(markup, action);
    assert.equal(buttons.length, 1);
    assert.match(buttons[0], /^<button\b/);
    assert.match(buttons[0], new RegExp(`\\saria-pressed=["']${pressed}["']`));
  }
});

test('archive empty states distinguish scope from search and never offer creation', async () => {
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const states = [
    [false, true, []],
    [true, true, ['clear-filter']],
    [false, false, ['new']],
    [true, false, ['clear-filter']],
  ].map(([filtered, archived, actions]) => {
    const rendered = view.renderPeople([], null, filtered, archived);
    assert.deepEqual(
      [...rendered.matchAll(/data-fan-action="([^"]+)"/g)].map((match) => match[1]),
      actions,
      `filtered=${filtered} archived=${archived}`,
    );
    return rendered;
  });
  assert.equal(new Set(states).size, states.length, 'each empty state has its own message');
});

test('archived detail exposes one restore action outside more while current detail explains archive', async (t) => {
  const f = fanFixture(t);
  const profile = f.detail(f.create().id);
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const current = view.renderDetail(profile);
  assert.equal(actionTags(current, 'archive').length, 1);
  const archived = view.renderDetail({ ...profile, archived: true });
  assert.equal(actionTags(archived, 'archive').length, 1);
  const archiveLabel = (rendered) => rendered.match(/data-fan-action="archive"[^>]*>([^<]+)/)?.[1];
  assert.ok(archiveLabel(archived));
  assert.notEqual(archiveLabel(archived), archiveLabel(current), 'restore is labelled differently from archive');
  for (const details of archived.match(/<details\b[^>]*>[\s\S]*?<\/details>/g) || []) {
    assert.equal(actionTags(details, 'archive').length, 0, 'restore is available without expanding details');
  }
});

test('favorite indicators accompany escaped names while former names remain editable', async (t) => {
  const f = fanFixture(t);
  const p = f.create({ favorite: true, formerNames: ['<旧昵称>', '较早昵称'] });
  f.consume([{ name: '<新昵称>' }]);
  const profile = f.detail(p.id);
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const rendered = view.renderPeople([profile], p.id, false);
  assert.match(rendered.replace(/<[^>]*>/g, ''), /小海（&lt;新昵称&gt;）/);
  assert.match(rendered, /\saria-label=["']特别关注["']/);
  assert.doesNotMatch(rendered, /<新昵称>/);
  assert.doesNotMatch(
    view.renderPeople([{ ...profile, favorite: false }], p.id, false),
    /\saria-label=["']特别关注["']/,
  );
  const detail = view.renderDetail(profile);
  assert.match(detail, /&lt;新昵称&gt;/);
  assert.match(detail.replace(/<[^>]*>/g, ''), /&lt;旧昵称&gt;、较早昵称/);
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
  const alias = description.fields.match(/<input\b[^>]*\sname=["']alias["'][^>]*>/)?.[0];
  assert.ok(alias);
  assert.doesNotMatch(alias, /\srequired(?:\s|=|\/?>)/);
  const payload = description.read({ alias: '', tags: '', formerNames: ' 修订名字\n较早昵称\n' });
  assert.deepEqual(Array.from(payload.formerNames), ['修订名字', '较早昵称']);
  const saved = f.run('save', payload);
  assert.deepEqual(saved.formerNames, ['修订名字', '较早昵称']);
  assert.equal(saved.platformName, '<新昵称>');
});

test('people names escape aliases and omit missing or duplicate platform names', async () => {
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const aliased = view.renderPeople([{ id: 'alias', alias: '<小海>', platformName: '海风' }], null, false);
  assert.match(aliased, /title="&lt;小海&gt;（海风）"/);
  assert.match(aliased.replace(/<[^>]*>/g, ''), /&lt;小海&gt;（海风）/);
  assert.doesNotMatch(aliased, /<小海>/);
  for (const [alias, platformName, expected] of [
    ['', '海风', '海风'],
    ['小海', '', '小海'],
    ['海风', '海风', '海风'],
    ['', '', '未命名档案'],
  ]) {
    const rendered = view.renderPeople([{ id: 'name', alias, platformName }], null, false);
    assert.equal(rendered.replace(/<[^>]*>/g, '').trim(), expected);
  }
});

test('daily update settings default off and return the selected value with the timing explanation', async () => {
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'));
  const description = forms.settingsForm({});
  assert.match(description.fields, /12:10/);
  assert.doesNotMatch(description.fields, /name="autoSyncGuardRoster"[^>]*checked/);
  assert.match(forms.settingsForm({ autoSyncGuardRoster: true }).fields, /name="autoSyncGuardRoster"[^>]*checked/);
  const values = description.read({
    elements: {
      autoUpdate: { checked: true },
      autoCreate: { checked: false },
      autoSyncGuardRoster: { checked: true },
    },
  });
  assert.equal(values.autoSyncGuardRoster, true);
  assert.equal(values.autoCreate, false);
});

test('global fan update polling shows scheduled and startup toasts, errors, and stops after pagehide', async () => {
  const { initFanProfileAutoUpdate } = await loadModuleExports(
    path.join(ROOT, 'public/js/admin/fans/automatic-update.js'),
  );
  let result = { ok: true, data: { reason: 'scheduled', status: 'success', created: 1, updated: 2, skipped: 0 } };
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
  assert.match(notices[0].message, /12:10/);
  result = { ok: true, data: null };
  await ui.poll();
  assert.equal(notices.length, 1);
  result = { ok: true, data: { reason: 'startup', status: 'success', created: 0, updated: 3, skipped: 1 } };
  await ui.poll();
  assert.doesNotMatch(notices[1].message, /12:10/, 'startup catch-up is not reported as the scheduled run');
  assert.notEqual(notices[1].options?.type, 'error');
  result = { ok: true, data: { reason: 'startup', status: 'error', error: '请检查网络' } };
  await ui.poll();
  assert.match(notices[2].message, /请检查网络/);
  assert.notEqual(notices[2].message, notices[1].message);
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

// Confirmation before the delete-all request: frontend-fan-profiles.test.js "delete-all sends nothing when...".
test('profile settings expose one bulk deletion action', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/pages/admin/toolbox/fan-profiles.html'), 'utf8');
  const buttons = actionTags(html, 'delete-all');
  assert.equal(buttons.length, 1);
  assert.match(buttons[0], /^<button\b/);
  assert.match(buttons[0], /\stype=["']button["']/);
});

test('guard roster confirmation reuses the room identity without showing its number', async () => {
  const forms = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/fans/forms.js'));
  const description = forms.guardRosterForm('1743356673', {
    name: '海边直播间 <测试>',
    avatarSource: '/api/bilibili/avatar?token=synthetic&url=avatar',
  });
  assert.match(description.fields, /海边直播间 &lt;测试&gt;/);
  assert.match(description.fields, /token=synthetic&amp;url=avatar/);
  assert.doesNotMatch(description.fields, /1743356673/);
  assert.equal(description.read().expectedRoomId, '1743356673');
});

test('list and detail show each synced guard icon without requiring membership dates', async (t) => {
  const f = fanFixture(t);
  const view = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/fans/view.js'));
  for (const [level, label, icon] of [
    [3, '舰长', 'captain'],
    [2, '提督', 'prefect'],
    [1, '总督', 'governor'],
  ]) {
    f.service.importGuardRoster(SCOPE, {
      roomId: '1234',
      ownerUid: '99',
      observedAt: NOW,
      skipped: 0,
      members: [{ uid: IDENTITY.value, name: '<虚构粉丝>', level }],
    });
    const profile = f.run('find', { identity: IDENTITY });
    const list = view.renderPeople([profile], profile.id, false);
    const detail = view.renderDetail(profile);
    for (const rendered of [list, detail]) {
      assert.match(rendered, new RegExp(`\\sdata-guard-level=["']${level}["']`));
      const image = rendered.match(
        new RegExp(`<img\\b[^>]*\\ssrc=["']/img/admin/gifts/bilibili-guard-${icon}\\.webp["'][^>]*>`),
      )?.[0];
      assert.ok(image);
      assert.match(image, new RegExp(`\\salt=["']${label}["']`));
      assert.match(rendered, /&lt;虚构粉丝&gt;/);
      assert.doesNotMatch(rendered, /<虚构粉丝>/);
    }
    const membership = view.renderDetail(profile, 'membership');
    assert.match(membership, new RegExp(label));
    assert.match(membership, /待补到期时间/);
  }
});

test('missing members and ordinary profiles have plain names and no identity placeholder', async (t) => {
  const f = fanFixture(t);
  const view = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/fans/view.js'));
  const ordinary = f.create({ identity: { ...IDENTITY, value: '900000002' }, alias: '普通粉丝' });
  f.service.importGuardRoster(SCOPE, {
    roomId: '1234',
    ownerUid: '99',
    observedAt: NOW,
    skipped: 0,
    members: [{ uid: IDENTITY.value, name: '曾在舰粉丝', level: 3 }],
  });
  f.service.importGuardRoster(SCOPE, {
    roomId: '1234',
    ownerUid: '99',
    observedAt: '2026-09-18T05:00:00.000Z',
    skipped: 0,
    members: [],
  });
  for (const profile of [f.detail(ordinary.id), f.run('find', { identity: IDENTITY })]) {
    for (const rendered of [view.renderPeople([profile], null, false), view.renderDetail(profile)]) {
      assert.match(rendered, /\sdata-guard-level=["']["']/);
      assert.doesNotMatch(rendered, /bilibili-guard-(?:captain|prefect|governor)\.webp|曾观察到|当前待核实|未记录大航海/);
    }
  }
});

test('detail tabs show each record in one place and keep archived records editable', async (t) => {
  const f = fanFixture(t);
  const p = f.create({ alias: '星星同学' });
  f.consume([{ name: '星星同学' }]);
  const note = f.record(p.id, 'note', { body: '今天聊了吉他' });
  const pinned = f.record(p.id, 'note', { body: '下次先问候', pinned: true });
  const archivedNote = f.record(p.id, 'note', { body: '以前的聊天', archived: true });
  const topic = f.record(p.id, 'topic', { body: '周末旅行' });
  const followup = f.record(p.id, 'followup', { body: '已经唱过的约定', completed: true });
  const song = f.record(p.id, 'song', { songName: '星晴', artist: '周杰伦' });
  const hiddenSong = f.record(p.id, 'song', { songName: '替别人点的歌', excluded: true });
  const preference = f.record(p.id, 'preference', { sentiment: 'dislike', label: '太吵的歌', archived: true });
  const member = f.record(p.id, 'membership', interval('2026-09-01', '2026-09-30'));
  const profile = f.detail(p.id);
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const pages = Object.fromEntries(
    ['overview', 'interactions', 'music', 'membership'].map((tab) => [tab, view.renderDetail(profile, tab)]),
  );
  for (const [record, owner] of [
    [note, 'interactions'],
    [pinned, 'interactions'],
    [archivedNote, 'interactions'],
    [topic, 'overview'],
    [followup, 'overview'],
    [song, 'music'],
    [hiddenSong, 'music'],
    [preference, 'music'],
    [member, 'membership'],
  ]) {
    for (const [tab, rendered] of Object.entries(pages)) {
      assert.equal(
        rendered.includes(`data-record-id="${record.id}"`),
        tab === owner,
        `${record.kind} belongs in ${owner}`,
      );
    }
  }
  assert.ok(pages.interactions.indexOf(pinned.id) < pages.interactions.indexOf(note.id));
  for (const [record, rendered] of [
    [archivedNote, pages.interactions],
    [hiddenSong, pages.music],
    [preference, pages.music],
  ]) {
    const collapsed = (rendered.match(/<details\b[^>]*>[\s\S]*?<\/details>/g) || []).join('');
    assert.ok(collapsed.includes(`data-record-id="${record.id}"`), `${record.kind} is collapsed`);
  }
  assert.match(pages.music, /不喜欢 太吵的歌/);
  for (const rendered of Object.values(pages)) {
    assert.equal((rendered.match(/星星同学/g) || []).length, 1);
    assert.equal((rendered.match(/data-fan-action="edit-profile"/g) || []).length, 1);
    assert.doesNotMatch(rendered, /<pre|fan-original|原始记录|JSON|人工修订|fanTimelineFilter/);
  }
});

test('membership conflicts show both dates and retain both resolution choices without raw data', async (t) => {
  const f = fanFixture(t);
  const p = f.create({ expiryReminders: true });
  f.record(p.id, 'membership', interval('2026-09-01', '2026-12-31', { reason: '<上次确认>' }));
  f.consume([{ kind: 'membership', membership: interval('2026-09-01', '2026-11-30', { evidenceVerified: true }) }]);
  const profile = f.detail(p.id);
  const pending = profile.records.find((record) => record.data.decision === 'pending');
  assert.ok(pending);
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const rendered = view.renderDetail(profile, 'membership');
  assert.match(rendered, /2026\/11\/30/);
  assert.match(rendered, /2026\/12\/31/);
  assert.match(rendered, /&lt;上次确认&gt;/);
  for (const action of ['resolve-adopt', 'resolve-keep']) {
    const buttons = actionTags(rendered, action);
    assert.equal(buttons.length, 1);
    assert.match(buttons[0], new RegExp(`\\sdata-record-id=["']${pending.id}["']`));
  }
  assert.doesNotMatch(rendered, /<pre|<上次确认>|JSON|evidenceVerified|Asia\/Shanghai/);
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
  assert.match(description.fields, /09-18（农历）/);
  assert.match(description.fields, /2026-10-28/);
  assert.match(description.fields, /已有备注/);
  assert.match(description.fields, /新增备注/);
  assert.doesNotMatch(description.fields, /<pre|<新称呼>|monthDay|"calendar"|JSON/);
  const payload = description.read({ elements: { prefer: { value: 'target' } } });
  assert.equal(payload.targetId, target.id);
  assert.equal(payload.targetRevision, target.revision);
  await save(payload);
  assert.equal(savedProfile.notes, '已有备注');
  assert.equal(savedProfile.records[0].data.body, '聊天记录');
});
