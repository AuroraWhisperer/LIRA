const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const saved = (enabled) => ({ ok: true, enabled });
const account = (name) => ({
  state: 'authorized',
  streamer: { accountName: name, songPageUrl: `https://${name}.example.test/` },
});

async function fixture(profile = account('one')) {
  const nodes = new Map(),
    reads = [],
    writes = [],
    toasts = [];
  const get = (key) => {
    if (!nodes.has(key))
      nodes.set(key, {
        checked: false,
        disabled: false,
        textContent: '',
        events: {},
        addEventListener(name, fn) {
          this.events[name] = fn;
        },
        removeEventListener(name) {
          delete this.events[name];
        },
      });
    return nodes.get(key);
  };
  let listener,
    unsubscribed = false;
  const module = new vm.SourceTextModule(
    fs.readFileSync(path.join(__dirname, '../../public/js/admin/danmaku-pk-report.js'), 'utf8'),
    { context: vm.createContext({}) },
  );
  await module.link(() => {});
  await module.evaluate();
  const controller = module.namespace.initDanmakuPkReport({
    toast: (message, options) => toasts.push({ message, options }),
    documentRef: { getElementById: (id) => get(id.replace('danmakuPkReport', '')) },
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
    toggle: (value) => {
      get('Toggle').checked = value;
      get('Toggle').events.change();
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
  assert.match(f.toasts.at(-1).message, /关闭尚未同步，服务器可能仍在播报/);
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
