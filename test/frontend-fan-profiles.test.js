'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { fanFixture, interval, SCOPE, IDENTITY, NOW } = require('./helpers/fan-profile-fixture');
const { createDom, createClock } = require('./helpers/toast-dom');

const ROOT = path.join(__dirname, '..');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function archiveUi(t) {
  const f = fanFixture(t);
  const a = f.create({ alias: '当前观众A', birthday: { monthDay: '09-18' }, notes: '保留私人资料' });
  const note = f.record(a.id, 'note', { body: '保留这份手记' });
  const b = f.create({ alias: '归档观众B', identity: { ...IDENTITY, value: '900000002' } });
  f.run('save', { id: b.id, revision: b.revision, archived: true });
  const { documentRef, windowRef, windowListeners, container } = createDom();
  const clock = createClock();
  const nodes = new Map([['toast', container]]);
  const markup = fs.readFileSync(path.join(ROOT, 'public/pages/admin/toolbox/fan-profiles.html'), 'utf8');
  function node(dataset = {}) {
    const item = documentRef.createElement('div');
    item.dataset = dataset;
    item.value = '';
    item.scrollTop = 0;
    item.querySelector = () => null;
    item.querySelectorAll = () => [];
    item.closest = () => null;
    item.classList.toggle = (name, enabled) => item.classList[enabled ? 'add' : 'remove'](name);
    return item;
  }
  for (const [, id] of markup.matchAll(/\bid="([^"]+)"/g)) {
    const item = node();
    nodes.set(id, item);
    documentRef.body.append(item);
  }
  documentRef.getElementById = (id) => nodes.get(id);
  const filters = ['', 'active', 'past', 'favorite', 'incomplete', 'unknown'].map((fanFilter) => node({ fanFilter }));
  const scopes = ['back-profiles', 'archived'].map((fanAction) => node({ fanAction }));
  const pages = ['profiles', 'reminders', 'settings'].map((fanPage) => node({ fanPage }));
  for (const item of filters) item.setAttribute('aria-pressed', String(!item.dataset.fanFilter));
  scopes.forEach((item, index) => item.setAttribute('aria-pressed', String(index === 0)));
  nodes.get('fanProfilesWorkspace').querySelectorAll = (selector) => {
    if (selector === '[data-fan-filter]') return filters;
    if (selector === '.fan-scope [data-fan-action]') return scopes;
    if (selector === '[data-fan-page][role="tab"]') return pages;
    return [];
  };
  const listeners = new Map();
  documentRef.addEventListener = (event, callback) => listeners.set(event, callback);
  const observers = [];
  const ui = { f, a, b, note, filters, scopes, nodes, clock, calls: [], handlers: new Map(), contextId: 'test-context' };
  ui.respond = ({ action, payload }) => ({
    ok: true, contextId: ui.contextId, syncStatus: 'offline',
    data: f.run(action === 'open' ? 'list' : action, payload),
  });
  windowRef.fanProfiles = { invoke: async (input) => {
    ui.calls.push(structuredClone(input));
    try {
      return await (ui.handlers.get(input.action)?.(input) ?? ui.respond(input));
    } catch (error) {
      return { ok: false, error: error.message };
    }
  } };
  const mod = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/index.js'), {
    document: documentRef, window: windowRef,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: (callback) => { ui.poll = callback; return 1; }, clearInterval() {},
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  mod.initFanProfiles();
  ui.flush = () => new Promise(setImmediate);
  ui.click = async (dataset) => {
    const target = node(dataset);
    listeners.get('click')({ target: { closest: () => target } });
    await ui.flush();
  };
  ui.search = async (value, wait = true) => {
    nodes.get('fanSearch').value = value;
    nodes.get('fanSearch').fire('input');
    if (wait) { clock.tick(180); await ui.flush(); }
  };
  ui.listCalls = () => ui.calls.filter((call) => ['open', 'list'].includes(call.action));
  ui.people = () => nodes.get('fanPeople').innerHTML;
  ui.detail = () => nodes.get('fanDetail').innerHTML;
  ui.notices = () => container.textContent;
  t.after(() => { for (const listener of windowListeners.get('pagehide') || []) listener(); });
  observers[0]();
  await ui.flush();
  ui.calls.length = 0;
  return ui;
}

test('switching scope clears pending search and filters once while same-scope navigation preserves them', async (t) => {
  const ui = await archiveUi(t);
  assert.match(ui.people(), /当前观众A/);
  assert.doesNotMatch(ui.people(), /归档观众B/);
  assert.equal(ui.nodes.get('fanNewProfileButton').hidden, false);
  await ui.click({ fanFilter: 'active' });
  await ui.search('找不到归档观众', false);
  await ui.click({ fanId: ui.a.id });
  await ui.click({ fanAction: 'expand' });
  ui.calls.length = 0;
  await ui.click({ fanAction: 'archived' });
  ui.clock.tick(180);
  await ui.flush();
  assert.equal(ui.listCalls().length, 1);
  assert.deepEqual(ui.listCalls()[0].payload, { query: '', filters: [], archived: true });
  assert.equal(ui.scopes[1].getAttribute('aria-pressed'), 'true');
  assert.equal(ui.scopes[0].getAttribute('aria-pressed'), 'false');
  assert.equal(ui.filters[0].getAttribute('aria-pressed'), 'true');
  assert.equal(ui.nodes.get('fanNewProfileButton').hidden, true);
  assert.equal(ui.nodes.get('fanSplit').classList.contains('fan-expanded'), false);
  assert.match(ui.detail(), /选择一份档案/);
  assert.match(ui.people(), /归档观众B/);
  await ui.search('900000002');
  await ui.click({ fanFilter: 'incomplete' });
  const before = ui.listCalls().length;
  await ui.click({ fanAction: 'archived' });
  await ui.click({ fanPage: 'settings' });
  await ui.click({ fanPage: 'profiles' });
  assert.equal(ui.listCalls().length, before);
  assert.equal(ui.nodes.get('fanSearch').value, '900000002');
  await ui.click({ fanAction: 'refresh' });
  ui.poll();
  await ui.flush();
  assert.deepEqual(ui.listCalls().at(-1).payload, { query: '900000002', filters: ['incomplete'], archived: true });
  await ui.click({ fanFilter: '' });
  assert.deepEqual(ui.listCalls().at(-1).payload, { query: '900000002', filters: [], archived: true });
  await ui.search('没有匹配');
  assert.match(ui.people(), /没有找到符合条件的归档档案/);
  await ui.click({ fanAction: 'clear-filter' });
  assert.match(ui.people(), /归档观众B/);
  assert.equal(ui.listCalls().at(-1).payload.archived, true);
});

test('scope loading hides old entries, ignores stale results, and failure retries in the target scope', async (t) => {
  const ui = await archiveUi(t);
  const old = deferred();
  const snapshot = ui.respond({ action: 'list', payload: { archived: false } });
  ui.handlers.set('list', async () => { await old.promise; return snapshot; });
  await ui.search('A');
  ui.handlers.set('list', async () => { throw new Error('读取测试失败'); });
  await ui.click({ fanAction: 'archived' });
  assert.match(ui.people(), /加载失败/);
  assert.doesNotMatch(ui.people(), /data-fan-id|暂无已归档档案/);
  assert.match(ui.nodes.get('fanPageError').textContent, /读取测试失败/);
  old.resolve();
  await ui.flush();
  assert.doesNotMatch(ui.people(), /当前观众A/);
  const loading = deferred();
  ui.handlers.set('open', async (input) => { await loading.promise; return ui.respond(input); });
  await ui.click({ fanAction: 'refresh' });
  assert.match(ui.people(), /正在加载档案/);
  assert.doesNotMatch(ui.people(), /data-fan-id|暂无已归档档案/);
  loading.resolve();
  await ui.flush();
  assert.match(ui.people(), /归档观众B/);
  assert.equal(ui.scopes[1].getAttribute('aria-pressed'), 'true');
});

test('archive and restore preserve identity, notes and reminder state with feedback only after save', async (t) => {
  const ui = await archiveUi(t);
  ui.f.run('reminder-state', { profileId: ui.a.id, key: 'birthday:2026', status: 'handled' });
  await ui.click({ fanId: ui.a.id });
  const saved = deferred();
  ui.handlers.set('save', async (input) => { await saved.promise; return ui.respond(input); });
  await ui.click({ fanAction: 'archive' });
  assert.match(ui.people(), /当前观众A/);
  assert.match(ui.detail(), /保留私人资料/);
  assert.doesNotMatch(ui.notices(), /已归档/);
  saved.resolve();
  await ui.flush();
  assert.doesNotMatch(ui.people(), /当前观众A/);
  assert.match(ui.detail(), /选择一份档案/);
  assert.match(ui.notices(), /已归档，资料仍保留/);
  assert.equal(ui.f.run('reminders').some((item) => item.profileId === ui.a.id), false);
  await ui.click({ fanAction: 'archived' });
  await ui.search(IDENTITY.value);
  assert.match(ui.people(), /当前观众A/);
  await ui.click({ fanId: ui.a.id });
  ui.calls.length = 0;
  await ui.click({ fanAction: 'archive' });
  assert.equal(ui.listCalls().length, 1);
  assert.equal(ui.scopes[1].getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(ui.people(), /data-fan-id/);
  assert.match(ui.detail(), /选择一份档案/);
  assert.match(ui.notices(), /已恢复到主列表/);
  const restored = ui.f.detail(ui.a.id);
  assert.equal(restored.archived, false);
  assert.equal(restored.notes, '保留私人资料');
  assert.ok(restored.records.some((record) => record.id === ui.note.id && record.data.body === '保留这份手记'));
  assert.equal(restored.reminders.find((item) => item.key === 'birthday:2026').status, 'handled');
  await ui.click({ fanAction: 'back-profiles' });
  assert.match(ui.people(), /当前观众A/);
  assert.equal(ui.nodes.get('fanNewProfileButton').hidden, false);
  await ui.click({ fanId: ui.a.id });
  await ui.click({ fanAction: 'favorite' });
  assert.equal(ui.f.detail(ui.a.id).favorite, true);
  assert.match(ui.detail(), /已关注/);
});

test('save failure keeps the visible profile and restoring the last archive clears detail', async (t) => {
  const ui = await archiveUi(t);
  await ui.click({ fanAction: 'archived' });
  await ui.click({ fanId: ui.b.id });
  ui.handlers.set('save', async () => { throw new Error('保存测试失败'); });
  await ui.click({ fanAction: 'archive' });
  assert.match(ui.people(), /归档观众B/);
  assert.match(ui.detail(), /恢复到主列表/);
  assert.match(ui.nodes.get('fanPageError').textContent, /保存测试失败/);
  assert.doesNotMatch(ui.notices(), /已恢复/);
  ui.handlers.delete('save');
  await ui.click({ fanAction: 'archive' });
  assert.match(ui.people(), /暂无已归档档案/);
  assert.doesNotMatch(ui.people(), /清除筛选|新建档案/);
  assert.match(ui.detail(), /选择一份档案/);
});

test('successful archive followed by refresh failure stays saved and does not reopen detail', async (t) => {
  const ui = await archiveUi(t);
  await ui.click({ fanId: ui.a.id });
  ui.handlers.set('list', async () => { throw new Error('列表刷新失败'); });
  await ui.click({ fanAction: 'archive' });
  assert.equal(ui.f.detail(ui.a.id).archived, true);
  assert.match(ui.detail(), /选择一份档案/);
  assert.match(ui.people(), /加载失败/);
  assert.match(ui.notices(), /已归档/);
  assert.match(ui.nodes.get('fanPageError').textContent, /列表刷新失败/);
});

test('pending details and archive saves cannot replace a newer scope or selection', async (t) => {
  const ui = await archiveUi(t);
  const detail = deferred();
  const old = ui.respond({ action: 'detail', payload: { id: ui.a.id } });
  ui.handlers.set('detail', async () => { await detail.promise; return old; });
  await ui.click({ fanId: ui.a.id });
  await ui.click({ fanAction: 'archived' });
  detail.resolve();
  await ui.flush();
  assert.match(ui.detail(), /选择一份档案/);
  ui.handlers.delete('detail');
  await ui.click({ fanAction: 'back-profiles' });
  await ui.click({ fanId: ui.a.id });
  const save = deferred();
  ui.handlers.set('save', async (input) => { await save.promise; return ui.respond(input); });
  await ui.click({ fanAction: 'archive' });
  await ui.click({ fanAction: 'archived' });
  await ui.click({ fanId: ui.b.id });
  save.resolve();
  await ui.flush();
  assert.match(ui.detail(), /归档观众B/);
  assert.doesNotMatch(ui.detail(), /当前观众A/);
});

test('archive invalidates a pending refresh of the same profile without cancelling another selection', async (t) => {
  for (const sameProfile of [true, false]) {
    const ui = await archiveUi(t);
    const c = ui.f.create({ alias: '当前观众C', identity: { ...IDENTITY, value: '900000003' } });
    await ui.click({ fanAction: 'refresh' });
    await ui.click({ fanId: ui.a.id });
    const save = deferred();
    const detail = deferred();
    ui.handlers.set('save', async (input) => { await save.promise; return ui.respond(input); });
    ui.handlers.set('detail', async (input) => { const result = ui.respond(input); await detail.promise; return result; });
    await ui.click({ fanAction: 'archive' });
    if (sameProfile) {
      ui.poll();
      await ui.flush();
    } else {
      await ui.click({ fanId: c.id });
    }
    save.resolve();
    await ui.flush();
    assert.match(ui.detail(), /选择一份档案/);
    assert.doesNotMatch(ui.people(), /当前观众A/);
    detail.resolve();
    await ui.flush();
    assert.match(ui.detail(), sameProfile ? /选择一份档案/ : /当前观众C/);
    assert.doesNotMatch(ui.detail(), /当前观众A/);
  }
});

test('reminder navigation aligns scope once and cannot overwrite subsequent selection', async (t) => {
  const ui = await archiveUi(t);
  await ui.click({ fanAction: 'archived' });
  await ui.search('B');
  await ui.click({ fanFilter: 'favorite' });
  await ui.click({ fanPage: 'reminders' });
  const loading = deferred();
  ui.handlers.set('list', async (input) => { await loading.promise; return ui.respond(input); });
  ui.calls.length = 0;
  await ui.click({ fanAction: 'open-reminder', profileId: ui.a.id });
  assert.equal(ui.scopes[0].getAttribute('aria-pressed'), 'true');
  assert.equal(ui.nodes.get('fanSearch').value, '');
  assert.match(ui.detail(), /选择一份档案/);
  loading.resolve();
  await ui.flush();
  assert.equal(ui.listCalls().length, 1);
  assert.deepEqual(ui.listCalls()[0].payload, { query: '', filters: [], archived: false });
  assert.match(ui.detail(), /保留私人资料/);
  await ui.search('A');
  ui.calls.length = 0;
  await ui.click({ fanAction: 'open-reminder', profileId: ui.a.id });
  assert.equal(ui.listCalls().length, 0);
  assert.equal(ui.nodes.get('fanSearch').value, 'A');
  await ui.click({ fanAction: 'archived' });
  const stale = deferred();
  ui.handlers.set('list', async (input) => { const response = ui.respond(input); await stale.promise; return response; });
  await ui.click({ fanAction: 'open-reminder', profileId: ui.a.id });
  ui.handlers.delete('list');
  await ui.click({ fanAction: 'archived' });
  await ui.click({ fanId: ui.b.id });
  stale.resolve();
  await ui.flush();
  assert.match(ui.detail(), /归档观众B/);
  assert.equal(ui.scopes[1].getAttribute('aria-pressed'), 'true');
});

test('context changes still invalidate selected details in archive scope', async (t) => {
  const ui = await archiveUi(t);
  await ui.click({ fanAction: 'archived' });
  await ui.click({ fanId: ui.b.id });
  ui.contextId = 'new-account-context';
  await ui.click({ fanAction: 'refresh' });
  assert.match(ui.detail(), /登录状态已变化/);
  assert.doesNotMatch(ui.detail(), /归档观众B/);
  assert.equal(ui.nodes.get('fanNewProfileButton').hidden, true);
});

test('archive scope controls live on the profiles page, not in settings or the notice', () => {
  const markup = fs.readFileSync(path.join(ROOT, 'public/pages/admin/toolbox/fan-profiles.html'), 'utf8');
  assert.match(markup, /role="group" aria-label="档案范围"/);
  assert.match(markup, /data-fan-action="back-profiles" aria-pressed="true">当前档案/);
  assert.match(markup, /data-fan-action="archived" aria-pressed="false">已归档/);
  assert.equal((markup.match(/data-fan-action="archived"/g) || []).length, 1);
  assert.equal((markup.match(/data-fan-action="back-profiles"/g) || []).length, 1);
  assert.doesNotMatch(markup, /已收起的档案|查看已收起|返回档案列表/);
});

test('archive empty states distinguish scope from search and never offer creation', async () => {
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const empty = view.renderPeople([], null, false, true);
  assert.match(empty, /暂无已归档档案。/);
  assert.match(empty, /归档后的档案会保留在这里，可随时恢复到主列表。/);
  assert.doesNotMatch(empty, /data-fan-action="(?:clear-filter|new)"/);
  const filtered = view.renderPeople([], null, true, true);
  assert.match(filtered, /没有找到符合条件的归档档案。/);
  assert.match(filtered, /data-fan-action="clear-filter"/);
  assert.doesNotMatch(filtered, /data-fan-action="new"/);
  assert.match(view.renderPeople([], null, false), /暂无粉丝档案/);
  assert.match(view.renderPeople([], null, true), /没有符合条件的档案/);
});

test('archived detail exposes one restore action outside more while current detail explains archive', async (t) => {
  const f = fanFixture(t);
  const profile = f.detail(f.create().id);
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const current = view.renderDetail(profile);
  assert.match(current, /<details class="fan-more">[\s\S]*data-fan-action="archive"[^>]*>归档档案/);
  assert.match(current, /保留资料与记录，归档期间不显示提醒。/);
  const archived = view.renderDetail({ ...profile, archived: true });
  assert.equal((archived.match(/data-fan-action="archive"/g) || []).length, 1);
  assert.match(archived, /data-fan-action="archive"[^>]*>恢复到主列表/);
  assert.ok(archived.indexOf('恢复到主列表') < archived.indexOf('<details class="fan-more">'));
  assert.doesNotMatch(archived, /收起档案|恢复档案|>归档档案</);
});

test('favorite stars follow the alias and current name while former names appear in basic details', async (t) => {
  const f = fanFixture(t);
  const p = f.create({ favorite: true, formerNames: ['<旧昵称>', '较早昵称'] });
  f.consume([{ name: '<新昵称>' }]);
  const profile = f.detail(p.id);
  const view = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/view.js'));
  const rendered = view.renderPeople([profile], p.id, false);
  assert.match(rendered, /小海<wbr><span class="fan-person-platform-name">（&lt;新昵称&gt;）<\/span><\/strong><span class="fan-favorite-star"[^>]*aria-label="特别关注"[^>]*>★/);
  assert.doesNotMatch(rendered, /常用称呼：|<新昵称>/);
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
  assert.match(description.fields, /列表优先显示常用称呼，括号内为最新平台昵称/);
  assert.match(description.fields, /name="formerNames"[^>]*>&lt;旧昵称&gt;\n较早昵称/);
  assert.doesNotMatch(description.fields, /name="alias"[^>]*required/);
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
  assert.match(aliased, /&lt;小海&gt;<wbr><span class="fan-person-platform-name">（海风）<\/span>/);
  assert.doesNotMatch(aliased, /<小海>/);
  for (const [alias, platformName, expected] of [
    ['', '海风', '海风'],
    ['小海', '', '小海'],
    ['海风', '海风', '海风'],
    ['', '', '未命名档案'],
  ]) {
    const rendered = view.renderPeople([{ id: 'name', alias, platformName }], null, false);
    assert.ok(rendered.includes(`>${expected}</strong>`));
    assert.doesNotMatch(rendered, /fan-person-platform-name|常用称呼：/);
  }
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
