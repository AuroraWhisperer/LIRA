const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
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
    toasts = [],
    toastOptions = [];
  const get = (suffix) => {
    if (!nodes.has(suffix)) nodes.set(suffix, node());
    return nodes.get(suffix);
  };
  let listener;
  const windowRef = node();
  for (const [suffix, title] of Object.entries({
    Title: '进场欢迎',
    GreetingTitle: '二次问候',
    AttentionTitle: '重点关注',
    ReturningTitle: '久别重逢',
    PinyinTitle: '昵称生僻字自动注音',
  }))
    get(suffix).textContent = title;
  const module = await loadModuleExports(path.join(__dirname, '../../public/js/admin/danmaku-welcome.js'));
  windowRef.CustomEvent = class {
    constructor(type) {
      this.type = type;
    }
  };
  const bridge = {
    getState: async () => initialProfile,
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
    toast: (value, options) => {
      toasts.push(value);
      toastOptions.push(options);
    },
  });
  await flush();
  return {
    get,
    reads,
    writes,
    toasts,
    toastOptions,
    account: (name) => listener(account(name)),
    change: (suffix) => get(suffix).events.change(),
    click: (suffix) => get(suffix).events.click(),
    edit: (index, value) => {
      const field = get('List').children[index].children[1];
      field.value = value;
      field.events.input();
    },
    customEdit: (index, key, value) => {
      const field = get('CustomList').children[index].children[key === 'uid' ? 0 : 1].children[1];
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

test('welcome exposes unique initially unavailable controls in its hidden editor', () => {
  const html = readAdminFragmentHtml('pages/admin/toolbox/danmaku.html');
  const tags = [...html.matchAll(/<[^/!][^>]*>/g)].map(([tag]) => tag);
  const uniqueTag = (id) => {
    const matches = tags.filter((tag) => new RegExp(`\\sid\\s*=\\s*["']${id}["']`).test(tag));
    assert.equal(matches.length, 1, id);
    return matches[0];
  };
  const toggle = uniqueTag('danmakuWelcomeToggle');
  assert.match(toggle, /<input\b/);
  assert.match(toggle, /\stype=["']checkbox["']/);
  assert.match(toggle, /\sdisabled(?:\s|>|=)/);
  const panel = uniqueTag('danmakuWelcomePanel');
  assert.match(panel, /\sdata-fixed-editor=["']welcome["']/);
  assert.match(panel, /\shidden(?:\s|>|=)/);
  uniqueTag('danmakuWelcomeList');
  uniqueTag('danmakuWelcomePinyinToggle');
  assert.doesNotMatch(html, /danmakuWelcomePreview/);
  for (const suffix of ['CustomList', 'CustomAddBtn', 'CustomSaveBtn']) uniqueTag(`danmakuWelcome${suffix}`);
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
  assert.match(f.toasts.at(-1), /进场欢迎关闭尚未确认/);
  assert.equal(f.toastOptions.at(-1).type, 'error');
  assert.equal(f.get('ServerStatus').hidden, true);
  assert.equal(f.get('OverviewStatus').textContent, '');
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
  userWelcomeMessages: [],
  returningEnabled: false,
  returningMessages: ['最近好吗？'],
  ...patch,
});

test('returning welcome toggles and saves its own library, retaining unconfirmed drafts', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(savedV2({ enabled: true }));
  await flush();
  assert.equal(f.get('ReturningToggle').disabled, false);
  f.get('ReturningToggle').checked = true;
  f.change('ReturningToggle');
  assert.deepEqual(f.writes[0].patch, { returningEnabled: true });
  f.writes[0].resolve(savedV2({ enabled: true, returningEnabled: true }));
  await flush();
  assert.equal(f.toasts.at(-1), '久别重逢已开启');
  f.get('LibraryKind').value = 'returningMessages';
  f.change('LibraryKind');
  assert.equal(f.get('ReturningLibraryHint').hidden, false);
  f.edit(0, '欢迎回来听歌～');
  f.click('SaveBtn');
  assert.deepEqual(f.writes[1].patch, { returningMessages: ['欢迎回来听歌～'] });
  f.writes[1].resolve(savedV2({ enabled: true, returningEnabled: undefined, returningMessages: undefined }));
  await flush();
  assert.equal(f.get('List').children[0].children[1].value, '欢迎回来听歌～');
  assert.equal(f.get('SaveBtn').disabled, false);
  f.click('SaveBtn');
  f.writes[2].resolve(savedV2({ enabled: true, returningEnabled: true, returningMessages: ['欢迎回来听歌～'] }));
  await flush();
  assert.equal(f.get('SaveBtn').disabled, true);
});

test('older servers disable only returning controls and never receive unsupported fields', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(savedV2({ enabled: true, returningEnabled: undefined, returningMessages: undefined }));
  await flush();
  assert.equal(f.get('ReturningToggle').disabled, true);
  assert.equal(f.get('ReturningLibraryBtn').disabled, true);
  assert.equal(f.get('ReturningCapability').hidden, false);
  assert.equal(f.get('GreetingToggle').disabled, false);
  f.parameter('welcomeDelaySeconds', '5');
  f.click('ParameterSaveBtn');
  assert.equal(Object.hasOwn(f.writes[0].patch, 'returningEnabled'), false);
  assert.equal(Object.hasOwn(f.writes[0].patch, 'returningMessages'), false);
  f.writes[0].resolve(savedV2({ enabled: true, welcomeDelaySeconds: 5, returningEnabled: undefined, returningMessages: undefined }));
  await flush();
  assert.equal(f.get('ParameterSaveBtn').disabled, true);
});

test('pinyin saves independently of invalid parameter drafts and reports changes only through toast', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(savedV2({ enabled: true, greetingEnabled: true }));
  await flush();
  f.parameter('welcomeDelaySeconds', '20');
  f.edit(0, '草稿 {username}');
  const summary = f.get('Summary').textContent;
  const overview = f.get('OverviewStatus').textContent;
  const status = f.get('Status').textContent;
  f.get('PinyinToggle').checked = true;
  f.change('PinyinToggle');
  assert.deepEqual(f.writes[0].patch, { rareNamePinyinEnabled: true });
  assert.equal(f.get('PinyinToggle').disabled, true);
  assert.equal(f.get('Status').textContent, status);
  assert.equal(f.get('OverviewStatus').textContent, overview);
  assert.equal(f.get('Summary').textContent, summary);
  assert.equal(f.toasts.length, 0);
  f.writes[0].resolve(savedV2({ enabled: true, greetingEnabled: true, rareNamePinyinEnabled: true }));
  await flush();
  assert.equal(f.get('PinyinToggle').checked, true);
  assert.equal(f.get('PinyinToggle').title, '');
  assert.equal(f.get('welcomeDelaySeconds').value, '20');
  assert.equal(f.get('ParameterSaveBtn').disabled, false);
  assert.equal(f.get('List').children[0].children[1].value, '草稿 {username}');
  assert.equal(f.get('Summary').textContent, summary);
  assert.equal(f.get('OverviewStatus').textContent, overview);
  assert.equal(f.get('ServerStatus').hidden, true);
  assert.deepEqual(f.toasts, ['昵称生僻字自动注音已开启']);
  f.get('PinyinToggle').checked = false;
  f.change('PinyinToggle');
  f.writes[1].reject(new Error('offline'));
  await flush();
  assert.equal(f.get('PinyinToggle').checked, true);
  assert.equal(f.get('PinyinToggle').disabled, false);
  assert.equal(f.get('Summary').textContent, summary);
  assert.equal(f.get('OverviewStatus').textContent, overview);
  assert.equal(f.get('ServerStatus').hidden, true);
  assert.equal(f.toasts.length, 2);
  assert.match(f.toasts[1], /昵称生僻字自动注音关闭尚未确认/);
  assert.equal(f.toastOptions[1].type, 'error');
});

test('welcome stage switches use confirmed state in toast without changing overview feedback', async () => {
  for (const [suffix, key, title] of [
    ['Toggle', 'enabled', '进场欢迎'],
    ['GreetingToggle', 'greetingEnabled', '二次问候'],
    ['AttentionToggle', 'attentionEnabled', '重点关注'],
  ]) {
    const f = await fixture(account('one'), true);
    f.reads[0].resolve(savedV2({ enabled: key !== 'enabled' }));
    await flush();
    const summary = f.get('Summary').textContent;
    f.get(suffix).checked = true;
    f.change(suffix);
    assert.equal(f.get('OverviewStatus').textContent, '');
    f.writes[0].resolve(savedV2({ enabled: true, [key]: true }));
    await flush();
    assert.deepEqual(f.toasts, [`${title}已开启`]);
    assert.equal(f.get('OverviewStatus').textContent, '');
    assert.equal(f.get('Summary').textContent, summary);
  }
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

test('dependency hint explains the effective greeting honor threshold', async () => {
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
  assert.match(f.get('DependencyHint').textContent, /至少 20 级/);
  assert.equal(f.writes.length, 0);
});

test('user welcome rules save independently and preserve changes made during a write', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(savedV2());
  await flush();
  assert.equal(f.get('CustomAddBtn').disabled, false);
  assert.equal(f.get('CustomEmpty').hidden, false);
  f.edit(0, '普通欢迎草稿');
  f.click('CustomAddBtn');
  f.customEdit(0, 'uid', '123456');
  f.customEdit(0, 'message', ' 老朋友 {username} 来啦 ');
  f.click('CustomSaveBtn');
  assert.deepEqual(f.writes[0].patch, {
    userWelcomeMessages: [{ uid: '123456', message: '老朋友 {username} 来啦' }],
  });
  f.customEdit(0, 'message', '<img src=x onerror=bad> {username}');
  f.writes[0].resolve(savedV2(f.writes[0].patch));
  await flush();
  assert.equal(f.get('CustomList').children[0].children[1].children[1].value, '<img src=x onerror=bad> {username}');
  assert.equal(f.get('CustomSaveBtn').disabled, false);
  assert.equal(f.get('List').children[0].children[1].value, '普通欢迎草稿');
  f.click('CustomSaveBtn');
  f.writes[1].resolve(savedV2(f.writes[1].patch));
  await flush();
  assert.equal(f.get('CustomSaveBtn').disabled, true);
  assert.equal(f.get('SaveBtn').disabled, false);
  f.get('CustomList').children[0].children[2].events.click();
  f.click('CustomSaveBtn');
  assert.deepEqual(f.writes[2].patch, { userWelcomeMessages: [] });
  f.writes[2].resolve(savedV2());
  await flush();
  assert.equal(f.get('CustomList').children.length, 0);
  assert.equal(f.get('CustomSaveBtn').disabled, true);
});

test('user welcome refresh preserves drafts and an account change discards old writes', async () => {
  const f = await fixture(account('one'), true);
  const rule = { uid: '123', message: '欢迎老朋友 {username}' };
  f.reads[0].resolve(savedV2({ userWelcomeMessages: [rule] }));
  await flush();
  f.click('RefreshBtn');
  f.customEdit(0, 'message', '刷新时的用户欢迎草稿');
  f.reads[1].resolve(savedV2({ userWelcomeMessages: [{ ...rule, message: '来自服务器' }] }));
  await flush();
  assert.equal(f.get('CustomList').children[0].children[1].children[1].value, '刷新时的用户欢迎草稿');
  f.click('CustomSaveBtn');
  f.account('two');
  assert.equal(f.get('CustomList').children.length, 0);
  f.writes[0].resolve(savedV2(f.writes[0].patch));
  await flush();
  assert.equal(f.get('CustomList').children.length, 0);
  f.reads[2].resolve(savedV2());
  await flush();
  assert.equal(f.get('CustomSaveBtn').disabled, true);
  assert.equal(f.get('CustomStatus').textContent, '');
});

test('old V2 servers disable only the user welcome editor', async () => {
  const f = await fixture(account('old'), true);
  f.reads[0].resolve(savedV2({ userWelcomeMessages: undefined }));
  await flush();
  assert.equal(f.get('CustomCapability').hidden, false);
  assert.equal(f.get('CustomAddBtn').disabled, true);
  assert.equal(f.get('CustomSaveBtn').disabled, true);
  assert.equal(f.get('Toggle').disabled, false);
  assert.equal(f.get('LibraryKind').disabled, false);
  f.click('CustomAddBtn');
  f.click('CustomSaveBtn');
  assert.equal(f.get('CustomList').children.length, 0);
  assert.equal(f.writes.length, 0);
  f.edit(0, '常规词库可继续保存');
  f.click('SaveBtn');
  assert.deepEqual(f.writes[0].patch, { messages: ['常规词库可继续保存', '{username} 来啦'] });
});

test('server validation keeps user welcome drafts and shows errors in their editor', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(savedV2());
  await flush();
  f.click('CustomAddBtn');
  f.customEdit(0, 'uid', 'invalid');
  f.click('CustomSaveBtn');
  f.writes[0].resolve({
    ok: false,
    error: 'INVALID_WELCOME_MESSAGES',
    fieldErrors: [{ field: 'userWelcomeMessages', reason: 'INVALID_MESSAGES' }],
  });
  await flush();
  assert.equal(f.get('CustomList').children[0].children[0].children[1].value, 'invalid');
  assert.equal(f.get('CustomSaveBtn').disabled, false);
  assert.equal(f.get('CustomError').hidden, false);
  assert.match(f.get('CustomError').textContent, /UID.*不能重复/);
  assert.equal(f.get('Libraries').hidden, false);
  assert.equal(f.toastOptions.at(-1).type, 'error');
  f.customEdit(0, 'uid', '123');
  assert.equal(f.get('CustomError').hidden, true);
});

test('a user welcome write without echoed rules does not clear its draft', async () => {
  const f = await fixture(account('one'), true);
  f.reads[0].resolve(savedV2());
  await flush();
  f.click('CustomAddBtn');
  f.customEdit(0, 'uid', '123');
  f.customEdit(0, 'message', '欢迎老朋友');
  f.click('CustomSaveBtn');
  f.writes[0].resolve(savedV2({ userWelcomeMessages: undefined }));
  await flush();
  assert.equal(f.get('CustomList').children[0].children[1].children[1].value, '欢迎老朋友');
  assert.equal(f.get('CustomSaveBtn').disabled, false);
  assert.match(f.toasts.at(-1), /保存未确认/);
});
