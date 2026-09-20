'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { fanFixture, SCOPE, IDENTITY, NOW } = require('./helpers/fan-profile-fixture');

const ROOT = path.join(__dirname, '..');

test('daily update settings default off and return the selected value with the timing explanation', async () => {
  const forms = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/forms.js'));
  const description = forms.settingsForm({});
  assert.match(description.fields, /12:10/);
  assert.match(description.fields, /当天首次打开/);
  assert.match(description.fields, /已不在大航海的粉丝取消当前身份显示/);
  assert.doesNotMatch(description.fields, /name="autoSyncGuardRoster"[^>]*checked/);
  assert.match(forms.settingsForm({ autoSyncGuardRoster: true }).fields,
    /name="autoSyncGuardRoster"[^>]*checked/);
  const values = description.read({ elements: {
    autoUpdate: { checked: true }, autoCreate: { checked: false }, autoSyncGuardRoster: { checked: true },
  } });
  assert.equal(values.autoSyncGuardRoster, true);
  assert.equal(values.autoCreate, false);
});

test('global fan update polling shows scheduled and startup toasts, errors, and stops after pagehide', async () => {
  const { initFanProfileAutoUpdate } = await loadModuleExports(
    path.join(ROOT, 'public/js/admin/fans/automatic-update.js'));
  let result = { ok: true, data: { reason: 'scheduled', status: 'success', created: 1, updated: 2, skipped: 0 } };
  const notices = [];
  const listeners = new Map();
  let cleared = false;
  const windowRef = {
    fanProfiles: { invoke: async (request) => {
      assert.equal(request.action, 'auto-update-status');
      return result;
    } },
    setInterval: () => 1,
    clearInterval: () => { cleared = true; },
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
  windowRef.fanProfiles.invoke = () => new Promise((resolve) => { complete = resolve; });
  const pending = ui.poll();
  listeners.get('pagehide')();
  complete(result);
  await pending;
  assert.equal(notices.length, 3);
  assert.equal(cleared, true);
  assert.equal(listeners.size, 0);
});

test('profile settings put bulk deletion last and require destructive confirmation', () => {
  const html = fs.readFileSync(
    path.join(ROOT, 'public/pages/admin/toolbox/fan-profiles.html'),
    'utf8',
  );
  const source = fs.readFileSync(
    path.join(ROOT, 'public/js/admin/fans/index.js'),
    'utf8',
  );
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
  const forms = await loadModuleExports(
    path.resolve(__dirname, '../public/js/admin/fans/forms.js'),
  );
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
  for (const [level, label, icon] of [[3, '舰长', 'captain'], [2, '提督', 'prefect'], [1, '总督', 'governor']]) {
    f.service.importGuardRoster(SCOPE, { roomId: '1234', ownerUid: '99', observedAt: NOW,
      skipped: 0, members: [{ uid: IDENTITY.value, name: '<虚构粉丝>', level }] });
    const profile = f.run('find', { identity: IDENTITY });
    const list = view.renderPeople([profile], profile.id, false);
    const detail = view.renderDetail(profile);
    for (const rendered of [list, detail]) {
      assert.match(rendered, new RegExp(`class="fan-name" data-guard-level="${level}"`));
      assert.match(rendered, new RegExp(`<img class="fan-status" src="/img/admin/gifts/bilibili-guard-${icon}\\.webp" alt="${label}" title="${label}"`));
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
  f.service.importGuardRoster(SCOPE, { roomId: '1234', ownerUid: '99', observedAt: NOW,
    skipped: 0, members: [{ uid: IDENTITY.value, name: '曾在舰粉丝', level: 3 }] });
  f.service.importGuardRoster(SCOPE, { roomId: '1234', ownerUid: '99',
    observedAt: '2026-09-18T05:00:00.000Z', skipped: 0, members: [] });
  for (const profile of [f.detail(ordinary.id), f.run('find', { identity: IDENTITY })]) {
    for (const rendered of [view.renderPeople([profile], null, false), view.renderDetail(profile)]) {
      assert.match(rendered, /class="fan-name" data-guard-level=""/);
      assert.doesNotMatch(rendered, /class="fan-status"|曾观察到|当前待核实|未记录大航海/);
    }
  }
});
