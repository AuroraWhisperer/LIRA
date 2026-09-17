const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readAdminHtml } = require('./helpers/admin-html');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const saved = (enabled = false, messages = ['欢迎 {username}', '{username} 来啦']) => ({ ok: true, enabled, messages });
const account = (name) => ({ state: 'authorized', streamer: { accountName: name, songPageUrl: `https://${name}.example.test/` } });

async function fixture(initialProfile = account('one')) {
  function node() {
    return { value: '', checked: false, disabled: false, textContent: '', children: [], events: {},
      append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); },
      replaceChildren(...items) { this.children = items; }, setAttribute(key, value) { this[key] = value; },
      addEventListener(key, fn) { this.events[key] = fn; }, removeEventListener(key) { delete this.events[key]; }, focus() {},
    };
  }
  const nodes = new Map(), reads = [], writes = [], toasts = [];
  const get = (suffix) => {
    if (!nodes.has(suffix)) nodes.set(suffix, node());
    return nodes.get(suffix);
  };
  let listener;
  const windowRef = node();
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../public/js/admin/danmaku-welcome.js'), 'utf8'), { context });
  await module.link(() => {}); await module.evaluate();
  module.namespace.initDanmakuWelcome({
    documentRef: { getElementById: (id) => get(id.replace('danmakuWelcome', '')), createElement: node }, windowRef,
    bridge: { getProfile: async () => initialProfile, onStateChanged: (fn) => { listener = fn; return () => {}; },
      getWelcomeSettings: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
      updateWelcomeSettings: (patch) => new Promise((resolve, reject) => writes.push({ patch: JSON.parse(JSON.stringify(patch)), resolve, reject })),
    }, toast: (value) => toasts.push(value),
  });
  await flush();
  return { get, reads, writes, toasts, account: (name) => listener(account(name)),
    change: (suffix) => get(suffix).events.change(), click: (suffix) => get(suffix).events.click(),
    edit: (index, value) => { const field = get('List').children[index].children[1]; field.value = value; field.events.input(); },
  };
}

test('welcome switch and library follow the existing fixed-reply layout', () => {
  const html = readAdminHtml();
  assert.match(html, /id="danmakuWelcomeToggle" type="checkbox" disabled/);
  assert.match(html, /<details id="danmakuWelcomePanel" class="danmaku-blessings-section">/);
  assert.ok(html.indexOf('id="danmakuWelcomePanel"') > html.indexOf('id="danmakuFortunesPanel"'));
  assert.match(html, /id="danmakuWelcomeList" class="danmaku-blessing-list"/);
  assert.match(html, /舰长、提督、总督/);
});

test('loads server settings and saves switch independently from message drafts', async () => {
  const f = await fixture();
  assert.equal(f.get('Toggle').disabled, true);
  f.reads[0].resolve(saved()); await flush();
  assert.equal(f.get('Count').textContent, '2 条');
  f.edit(0, '草稿 {username}');
  f.get('Toggle').checked = true; f.change('Toggle');
  assert.deepEqual(f.writes[0].patch, { enabled: true });
  assert.equal(f.get('Toggle').disabled, true);
  f.writes[0].resolve(saved(true)); await flush();
  assert.equal(f.get('Toggle').checked, true);
  assert.equal(f.get('List').children[0].children[1].value, '草稿 {username}');
  assert.equal(f.get('SaveBtn').disabled, false);
});

test('refresh preserves edits made while the server read is pending', async () => {
  const f = await fixture(); f.reads[0].resolve(saved()); await flush();
  f.click('RefreshBtn');
  f.edit(0, '刷新期间的草稿 {username}');
  f.reads[1].resolve(saved(true, ['服务器词库 {username}'])); await flush();
  assert.equal(f.get('Toggle').checked, true);
  assert.equal(f.get('List').children[0].children[1].value, '刷新期间的草稿 {username}');
  assert.equal(f.get('SaveBtn').disabled, false);
  assert.match(f.get('Status').textContent, /未保存/);
});

test('an unauthorized account shows a stable explanation without reading settings', async () => {
  const f = await fixture({ state: 'unbound' });
  assert.equal(f.reads.length, 0);
  assert.equal(f.get('Toggle').disabled, true);
  assert.match(f.get('Status').textContent, /连接已授权账号/);
});

test('add, delete and save messages, preserving edits made during a save', async () => {
  const f = await fixture(); f.reads[0].resolve(saved()); await flush();
  f.get('Input').value = '新增 {username}'; f.click('AddBtn');
  f.get('List').children[1].children[2].events.click();
  f.click('SaveBtn');
  assert.deepEqual(f.writes[0].patch, { messages: ['欢迎 {username}', '新增 {username}'] });
  f.edit(0, '<img src=x onerror=bad> {username}');
  f.writes[0].resolve(saved(false, f.writes[0].patch.messages)); await flush();
  assert.equal(f.get('List').children[0].children[1].value, '<img src=x onerror=bad> {username}');
  assert.equal(f.get('SaveBtn').disabled, false);
  f.click('SaveBtn'); f.writes[1].resolve(saved(false, f.writes[1].patch.messages)); await flush();
  assert.equal(f.get('SaveBtn').disabled, true);
  assert.match(f.get('Status').textContent, /已保存 2 条/);
});

test('failed writes are not reported as saved, and failed disable warns of unconfirmed state', async () => {
  const f = await fixture(); f.reads[0].resolve(saved(true)); await flush();
  f.get('Toggle').checked = false; f.change('Toggle');
  f.writes[0].resolve({ ok: false, error: 'NETWORK_UNAVAILABLE' }); await flush();
  assert.equal(f.get('Toggle').checked, true);
  assert.match(f.get('Status').textContent, /关闭尚未确认/);
  f.edit(0, '仍在草稿 {username}'); f.click('SaveBtn');
  f.writes[1].reject(new Error('连接失败')); await flush();
  assert.equal(f.get('SaveBtn').disabled, false);
  assert.equal(f.get('List').children[0].children[1].value, '仍在草稿 {username}');
});

test('account switches clear drafts and discard old reads and writes', async () => {
  const f = await fixture();
  f.account('two'); f.reads[0].resolve(saved(true)); await flush();
  assert.equal(f.get('Toggle').disabled, true);
  f.reads[1].resolve(saved(false, ['二号 {username}'])); await flush();
  f.edit(0, '二号草稿 {username}'); f.click('SaveBtn');
  f.account('three');
  f.writes[0].resolve(saved(true, ['旧账号'])); await flush();
  assert.equal(f.get('List').children.length, 0);
  f.reads[2].resolve(saved(false, ['三号 {username}'])); await flush();
  assert.equal(f.get('List').children[0].children[1].value, '三号 {username}');
  assert.equal(f.get('SaveBtn').disabled, true);
});
