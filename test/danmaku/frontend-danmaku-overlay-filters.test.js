const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const saved = (patch = {}) => ({ ok: true, blockedUsers: [], blockedKeywords: [], ...patch });

async function fixture() {
  const nodes = new Map(),
    reads = [],
    writes = [],
    viewerReads = [];
  const makeNode = () => ({
    value: '',
    textContent: '',
    disabled: false,
    hidden: false,
    children: [],
    events: {},
    addEventListener(type, fn) {
      this.events[type] = fn;
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
    focus() {},
    querySelectorAll() {
      return [];
    },
  });
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, makeNode());
    return nodes.get(id);
  };
  let observe;
  const confirmations = [];
  const context = vm.createContext({
    document: { getElementById: node, createElement: makeNode },
    window: {
      liraLicense: {
        getOverlayFilters: () => new Promise((resolve) => reads.push(resolve)),
        updateOverlayFilters: (patch) =>
          new Promise((resolve) => writes.push({ patch: JSON.parse(JSON.stringify(patch)), resolve })),
        getOverlayViewers: () => new Promise((resolve) => viewerReads.push(resolve)),
      },
    },
  });
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/admin/danmaku-overlay-filters.js'), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  await module.link(
    (specifier) => specifier.includes('confirmation-dialog')
      ? new vm.SyntheticModule(['showConfirmationDialog'], function () {
        this.setExport('showConfirmationDialog', options => new Promise(resolve => confirmations.push({ options, resolve })));
      }, { context }) :
      new vm.SyntheticModule(
        ['observeServerOverlayUrl'],
        function () {
          this.setExport('observeServerOverlayUrl', (fn) => {
            observe = fn;
            fn('account-one');
          });
        },
        { context },
      ),
  );
  await module.evaluate();
  module.namespace.initDanmakuOverlayFilters();
  const get = (id) => node(`danmaku${id}`);
  return {
    get,
    reads,
    writes,
    viewerReads,
    confirmations,
    account: (url) => observe(url),
    click: (id) => get(id).events.click(),
    submit: (form, input, value) => {
      get(input).value = value;
      get(form).events.submit({ preventDefault() {} });
    },
  };
}

test('blacklist and keyword changes show only confirmed saves; clear does not remove users', async () => {
  const f = await fixture();
  f.reads[0](saved());
  await flush();
  f.submit('BlacklistForm', 'BlacklistUid', '123');
  assert.deepEqual(f.writes[0].patch, { blockedUsers: [{ uid: '123', name: '' }] });
  assert.equal(f.get('Blacklist').children.length, 0);
  f.writes[0].resolve(saved(f.writes[0].patch));
  await flush();
  assert.equal(f.get('Blacklist').children.length, 1);
  assert.equal(f.get('BlacklistUid').value, '');
  f.submit('KeywordForm', 'KeywordInput', '广告');
  f.writes[1].resolve({ ok: false, error: 'NETWORK_UNAVAILABLE' });
  await flush();
  assert.equal(f.get('KeywordInput').value, '广告');
  assert.match(f.get('FiltersState').textContent, /保存失败/);
  f.submit('KeywordForm', 'KeywordInput', '广告');
  f.writes[2].resolve(saved({ ...f.writes[0].patch, blockedKeywords: ['广告'] }));
  await flush();
  const clear = f.click('ClearKeywords');
  assert.match(f.confirmations[0].options.description, /全部 1 个屏蔽词/);
  f.confirmations[0].resolve(true);
  await flush();
  assert.deepEqual(f.writes[3].patch, { blockedKeywords: [] });
  f.writes[3].resolve(saved(f.writes[0].patch));
  await clear;
  assert.equal(f.get('Keywords').children.length, 0);
  assert.equal(f.get('Blacklist').children.length, 1);
  const remove = f.get('Blacklist').children[0].children[1].events.click();
  assert.deepEqual(f.writes[4].patch, { blockedUsers: [] });
  f.writes[4].resolve(saved());
  await remove;
  assert.equal(f.get('BlacklistEmpty').hidden, false);
});

test('clearing keywords can be cancelled and an account switch invalidates an open confirmation', async () => {
  const f = await fixture();
  f.reads[0](saved({ blockedKeywords: ['广告'] }));
  await flush();
  const cancelled = f.click('ClearKeywords');
  f.confirmations[0].resolve(false);
  await cancelled;
  assert.equal(f.writes.length, 0);
  assert.equal(f.get('Keywords').children.length, 1);
  const changedOwner = f.click('ClearKeywords');
  f.account('account-two');
  f.confirmations[1].resolve(true);
  await changedOwner;
  assert.equal(f.writes.length, 0);
});

test('viewer picker searches literal names/UIDs, selects users and renders untrusted text safely', async () => {
  const f = await fixture();
  f.reads[0](saved());
  await flush();
  const pending = f.click('ReadViewers');
  const viewers = [
    { uid: '123', name: '<img src=x onerror=bad()>' },
    { uid: '456', name: '星河' },
  ];
  f.viewerReads[0]({ ok: true, roomId: '99', viewers });
  await pending;
  f.get('ViewerSearch').value = '456';
  f.get('ViewerSearch').events.input();
  assert.equal(f.get('ViewerList').children.length, 1);
  const checkbox = f.get('ViewerList').children[0].children[0].children[0];
  checkbox.checked = true;
  checkbox.events.change();
  const adding = f.click('AddViewers');
  assert.deepEqual(f.writes[0].patch, { blockedUsers: [viewers[1]] });
  f.writes[0].resolve(saved(f.writes[0].patch));
  await adding;
  assert.equal(f.get('AddViewers').disabled, true);
  assert.equal(f.get('ViewerList').children[0].children[0].children[0].disabled, true);
  f.get('ViewerSearch').value = '';
  f.get('ViewerSearch').events.input();
  assert.match(f.get('ViewerList').children[0].children[0].children[1].textContent, /<img src=x/);
});

test('account changes discard pending saves/viewers and unsupported server reads stay disabled', async () => {
  const f = await fixture();
  f.reads[0](saved());
  await flush();
  f.submit('KeywordForm', 'KeywordInput', '旧账号');
  f.account('account-two');
  f.writes[0].resolve(saved({ blockedKeywords: ['旧账号'] }));
  f.reads[1](saved());
  await flush();
  assert.equal(f.get('Keywords').children.length, 0);
  assert.equal(f.get('KeywordInput').value, '');
  const pending = f.click('ReadViewers');
  f.account('account-three');
  f.viewerReads[0]({ ok: true, roomId: '99', viewers: [{ uid: '1', name: '旧观众' }] });
  await pending;
  assert.equal(f.get('ViewerList').children.length, 0);
  assert.equal(f.get('ViewerPicker').hidden, true);
  f.reads[2]({ ok: false, error: 'OVERLAY_FILTERS_UNSUPPORTED' });
  await flush();
  assert.match(f.get('FiltersState').textContent, /暂不支持弹幕屏蔽.*联系管理员/);
  assert.equal(f.get('ReadViewers').disabled, true);
});

test('toolbar precedes styles, followed by parameters and then filters', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/pages/admin/live-components/danmaku.html'), 'utf8');
  assert.ok(html.indexOf('id="danmakuPreviewOverlayBtn"') < html.indexOf('class="danmaku-style-picker"'));
  assert.ok(html.indexOf('id="danmakuParametersTitle"') > html.indexOf('data-danmaku-style="comet"'));
  assert.ok(html.indexOf('id="danmakuOverlayFilters"') > html.indexOf('id="danmakuAppearanceEffects"'));
  assert.ok(html.indexOf('id="danmakuApplyOverlayBtn"') > html.indexOf('id="danmakuGiftImage"'));
});
