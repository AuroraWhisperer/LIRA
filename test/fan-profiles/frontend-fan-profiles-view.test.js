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

test('expiry badge and guard icon share the row side while preserving wrapping names and safe tooltips', async () => {
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const profile = { id: 'expiry-fan', alias: '<很长的称呼>', currentGuardLevel: 3, summary: '摘要' };
  const expiry = { observedAt: '2026-10-12T04:00:00Z', badges: [{ profileId: profile.id, level: 3, days: 0 }] };
  const markup = view.renderPeople([profile], null, false, false, expiry);
  assert.match(markup, /fan-person-copy/);
  assert.match(markup, /&lt;很长的称呼&gt;/);
  assert.match(markup, /fan-person-badges[\s\S]*fan-expiry-badge[\s\S]*剩0天[\s\S]*data-guard-icon="3"/);
  assert.match(markup, /舰长到期：今日到期。来源：B 站/);
  assert.doesNotMatch(view.renderPeople([profile], null, false), /fan-expiry-badge/);
  assert.match(view.renderPeople([profile], null, false), /data-guard-icon="3"/);
  for (const changed of [{ ...profile, archived: true }, { ...profile, currentGuardLevel: 2 }])
    assert.doesNotMatch(view.renderPeople([changed], null, false, false, expiry), /fan-expiry-badge/);
});

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

test('latest roster result uses contextual help immediately before the sync status without a separate row', () => {
  const markup = fs.readFileSync(path.join(ROOT, 'public/pages/admin/toolbox/fan-profiles.html'), 'utf8');
  assert.match(markup, /<lira-help id="fanRosterHelp" label="查看最近同步结果" hidden><span id="fanRosterResult"><\/span><\/lira-help>\s*<span id="fanSyncState" role="status">/);
  assert.equal((markup.match(/id="fanRosterResult"/g) || []).length, 1);
  assert.doesNotMatch(markup, /<p[^>]*id="fanRosterResult"/);
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

test('reminder view keeps recent groups and history without displaying distant predictions', async () => {
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const items = ['today', 'week', 'missed', 'history', 'later'].map((group) => ({
    profileId: 'fan-reminder-view', name: '测试粉丝', date: '2026-10-10',
    key: group, title: `reminder-${group}`, group, status: group === 'history' ? 'handled' : 'pending',
  }));
  const rendered = view.renderReminders(items);
  for (const group of ['today', 'week', 'missed', 'history']) assert.ok(rendered.includes(`reminder-${group}`));
  assert.doesNotMatch(rendered, /reminder-later|之后/);
  const empty = view.renderReminders(items.filter((item) => item.group === 'later'));
  assert.match(empty, /暂时没有待办提醒/);
  assert.match(empty, /提前 7 天/);
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
  assert.match(links[0], /aria-label="打开 &lt;小海&gt; 的档案"/);
  assert.match(rendered, /&lt;公历生日&gt;/);
  assert.doesNotMatch(rendered, /<小海>|<公历生日>/);
  for (const state of ['handled', 'snoozed', 'ignored']) {
    assert.deepEqual(actionTags(rendered, `reminder-${state}`).map((tag) =>
      tag.match(/data-reminder-key="([^"]+)"/)[1]), ['birthday:2026', 'accompany:1234:500']);
  }
});

test('archived detail exposes one restore action outside more while current detail offers archive', async (t) => {
  const f = fanFixture(t);
  const id = f.create().id;
  f.service.importGuardRoster(SCOPE, {
    roomId: '1234', ownerUid: '99', observedAt: NOW, skipped: 0,
    members: [{ uid: IDENTITY.value, name: '测试舰长', level: 3 }],
  });
  const profile = f.detail(id);
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const current = view.renderDetail(profile);
  assert.equal(actionTags(current, 'suppress').length, 1);
  assert.equal(actionTags(view.renderDetail({ ...profile, identity: null }), 'suppress').length, 0);
  assert.equal(actionTags(current, 'archive').length, 1);
  const archived = view.renderDetail({ ...profile, archived: true });
  for (const rendered of [current, archived]) assert.match(rendered, /alt="舰长"/);
  assert.match(view.renderPeople([{ ...profile, archived: true }], null, false, true), /alt="舰长"/);
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
  assert.match(description.fields, /<lira-help label="日历自动提示说明">/);
  assert.match(description.fields, /提前 3 天显示在工作台日历的目标日期上/);
  assert.match(description.fields, /修改或清除日期会自动更新/);
  assert.match(description.fields, /12:10/);
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

test('fan detail renders platform companion days independently of unknown local duration', async (t) => {
  const f = fanFixture(t);
  f.service.importGuardRoster(SCOPE, {
    roomId: '1234', ownerUid: '99', observedAt: NOW, skipped: 0,
    members: [{ uid: IDENTITY.value, name: '测试粉丝', level: 3, accompanyDays: 499 }],
  });
  const profile = f.run('find', { identity: IDENTITY });
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const rendered = view.renderDetail(profile, 'membership');
  assert.match(rendered, /B 站陪伴天数/);
  assert.match(rendered, /499 天/);
  assert.match(rendered, /累计在舰<\/dt><dd>未知/);
  assert.doesNotMatch(view.renderDetail({ ...profile, guardAccompany: null }, 'membership'), /499 天/);
});

test('roster skip messages identify members and explain unavailable identities without inventing legacy reasons', async () => {
  const { rosterSkippedMessage } = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  assert.equal(rosterSkippedMessage({ skipped: 0, skippedDetails: [] }), '');
  assert.equal(rosterSkippedMessage({ skipped: 4, skippedDetails: [
    { uid: '123', name: '小海', reason: 'archived' },
    { uid: '456', name: '', reason: 'suppressed' },
    { rank: '3', reason: 'hidden-identity' },
    { rank: '4', reason: 'invalid-uid' },
  ] }), ' 跳过明细：小海（UID 123）：档案已归档，本次未更新，保留原身份资料；UID 456：已加入黑名单，禁止自动建档或更新；名单第 3 位：B 站隐藏了身份，无法识别；名单第 4 位：B 站未提供有效 UID，无法匹配档案。');
  assert.match(rosterSkippedMessage({ skipped: 1 }), /1 位未提供跳过明细，请重新同步查看/);
});

test('roster notices separate success, skips and lookup failures and omit empty categories', async () => {
  const { rosterUpdateNotices } = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const result = { roomId: '1234', total: 30, created: 0, updated: 30, skipped: 0,
    profileRefresh: { updated: 2, skipped: 0, failed: 0 } };
  const clean = rosterUpdateNotices(result);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].type, 'success');
  assert.match(clean[0].message, /更新 30 份/);
  assert.match(clean[0].message, /名单外资料：更新 2 份/);
  assert.doesNotMatch(clean[0].message, /跳过|未查询|未应用/);
  for (const skipped of [0, 1]) {
    for (const failed of [0, 1]) {
      const notices = rosterUpdateNotices({ ...result, skipped,
        skippedDetails: skipped ? [{ uid: '123', name: '小海', reason: 'archived' }] : [],
        profileRefresh: { updated: 2, skipped: 0, failed },
      });
      assert.deepEqual(Array.from(notices, n => n.type), ['success', ...(skipped ? ['info'] : []), ...(failed ? ['warning'] : [])]);
      assert.doesNotMatch(notices[0].message, /归档|未查询/);
      if (skipped) assert.match(notices[1].message, /小海（UID 123）：档案已归档/);
      if (failed) assert.match(notices.at(-1).message, /1 份暂未查询成功，保留旧资料/);
    }
  }
  const offRoster = rosterUpdateNotices({ ...result, profileRefresh: { updated: 0, skipped: 2, failed: 0 } });
  assert.equal(offRoster.length, 2);
  assert.match(offRoster[1].message, /名单外资料有 2 份未应用更新，保留原资料/);
  const empty = rosterUpdateNotices({ ...result, total: 0, updated: 0 });
  assert.match(empty[0].message, /当前没有大航海成员/);
  assert.match(empty[0].message, /名单外资料：更新 2 份/);
});

test('global fan update polling shows scheduled and startup toasts, errors, and stops after pagehide', async () => {
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
  assert.match(notices[0].message, /12:10/);
  result = { ok: true, data: null };
  await ui.poll();
  assert.equal(notices.length, 1);
  result = { ok: true, data: { reason: 'startup', status: 'success', roomId: '1234', total: 4, created: 0, updated: 3, skipped: 1,
    skippedDetails: [{ rank: '2', reason: 'hidden-identity' }],
    profileRefresh: { updated: 2, failed: 1, skipped: 0 } } };
  await ui.poll();
  assert.doesNotMatch(notices[1].message, /12:10/, 'startup catch-up is not reported as the scheduled run');
  assert.notEqual(notices[1].options?.type, 'error');
  assert.equal(notices.length, 4);
  assert.equal(notices[1].options?.type, 'success');
  assert.match(notices[1].message, /名单外资料：更新 2 份/);
  assert.equal(notices[2].options?.type, 'info');
  assert.match(notices[2].message, /名单第 2 位：B 站隐藏了身份，无法识别/);
  assert.equal(notices[3].options?.type, 'warning');
  assert.match(notices[3].message, /1 份暂未查询成功，保留旧资料/);
  result = { ok: true, data: { reason: 'startup', status: 'error', error: '请检查网络' } };
  await ui.poll();
  assert.match(notices[4].message, /请检查网络/);
  assert.notEqual(notices[4].message, notices[1].message);
  assert.equal(notices[4].options.type, 'error');
  let complete;
  windowRef.fanProfiles.invoke = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const pending = ui.poll();
  listeners.get('pagehide')();
  complete(result);
  await pending;
  assert.equal(notices.length, 5);
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

test('detail uses the existing avatar proxy for synced faces and collections without changing the list', async (t) => {
  const f = fanFixture(t);
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'), { URL, URLSearchParams });
  const p = f.create();
  const token = 'synthetic&avatar';
  const avatars = [
    'https://i0.hdslb.com/bfs/face/viewer.jpg',
    'https://i0.hdslb.com/bfs/garb/collection.png',
  ];
  for (const [index, avatar] of avatars.entries()) {
    f.consume([{ avatar, observedAt: `2026-09-${18 + index}T04:00:00.000Z` }]);
    const profile = f.detail(p.id);
    const detail = view.renderDetail(profile, 'overview', token);
    const images = [...detail.matchAll(/<img\b[^>]*\ssrc="([^"]+)"[^>]*>/g)];
    assert.equal(images.length, 1);
    const source = new URL(images[0][1].replaceAll('&amp;', '&'), 'http://localhost');
    assert.equal(source.pathname, '/api/bilibili/avatar');
    assert.equal(source.searchParams.get('url'), avatar);
    assert.equal(source.searchParams.get('token'), token);
    assert.ok(detail.indexOf('fan-detail-avatar') < detail.indexOf('fan-detail-name'));
    assert.match(detail, /UID 900000001/);
    assert.doesNotMatch(view.renderPeople([profile], p.id, false), /fan-detail-avatar|\/api\/bilibili\/avatar/);
  }
  for (const avatar of ['', 'javascript:alert(1)', 'https://hdslb.com.attacker.test/avatar.webp']) {
    assert.doesNotMatch(view.renderDetail({ ...f.detail(p.id), avatar }), /fan-detail-avatar|<img\b/);
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

test('music renders song summaries with lifetime counts, the latest three dates and the 30-day statistic', async (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const profile = {
    ...f.detail(p.id),
    musicStats: { days: 30, count: 5, categories: { 未分类: 5 } },
    songs: [
      { id: 'summary-rain', data: { songName: '雨爱', artist: '测试歌手', count: 18, recentDates: ['2026-10-12', '2026-10-11', '2026-10-09'] } },
      { id: 'summary-other', data: { songName: '另一首歌', count: 1, recentDates: ['2026-10-11'] } },
    ],
  };
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const rendered = view.renderDetail(profile, 'music');
  const groups = [...rendered.matchAll(/<article class="fan-record fan-song-group">([\s\S]*?)<\/article>/g)];
  assert.equal(groups.length, 2);
  const summary = groups[0][1];
  assert.match(summary, /《雨爱》 · 测试歌手/);
  assert.match(summary, /（18 次）/);
  assert.deepEqual([...summary.matchAll(/<span>(\d{4}\/\d+\/\d+)<\/span>/g)].map((match) => match[1]),
    ['2026/10/12', '2026/10/11', '2026/10/9']);
  assert.equal((summary.match(/fan-song-date-separator/g) || []).length, 2);
  assert.equal((rendered.match(/《雨爱》/g) || []).length, 1);
  assert.match(rendered, /近 30 天点歌 5 次/);
  assert.match(groups[1][1], /（1 次）/);
  assert.equal(actionTags(rendered, 'new-song').length, 1);
  assert.equal(actionTags(rendered, 'legacy').length, 0);
  assert.equal(actionTags(rendered, 'edit-record').length, 0);
  assert.doesNotMatch(rendered, /查看记录|收起记录|导入以前的点歌|fan-song-requests|<details\b[^>]*fan-song-group/);
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
  assert.equal((rendered.match(/class="fan-record fan-song-group"/g) || []).length, 2);
  assert.match(rendered, /（2 次）/);
  assert.match(rendered, /另一个歌手/);
  assert.match(rendered, /&lt;说明&gt;/);
  assert.doesNotMatch(rendered, /<A>|<a>|<说明>/);
  for (const record of [preference, archived]) {
    assert.equal(actionTags(rendered, 'edit-record').filter((tag) => tag.includes(record.id)).length, 1);
  }
  assert.equal(actionTags(rendered, 'edit-record').length, 2);
  assert.match(rendered, /<details class="fan-history">[\s\S]*不喜欢 太吵的歌/);
  assert.doesNotMatch(rendered, /不计入偏好统计|已移出点歌记录/);
});

test('manual song entry collects one request without per-request preference or removal controls', async () => {
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'), {
    FormData: class {
      constructor(form) {
        return Object.entries(form);
      }
    },
  });
  const description = forms.recordForm('song');
  assert.equal(description.title, '补记一次点歌');
  for (const field of ['songName', 'artist', 'category', 'note', 'occurredAt']) {
    assert.match(description.fields, new RegExp(`name="${field}"`));
  }
  assert.doesNotMatch(description.fields, /excludeFromStats|excluded|不计入听歌偏好|点歌记录中移除/);
  const payload = description.read({ songName: '雨爱', artist: '测试歌手', category: '流行', note: '补记', occurredAt: '2026-10-12T12:00' });
  assert.equal(payload.kind, 'song');
  assert.equal(payload.occurredAt, '2026-10-12T04:00:00.000Z');
  assert.equal(payload.data.songName, '雨爱');
  assert.equal(Object.hasOwn(payload.data, 'excludeFromStats'), false);
  assert.equal(Object.hasOwn(payload.data, 'excluded'), false);
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
  const preference = f.record(p.id, 'preference', { sentiment: 'dislike', label: '太吵的歌', archived: true });
  const member = f.record(p.id, 'membership', interval('2026-09-01', '2026-09-30'));
  const profile = {
    ...f.detail(p.id),
    songs: [{ ...song, data: { songName: '星晴', artist: '周杰伦', count: 1, recentDates: ['2026-09-18'] } }],
  };
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
    [preference, pages.music],
  ]) {
    const collapsed = (rendered.match(/<details\b[^>]*>[\s\S]*?<\/details>/g) || []).join('');
    assert.ok(collapsed.includes(`data-record-id="${record.id}"`), `${record.kind} is collapsed`);
  }
  assert.match(pages.music, /不喜欢 太吵的歌/);
  for (const [tab, rendered] of Object.entries(pages)) {
    assert.equal(rendered.includes('《星晴》'), tab === 'music');
    assert.equal(rendered.includes(`data-record-id="${song.id}"`), false, 'song summaries have no per-request edit action');
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
