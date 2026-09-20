'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { fanFixture, SCOPE, IDENTITY, NOW } = require('./helpers/fan-profile-fixture');

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
