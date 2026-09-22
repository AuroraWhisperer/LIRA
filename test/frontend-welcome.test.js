const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { readAdminHtml } = require('./helpers/admin-html');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const saved = (enabled = false, messages = ['欢迎 {username}', '{username} 来啦']) => ({ ok: true, enabled, messages });
const account = (name) => ({
  state: 'authorized',
  streamer: { accountName: name, songPageUrl: `https://${name}.example.test/` },
});

async function fixture(initialProfile = account('one'), v2 = false) {
  function node() {
    return {
      value: '',
      checked: false,
      disabled: false,
      textContent: '',
      children: [],
      events: {},
      dataset: {},
      hidden: false,
      append(...items) {
        this.children.push(...items);
      },
      appendChild(item) {
        this.children.push(item);
      },
      replaceChildren(...items) {
        this.children = items;
      },
      setAttribute(key, value) {
        this[key] = value;
      },
      addEventListener(key, fn) {
        this.events[key] = fn;
      },
      removeEventListener(key) {
        delete this.events[key];
      },
      focus() {},
      dispatchEvent() {},
    };
  }
  const nodes = new Map(),
    reads = [],
    writes = [],
    toasts = [];
  const get = (suffix) => {
    if (!nodes.has(suffix)) nodes.set(suffix, node());
    return nodes.get(suffix);
  };
  let listener;
  const windowRef = node();
  const module = await loadModuleExports(path.join(__dirname, '../public/js/admin/danmaku-welcome.js'));
  windowRef.CustomEvent = class {
    constructor(type) {
      this.type = type;
    }
  };
  const bridge = {
    getProfile: async () => initialProfile,
    onStateChanged: (fn) => {
      listener = fn;
      return () => {};
    },
    getWelcomeSettings: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    updateWelcomeSettings: (patch) =>
      new Promise((resolve, reject) => writes.push({ patch: JSON.parse(JSON.stringify(patch)), resolve, reject })),
  };
  if (v2) {
    bridge.getWelcomeSettingsV2 = bridge.getWelcomeSettings;
    bridge.updateWelcomeSettingsV2 = bridge.updateWelcomeSettings;
  }
  module.initDanmakuWelcome({
    documentRef: {
      getElementById: (id) => get(id.replace('danmakuWelcome', '')),
      createElement: node,
      querySelectorAll: () => [],
    },
    windowRef,
    bridge,
    toast: (value) => toasts.push(value),
  });
  await flush();
  return {
    get,
    reads,
    writes,
    toasts,
    account: (name) => listener(account(name)),
    change: (suffix) => get(suffix).events.change(),
    click: (suffix) => get(suffix).events.click(),
    edit: (index, value) => {
      const field = get('List').children[index].children[1];
      field.value = value;
      field.events.input();
    },
    parameter: (key, value) => {
      get(key).value = value;
      get(key).events.input();
    },
    library: (key) => {
      get('LibraryKind').value = key;
      get('LibraryKind').events.change();
    },
  };
}

test('welcome uses the compact single-editor layout and retains all six feature controls', () => {
  const html = readAdminHtml();
  assert.match(html, /id="danmakuWelcomeToggle"\s+type="checkbox"\s+disabled/);
  assert.match(html, /<section id="danmakuWelcomePanel" data-fixed-editor="welcome" hidden/);
  assert.ok(html.indexOf('id="danmakuWelcomePanel"') > html.indexOf('id="danmakuCustomRepliesPanel"'));
  assert.match(html, /id="danmakuWelcomeList" class="danmaku-blessing-list"/);
  assert.match(html, /舰长、提督、总督/);
  assert.equal((html.match(/data-fixed-open=/g) || []).length, 4);
  assert.equal((html.match(/data-fixed-item=/g) || []).length, 6);
  assert.equal((html.match(/id="danmakuWelcomeToggle"/g) || []).length, 1);
  assert.match(html, /id="danmakuWelcomePinyinToggle"/);
});

test('loads server settings and saves switch independently from message drafts', async () => {
  const f = await fixture();
  assert.equal(f.get('Toggle').disabled, true);
  f.reads[0].resolve(saved());
  await flush();
  assert.equal(f.get('Count').textContent, '2 条');
  f.edit(0, '草稿 {username}');
  f.get('Toggle').checked = true;
  f.change('Toggle');
  assert.deepEqual(f.writes[0].patch, { enabled: true });
  assert.equal(f.get('Toggle').disabled, true);
  f.writes[0].resolve(saved(true));
  await flush();
  assert.equal(f.get('Toggle').checked, true);
  assert.equal(f.get('List').children[0].children[1].value, '草稿 {username}');
  assert.equal(f.get('SaveBtn').disabled, false);
});

test('refresh preserves edits made while the server read is pending', async () => {
  const f = await fixture();
  f.reads[0].resolve(saved());
  await flush();
  f.click('RefreshBtn');
  f.edit(0, '刷新期间的草稿 {username}');
  f.reads[1].resolve(saved(true, ['服务器词库 {username}']));
  await flush();
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
  const f = await fixture();
  f.reads[0].resolve(saved());
  await flush();
  f.get('Input').value = '新增 {username}';
  f.click('AddBtn');
  f.get('List').children[1].children[2].events.click();
  f.click('SaveBtn');
  assert.deepEqual(f.writes[0].patch, { messages: ['欢迎 {username}', '新增 {username}'] });
  f.edit(0, '<img src=x onerror=bad> {username}');
  f.writes[0].resolve(saved(false, f.writes[0].patch.messages));
  await flush();
  assert.equal(f.get('List').children[0].children[1].value, '<img src=x onerror=bad> {username}');
  assert.equal(f.get('SaveBtn').disabled, false);
  f.click('SaveBtn');
  f.writes[1].resolve(saved(false, f.writes[1].patch.messages));
  await flush();
  assert.equal(f.get('SaveBtn').disabled, true);
  assert.match(f.get('Status').textContent, /已保存 2 条/);
});

test('failed writes are not reported as saved, and failed disable warns of unconfirmed state', async () => {
  const f = await fixture();
  f.reads[0].resolve(saved(true));
  await flush();
  f.get('Toggle').checked = false;
  f.change('Toggle');
  f.writes[0].resolve({ ok: false, error: 'NETWORK_UNAVAILABLE' });
  await flush();
  assert.equal(f.get('Toggle').checked, true);
  assert.match(f.get('Status').textContent, /关闭尚未确认/);
  f.edit(0, '仍在草稿 {username}');
  f.click('SaveBtn');
  f.writes[1].reject(new Error('连接失败'));
  await flush();
  assert.equal(f.get('SaveBtn').disabled, false);
  assert.equal(f.get('List').children[0].children[1].value, '仍在草稿 {username}');
});

test('account switches clear drafts and discard old reads and writes', async () => {
  const f = await fixture();
  f.account('two');
  f.reads[0].resolve(saved(true));
  await flush();
  assert.equal(f.get('Toggle').disabled, true);
  f.reads[1].resolve(saved(false, ['二号 {username}']));
  await flush();
  f.edit(0, '二号草稿 {username}');
  f.click('SaveBtn');
  f.account('three');
  f.writes[0].resolve(saved(true, ['旧账号']));
  await flush();
  assert.equal(f.get('List').children.length, 0);
  f.reads[2].resolve(saved(false, ['三号 {username}']));
  await flush();
  assert.equal(f.get('List').children[0].children[1].value, '三号 {username}');
  assert.equal(f.get('SaveBtn').disabled, true);
});

const savedV2 = (patch = {}) => ({
  ok: true,
  schemaVersion: 2,
  enabled: false,
  welcomeDelaySeconds: 0,
  welcomeMinHonorLevel: 0,
  greetingEnabled: false,
  greetingDelaySeconds: 10,
  greetingMinHonorLevel: 0,
  attentionEnabled: false,
  attentionMinHonorLevel: 31,
  rareNamePinyinEnabled: false,
  messages: ['欢迎 {username}', '{username} 来啦'],
  greetingMessages: ['{username}，你好呀～'],
  attentionWelcomeMessages: ['专属 {username}'],
  attentionGreetingMessages: ['{username}，来点歌吧'],
  ...patch,
});

test('suggestions only edit the draft; enabling atomically includes parameters and leaves libraries dirty', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(savedV2());
  await flush();
  f.edit(0, '草稿 {username}');
  f.click('SuggestBtn');
  assert.equal(f.writes.length, 0);
  assert.equal(f.get('Toggle').checked, false);
  assert.match(f.get('OverviewStatus').textContent, /开启并保存参数/);
  f.get('Toggle').checked = true;
  f.change('Toggle');
  assert.deepEqual(f.writes[0].patch, {
    enabled: true,
    welcomeDelaySeconds: 5,
    welcomeMinHonorLevel: 10,
    greetingDelaySeconds: 10,
    greetingMinHonorLevel: 10,
    attentionMinHonorLevel: 31,
  });
  f.writes[0].resolve(savedV2(f.writes[0].patch));
  await flush();
  assert.equal(f.get('GreetingToggle').checked, false);
  assert.equal(f.get('AttentionToggle').checked, false);
  assert.equal(f.get('ParameterSaveBtn').disabled, true);
  assert.equal(f.get('SaveBtn').disabled, false);
  assert.equal(f.get('List').children[0].children[1].value, '草稿 {username}');
});

test('parameter and four library domains preserve edits while writes serialize', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(savedV2({ enabled: true }));
  await flush();
  f.parameter('welcomeDelaySeconds', '5');
  f.edit(0, '欢迎草稿');
  f.library('greetingMessages');
  f.edit(0, '问候草稿');
  f.click('ParameterSaveBtn');
  f.parameter('welcomeDelaySeconds', '6');
  f.click('SaveBtn');
  assert.equal(f.writes.length, 1);
  f.writes[0].resolve(savedV2({ enabled: true, welcomeDelaySeconds: 5 }));
  await flush();
  assert.equal(f.get('welcomeDelaySeconds').value, '6');
  assert.equal(f.get('SaveBtn').disabled, false);
  f.click('SaveBtn');
  assert.deepEqual(f.writes[1].patch, { greetingMessages: ['问候草稿'] });
  f.library('messages');
  f.writes[1].resolve(savedV2({ enabled: true, welcomeDelaySeconds: 5, greetingMessages: ['问候草稿'] }));
  await flush();
  assert.equal(f.get('List').children[0].children[1].value, '欢迎草稿');
  assert.equal(f.get('SaveBtn').disabled, false);
  assert.equal(f.get('ParameterSaveBtn').disabled, false);
  f.library('greetingMessages');
  assert.equal(f.get('SaveBtn').disabled, true);
});

test('invalid greeting delay blocks enabling/saving but pure disable still submits', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(savedV2({ enabled: true, greetingEnabled: true }));
  await flush();
  f.parameter('welcomeDelaySeconds', '20');
  f.click('ParameterSaveBtn');
  assert.equal(f.writes.length, 0);
  assert.match(f.get('greetingDelaySecondsError').textContent, /大于/);
  f.get('Toggle').checked = false;
  f.change('Toggle');
  assert.deepEqual(f.writes[0].patch, { enabled: false });
  f.writes[0].resolve(savedV2());
  await flush();
  assert.equal(f.get('GreetingToggle').checked, false);
  assert.equal(f.get('GreetingToggle').disabled, true);
  assert.equal(f.get('welcomeDelaySeconds').value, '20');
});

test('empty first-delay and stage levels submit zero; unsupported and malformed replies stay distinct', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(savedV2());
  await flush();
  f.parameter('welcomeDelaySeconds', '');
  f.parameter('welcomeMinHonorLevel', '');
  f.parameter('greetingMinHonorLevel', '');
  f.click('ParameterSaveBtn');
  assert.equal(f.writes[0].patch.welcomeDelaySeconds, 0);
  assert.equal(f.writes[0].patch.welcomeMinHonorLevel, 0);
  f.writes[0].resolve({ ok: true, enabled: true });
  await flush();
  assert.equal(f.get('Toggle').checked, false);
  assert.equal(f.get('ParameterSaveBtn').disabled, false);
  const old = await fixture(account('old'), true);
  old.reads[0].resolve({ ...saved(), schemaVersion: 1 });
  await flush();
  assert.equal(old.get('Toggle').disabled, false);
  assert.equal(old.get('GreetingToggle').disabled, true);
  assert.equal(old.get('Capability').hidden, false);
  const failed = await fixture(account('failed'), true);
  failed.reads[0].resolve({ ok: false, error: 'HTTP_403' });
  await flush();
  assert.equal(failed.get('Toggle').disabled, true);
  assert.equal(failed.get('Capability').hidden, true);
  assert.equal(failed.get('ServerStatus').hidden, false);
  const malformed = await fixture(account('malformed'), true);
  malformed.reads[0].resolve({ ...savedV2(), greetingDelaySeconds: '10' });
  await flush();
  assert.equal(malformed.get('ServerStatus').hidden, false);
  assert.match(malformed.get('OverviewStatus').textContent, /尚未确认/);
});

test('sample preview identifies draft/confirmed values, unknown honor and the five-second gap', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(
    savedV2({
      enabled: true,
      greetingEnabled: true,
      welcomeDelaySeconds: 5,
      greetingDelaySeconds: 6,
      welcomeMinHonorLevel: 20,
      greetingMinHonorLevel: 10,
    }),
  );
  await flush();
  assert.match(f.get('PreviewSecond').textContent, /10 秒/);
  assert.match(f.get('DependencyHint').textContent, /至少 20 级/);
  f.get('PreviewLevel').value = 'unknown';
  f.change('PreviewLevel');
  assert.match(f.get('PreviewFirst').textContent, /等级未知/);
  f.parameter('welcomeDelaySeconds', '30');
  assert.match(f.get('PreviewSummary').textContent, /草稿有错误/);
  f.get('PreviewSource').value = 'confirmed';
  f.change('PreviewSource');
  assert.match(f.get('PreviewSummary').textContent, /已确认设置/);
  assert.equal(f.writes.length, 0);
});
