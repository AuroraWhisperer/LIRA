'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { fanFixture, IDENTITY } = require('../helpers/fan-profile-fixture');
const { createDom, createClock } = require('../helpers/toast-dom');

const ROOT = path.join(__dirname, '../..');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
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
  const ui = {
    f,
    a,
    b,
    note,
    filters,
    scopes,
    nodes,
    clock,
    calls: [],
    handlers: new Map(),
    contextId: 'test-context',
  };
  ui.respond = ({ action, payload }) => ({
    ok: true,
    contextId: ui.contextId,
    syncStatus: 'offline',
    data: f.run(action === 'open' ? 'list' : action, payload),
  });
  windowRef.fanProfiles = {
    invoke: async (input) => {
      ui.calls.push(structuredClone(input));
      try {
        return await (ui.handlers.get(input.action)?.(input) ?? ui.respond(input));
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
  };
  const mod = await loadModuleExports(path.join(ROOT, 'public/js/admin/fans/index.js'), {
    document: documentRef,
    window: windowRef,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: (callback) => {
      ui.poll = callback;
      return 1;
    },
    clearInterval() {},
    MutationObserver: class {
      constructor(callback) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
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
    if (wait) {
      clock.tick(180);
      await ui.flush();
    }
  };
  ui.listCalls = () => ui.calls.filter((call) => ['open', 'list'].includes(call.action));
  ui.people = () => nodes.get('fanPeople').innerHTML;
  ui.detail = () => nodes.get('fanDetail').innerHTML;
  ui.notices = () => container.textContent;
  t.after(() => {
    for (const listener of windowListeners.get('pagehide') || []) listener();
  });
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
  ui.handlers.set('list', async () => {
    await old.promise;
    return snapshot;
  });
  await ui.search('A');
  ui.handlers.set('list', async () => {
    throw new Error('读取测试失败');
  });
  await ui.click({ fanAction: 'archived' });
  assert.match(ui.people(), /加载失败/);
  assert.doesNotMatch(ui.people(), /data-fan-id|暂无已归档档案/);
  assert.match(ui.nodes.get('fanPageError').textContent, /读取测试失败/);
  old.resolve();
  await ui.flush();
  assert.doesNotMatch(ui.people(), /当前观众A/);
  const loading = deferred();
  ui.handlers.set('open', async (input) => {
    await loading.promise;
    return ui.respond(input);
  });
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
  ui.handlers.set('save', async (input) => {
    await saved.promise;
    return ui.respond(input);
  });
  await ui.click({ fanAction: 'archive' });
  assert.match(ui.people(), /当前观众A/);
  assert.match(ui.detail(), /保留私人资料/);
  assert.doesNotMatch(ui.notices(), /已归档/);
  saved.resolve();
  await ui.flush();
  assert.doesNotMatch(ui.people(), /当前观众A/);
  assert.match(ui.detail(), /选择一份档案/);
  assert.match(ui.notices(), /已归档，资料仍保留/);
  assert.equal(
    ui.f.run('reminders').some((item) => item.profileId === ui.a.id),
    false,
  );
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
  ui.handlers.set('save', async () => {
    throw new Error('保存测试失败');
  });
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
  ui.handlers.set('list', async () => {
    throw new Error('列表刷新失败');
  });
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
  ui.handlers.set('detail', async () => {
    await detail.promise;
    return old;
  });
  await ui.click({ fanId: ui.a.id });
  await ui.click({ fanAction: 'archived' });
  detail.resolve();
  await ui.flush();
  assert.match(ui.detail(), /选择一份档案/);
  ui.handlers.delete('detail');
  await ui.click({ fanAction: 'back-profiles' });
  await ui.click({ fanId: ui.a.id });
  const save = deferred();
  ui.handlers.set('save', async (input) => {
    await save.promise;
    return ui.respond(input);
  });
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
    ui.handlers.set('save', async (input) => {
      await save.promise;
      return ui.respond(input);
    });
    ui.handlers.set('detail', async (input) => {
      const result = ui.respond(input);
      await detail.promise;
      return result;
    });
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
  ui.handlers.set('list', async (input) => {
    await loading.promise;
    return ui.respond(input);
  });
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
  ui.handlers.set('list', async (input) => {
    const response = ui.respond(input);
    await stale.promise;
    return response;
  });
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
