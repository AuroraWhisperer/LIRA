const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const saved = (enabled) => ({ ok: true, enabled });
const extended = (patch = {}) => ({
  ok: true, enabled: true, reportEnabled: true, visitorWelcomeEnabled: false,
  visitorWelcomeDelaySeconds: 5, visitorWelcomeMessages: ['欢迎 {username} 从对面来串门～'], ...patch,
});
const account = (name) => ({
  state: 'authorized',
  streamer: { accountName: name, songPageUrl: `https://${name}.example.test/` },
});

async function fixture(profile = account('one')) {
  const nodes = new Map(),
    reads = [],
    writes = [],
    toasts = [];
  const node = () => ({
    checked: false,
    disabled: false,
    textContent: '',
    value: '',
    children: [],
    events: {},
    attributes: {},
    addEventListener(name, fn) { this.events[name] = fn; },
    removeEventListener(name) { delete this.events[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); },
    replaceChildren(...items) { this.children = items; },
    focus() { this.focused = true; },
  });
  const get = (key) => {
    if (!nodes.has(key))
      nodes.set(key, node());
    return nodes.get(key);
  };
  let listener,
    unsubscribed = false;
  const { initDanmakuPkReport } = await loadModuleExports(path.join(__dirname, '../../public/js/admin/danmaku-pk-report.js'));
  const controller = initDanmakuPkReport({
    toast: (message, options) => toasts.push({ message, options }),
    documentRef: { getElementById: (id) => get(id.replace('danmakuPkReport', '')), createElement: node },
    windowRef: get('window'),
    bridge: {
      getState: async () => profile,
      onStateChanged: (fn) => {
        listener = fn;
        return () => {
          unsubscribed = true;
        };
      },
      getPkReportSettings: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
      updatePkReportSettings: (patch) =>
        new Promise((resolve, reject) => writes.push({ patch: JSON.parse(JSON.stringify(patch)), resolve, reject })),
    },
  });
  await flush();
  return {
    get,
    reads,
    writes,
    toasts,
    refresh: controller.refresh,
    account: (name) => listener(account(name)),
    toggle: (value, suffix = 'Toggle') => {
      get(suffix).checked = value;
      get(suffix).events.change();
    },
    input: (suffix, value) => { get(suffix).value = value; get(suffix).events.input(); },
    message: (value) => {
      const field = get('List').children[0].children[1];
      field.value = value;
      field.events.input();
    },
    disposed: () => unsubscribed,
  };
}

test('pending and failed writes preserve confirmed state, failed disable warns explicitly', async () => {
  const f = await fixture();
  assert.equal(f.get('Toggle').disabled, true);
  f.reads[0].resolve(saved(false));
  await flush();
  f.toggle(true);
  assert.deepEqual(f.writes[0].patch, { enabled: true });
  assert.equal(f.get('Toggle').checked, false);
  assert.equal(f.get('Toggle').disabled, true);
  f.writes[0].resolve(saved(true));
  await flush();
  assert.equal(f.get('Toggle').checked, true);
  f.toggle(false);
  f.writes[1].reject(new Error('offline'));
  await flush();
  assert.equal(f.get('Toggle').checked, true);
  assert.equal(f.toasts.at(-1).options.type, 'error');
});

test('old server is unavailable and explicit refresh can recover', async () => {
  const f = await fixture();
  f.reads[0].resolve({ ok: false, error: 'NOT_FOUND' });
  await flush();
  assert.equal(f.get('Toggle').disabled, true);
  const refreshing = f.refresh();
  f.reads[1].resolve(saved(false));
  await refreshing;
  await flush();
  assert.equal(f.get('Toggle').disabled, false);
});

test('account changes and page disposal discard late reads and writes', async () => {
  const f = await fixture();
  f.account('two');
  f.reads[0].resolve(saved(true));
  await flush();
  assert.equal(f.get('Toggle').checked, false);
  f.reads[1].resolve(saved(false));
  await flush();
  f.toggle(true);
  f.account('three');
  f.writes[0].resolve(saved(true));
  await flush();
  assert.equal(f.get('Toggle').checked, false);
  assert.equal(f.get('Toggle').disabled, true);
  f.get('window').events.pagehide();
  f.reads[2].resolve(saved(true));
  await flush();
  assert.equal(f.disposed(), true);
  assert.equal(f.get('Toggle').checked, false);
});

test('unauthorized profiles cannot read settings', async () => {
  const f = await fixture({ state: 'unbound' });
  assert.equal(f.reads.length, 0);
  assert.equal(f.get('Toggle').disabled, true);
});

test('authorized PK settings load without a song page URL', async () => {
  const f = await fixture({ state: 'authorized', streamer: { accountName: 'one' } });
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(saved(true));
  await flush();
  assert.equal(f.get('Toggle').disabled, false);
  assert.equal(f.get('Toggle').checked, true);
});

test('extended switches save independently and master close preserves selections and drafts', async () => {
  const f = await fixture();
  f.reads[0].resolve(extended());
  await flush();
  f.input('Delay', '12');
  f.message('未保存的串门欢迎 {username}');
  f.toggle(true, 'VisitorToggle');
  assert.deepEqual(f.writes[0].patch, { visitorWelcomeEnabled: true });
  f.writes[0].resolve(extended({ visitorWelcomeEnabled: true }));
  await flush();
  assert.equal(f.get('Delay').value, '12');
  assert.equal(f.get('List').children[0].children[1].value, '未保存的串门欢迎 {username}');
  f.toggle(false);
  assert.deepEqual(f.writes[1].patch, { enabled: false });
  f.writes[1].resolve(extended({ enabled: false, visitorWelcomeEnabled: true }));
  await flush();
  assert.equal(f.get('ReportToggle').checked, true);
  assert.equal(f.get('VisitorToggle').checked, true);
  f.get('SaveBtn').events.click();
  assert.deepEqual(f.writes[2].patch, {
    visitorWelcomeDelaySeconds: 12, visitorWelcomeMessages: ['未保存的串门欢迎 {username}'],
  });
  f.writes[2].resolve(extended({ enabled: false, visitorWelcomeDelaySeconds: 12,
    visitorWelcomeMessages: ['未保存的串门欢迎 {username}'] }));
  await flush();
  assert.equal(f.get('SaveBtn').disabled, true);
});

test('welcome settings preserve edits during pending save and refresh, then discard to confirmed values', async () => {
  const f = await fixture();
  f.reads[0].resolve(extended());
  await flush();
  f.input('Delay', '8');
  f.message('欢迎新朋友 {username}');
  f.get('SaveBtn').events.click();
  f.input('Delay', '9');
  f.message('保存期间继续修改 {username}');
  f.writes[0].resolve(extended({ visitorWelcomeDelaySeconds: 8, visitorWelcomeMessages: ['欢迎新朋友 {username}'] }));
  await flush();
  assert.equal(f.get('Delay').value, '9');
  assert.equal(f.get('List').children[0].children[1].value, '保存期间继续修改 {username}');
  assert.equal(f.get('SaveBtn').disabled, false);
  const refreshing = f.refresh();
  f.reads[1].resolve(extended({ visitorWelcomeDelaySeconds: 8, visitorWelcomeMessages: ['欢迎新朋友 {username}'] }));
  await refreshing;
  assert.equal(f.get('Delay').value, '9');
  f.get('DiscardBtn').events.click();
  assert.equal(f.get('Delay').value, '8');
  assert.equal(f.get('List').children[0].children[1].value, '欢迎新朋友 {username}');
  assert.equal(f.get('SaveBtn').disabled, true);
});

test('failed welcome saves retain drafts; invalid delay/messages never reach the bridge', async () => {
  const f = await fixture();
  f.reads[0].resolve(extended());
  await flush();
  f.input('Delay', '301');
  f.get('SaveBtn').events.click();
  assert.equal(f.writes.length, 0);
  f.input('Delay', '0');
  f.message('');
  f.get('SaveBtn').events.click();
  assert.equal(f.writes.length, 0);
  f.message('即时欢迎 {username}');
  f.get('SaveBtn').events.click();
  f.writes[0].reject(new Error('offline'));
  await flush();
  assert.equal(f.get('Delay').value, '0');
  assert.equal(f.get('SaveBtn').disabled, false);
  assert.equal(f.toasts.at(-1).options.type, 'error');
  f.account('two');
  assert.equal(f.get('Delay').value, '');
  assert.equal(f.get('List').children.length, 0);
  assert.equal(f.get('Input').value, '');
});

test('legacy server permits master updates and prevents unsupported welcome saves', async () => {
  const legacy = await fixture();
  legacy.reads[0].resolve(saved(true));
  await flush();
  legacy.toggle(true, 'VisitorToggle');
  legacy.input('Delay', '8');
  legacy.get('SaveBtn').events.click();
  assert.equal(legacy.writes.length, 0);
  legacy.toggle(false);
  assert.deepEqual(legacy.writes[0].patch, { enabled: false });
  legacy.writes[0].resolve(saved(false));
  await flush();
  assert.equal(legacy.get('Toggle').checked, false);
});

test('legacy acknowledgement cannot confirm new welcome settings or erase its draft', async () => {
  const f = await fixture();
  f.reads[0].resolve(extended());
  await flush();
  f.input('Delay', '7');
  f.get('SaveBtn').events.click();
  f.writes[0].resolve(saved(true));
  await flush();
  assert.equal(f.get('Delay').value, '7');
  assert.equal(f.get('SaveBtn').disabled, false);
  assert.equal(f.toasts.at(-1).options.type, 'error');
});
