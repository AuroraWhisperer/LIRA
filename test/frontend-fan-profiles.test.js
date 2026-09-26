'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { fanFixture, interval, SCOPE, IDENTITY, NOW } = require('./helpers/fan-profile-fixture');

const ROOT = path.join(__dirname, '..');

test('favorite stars follow the current name and editable former names appear in basic details', async (t) => {
  const f = fanFixture(t);
  const p = f.create({ favorite: true, formerNames: ['<旧昵称>', '较早昵称'] });
  f.consume([{ name: '<新昵称>' }]);
  const profile = f.detail(p.id);
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const rendered = view.renderPeople([profile], p.id, false);
  assert.match(rendered, /&lt;新昵称&gt;<\/strong><span class="fan-favorite-star"[^>]*aria-label="特别关注"[^>]*>★/);
  assert.match(rendered, /常用称呼：小海/);
  assert.doesNotMatch(view.renderPeople([{ ...profile, favorite: false }], p.id, false), /fan-favorite-star/);
  const detail = view.renderDetail(profile);
  assert.match(detail, /&lt;新昵称&gt;<\/h3>/);
  assert.match(detail, /<dt>曾用名<\/dt><dd>&lt;旧昵称&gt;、较早昵称<\/dd>/);
  assert.doesNotMatch(detail, /<旧昵称>|<新昵称>/);
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'), {
    FormData: class {
      constructor(form) {
        return Object.entries(form);
      }
    },
  });
  const description = forms.profileForm(profile);
  assert.match(description.fields, /name="formerNames"[^>]*>&lt;旧昵称&gt;\n较早昵称/);
  assert.doesNotMatch(description.fields, /name="alias"[^>]*required/);
  const payload = description.read({ alias: '', tags: '', formerNames: ' 修订名字\n较早昵称\n' });
  assert.deepEqual(Array.from(payload.formerNames), ['修订名字', '较早昵称']);
  const saved = f.run('save', payload);
  assert.deepEqual(saved.formerNames, ['修订名字', '较早昵称']);
  assert.equal(saved.platformName, '<新昵称>');
});

test('daily update settings default off and return the selected value with the timing explanation', async () => {
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'));
  const description = forms.settingsForm({});
  assert.match(description.fields, /12:10/);
  assert.match(description.fields, /当天首次打开/);
  assert.match(description.fields, /已下舰的粉丝会移除身份标记/);
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
  assert.match(notices[0].message, /12:10 定时更新完成，已同步最新大航海身份/);
  result = { ok: true, data: null };
  await ui.poll();
  assert.equal(notices.length, 1);
  result = { ok: true, data: { reason: 'startup', status: 'success', created: 0, updated: 3, skipped: 1 } };
  await ui.poll();
  assert.match(notices[1].message, /启动补更新完成/);
  result = { ok: true, data: { reason: 'startup', status: 'error', error: '请检查网络' } };
  await ui.poll();
  assert.match(notices[2].message, /启动补更新失败：请检查网络/);
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

test('profile settings put bulk deletion last and require destructive confirmation', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/pages/admin/toolbox/fan-profiles.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT, 'public/js/admin/fans/index.js'), 'utf8');
  assert.match(
    html,
    /class="danger" data-fan-action="delete-all">\u6e05\u9664\u5168\u90e8\u6863\u6848<\/button>[\s\S]*?<\/div>\s*<\/section>/,
  );
  const start = source.indexOf("if (name === 'delete-all')");
  const end = source.indexOf("if (name === 'export')", start);
  const handler = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(handler, /await dangerConfirm\(/);
  assert.match(handler, /if \(!confirmed\) return;/);
  assert.ok(handler.indexOf('dangerConfirm') < handler.indexOf("request('delete-all'"));
  assert.match(handler, /request\('delete-all', \{ confirm: true \}\)/);
});

test('guard roster confirmation reuses the room identity without showing its number', async () => {
  const forms = await loadModuleExports(path.resolve(__dirname, '../public/js/admin/fans/forms.js'));
  const description = forms.guardRosterForm('1743356673', {
    name: '海边直播间 <测试>',
    avatarSource: '/api/bilibili/avatar?token=synthetic&url=avatar',
  });
  assert.match(description.fields, /class="bilibili-auth-profile"/);
  assert.match(description.fields, /class="bilibili-auth-avatar"/);
  assert.match(description.fields, /海边直播间 &lt;测试&gt;/);
  assert.match(description.fields, /token=synthetic&amp;url=avatar/);
  assert.doesNotMatch(description.fields, /1743356673/);
  assert.equal(description.read().expectedRoomId, '1743356673');
});

test('list and detail show each synced guard icon without requiring membership dates', async (t) => {
  const f = fanFixture(t);
  const view = await loadModuleExports(path.resolve(__dirname, '../public/js/admin/fans/view.js'));
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
      assert.match(rendered, new RegExp(`class="fan-name" data-guard-level="${level}"`));
      assert.match(
        rendered,
        new RegExp(
          `<img class="fan-status" src="/img/admin/gifts/bilibili-guard-${icon}\\.webp" alt="${label}" title="${label}"`,
        ),
      );
      assert.doesNotMatch(rendered, new RegExp(`>${label}</span>`));
      assert.match(rendered, /&lt;虚构粉丝&gt;/);
      assert.doesNotMatch(rendered, /曾观察到|当前待核实|<虚构粉丝>/);
    }
    const membership = view.renderDetail(profile, 'membership');
    assert.match(membership, new RegExp(`在舰 · ${label}`));
    assert.match(membership, /待补到期时间/);
    assert.doesNotMatch(membership, /观察记录不代表当前仍在舰/);
  }
});

test('missing members and ordinary profiles have plain names and no identity placeholder', async (t) => {
  const f = fanFixture(t);
  const view = await loadModuleExports(path.resolve(__dirname, '../public/js/admin/fans/view.js'));
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
      assert.match(rendered, /class="fan-name" data-guard-level=""/);
      assert.doesNotMatch(rendered, /class="fan-status"|曾观察到|当前待核实|未记录大航海/);
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
  const pages = Object.fromEntries(['overview', 'interactions', 'music', 'membership'].map((tab) => [tab, view.renderDetail(profile, tab)]));
  for (const [record, owner] of [[note, 'interactions'], [pinned, 'interactions'], [archivedNote, 'interactions'], [topic, 'overview'], [followup, 'overview'], [song, 'music'], [hiddenSong, 'music'], [preference, 'music'], [member, 'membership']]) {
    for (const [tab, rendered] of Object.entries(pages)) {
      assert.equal(rendered.includes(`data-record-id="${record.id}"`), tab === owner, `${record.kind} belongs in ${owner}`);
    }
  }
  assert.ok(pages.interactions.indexOf(pinned.id) < pages.interactions.indexOf(note.id));
  assert.match(pages.interactions, /已收起的手记/);
  assert.match(pages.music, /已收起的音乐记录/);
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
  assert.match(rendered, /确认前暂停大航海提醒，生日提醒照常/);
  for (const action of ['resolve-adopt', 'resolve-keep']) {
    assert.match(rendered, new RegExp(`data-fan-action="${action}" data-record-id="${pending.id}"`));
  }
  assert.ok(rendered.indexOf('class="fan-conflict"') < rendered.indexOf('class="fan-history"'));
  assert.doesNotMatch(rendered, /<pre|<上次确认>|JSON|evidenceVerified|Asia\/Shanghai/);
});

test('merge preview uses readable escaped fields and preserves the selected merge policy', async (t) => {
  const f = fanFixture(t);
  const target = f.create({ alias: '已有称呼', notes: '已有备注' });
  const draft = f.create({ identity: null, alias: '<新称呼>', notes: '新增备注', birthday: { calendar: 'lunar', monthDay: '09-18', advance: true, thisYearDate: '2026-10-28' } });
  f.record(draft.id, 'note', { body: '聊天记录' });
  const { createFanTransferUi } = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/transfer-ui.js'));
  let description;
  let save;
  let savedProfile;
  const transfer = createFanTransferUi({
    request: async (action, input) => f.run(action, input),
    openForm: (form, submit) => { description = form; save = submit; },
    onProfile: (profile) => { savedProfile = profile; },
  });
  await transfer.mergeDraft(f.detail(draft.id), target.id);
  assert.match(description.fields, /&lt;新称呼&gt;/);
  assert.match(description.fields, /09-18（农历）/);
  assert.match(description.fields, /提前 7 天提醒 · 今年提醒日：2026-10-28/);
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
