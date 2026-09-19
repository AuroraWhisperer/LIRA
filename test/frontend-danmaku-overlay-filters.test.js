const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const saved = (patch = {}) => ({ ok: true, blockedUsers: [], blockedKeywords: [], ...patch });

async function fixture() {
  const nodes = new Map(), reads = [], writes = [], viewerReads = [];
  const makeNode = () => ({ value: '', textContent: '', disabled: false, hidden: false, children: [], events: {},
    addEventListener(type, fn) { this.events[type] = fn; }, setAttribute(name, value) { this[name] = value; },
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    focus() {}, querySelectorAll() { return []; },
  });
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, makeNode());
    return nodes.get(id);
  };
  let observe;
  const context = vm.createContext({ document: { getElementById: node, createElement: makeNode },
    window: { liraLicense: {
      getOverlayFilters: () => new Promise((resolve) => reads.push(resolve)),
      updateOverlayFilters: (patch) => new Promise((resolve) => writes.push({ patch: JSON.parse(JSON.stringify(patch)), resolve })),
      getOverlayViewers: () => new Promise((resolve) => viewerReads.push(resolve)),
    } },
  });
  const source = fs.readFileSync(path.join(__dirname, '../public/js/admin/danmaku-overlay-filters.js'), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => new vm.SyntheticModule(['observeServerOverlayUrl'], function () {
    this.setExport('observeServerOverlayUrl', (fn) => { observe = fn; fn('account-one'); });
  }, { context }));
  await module.evaluate();
  module.namespace.initDanmakuOverlayFilters();
  const get = (id) => node(`danmaku${id}`);
  return { get, reads, writes, viewerReads, account: (url) => observe(url),
    click: (id) => get(id).events.click(),
    submit: (form, input, value) => { get(input).value = value; get(form).events.submit({ preventDefault() {} }); },
  };
}

test('blacklist and keyword changes show only confirmed saves; clear does not remove users', async () => {
  const f = await fixture();
  f.reads[0](saved()); await flush();
  f.submit('BlacklistForm', 'BlacklistUid', '123');
  assert.deepEqual(f.writes[0].patch, { blockedUsers: [{ uid: '123', name: '' }] });
  assert.equal(f.get('Blacklist').children.length, 0);
  f.writes[0].resolve(saved(f.writes[0].patch)); await flush();
  assert.equal(f.get('Blacklist').children.length, 1);
  assert.equal(f.get('BlacklistUid').value, '');
  f.submit('KeywordForm', 'KeywordInput', '广告');
  f.writes[1].resolve({ ok: false, error: 'NETWORK_UNAVAILABLE' }); await flush();
  assert.equal(f.get('KeywordInput').value, '广告');
  assert.match(f.get('FiltersState').textContent, /保存失败/);
  f.submit('KeywordForm', 'KeywordInput', '广告');
  f.writes[2].resolve(saved({ ...f.writes[0].patch, blockedKeywords: ['广告'] })); await flush();
  const clear = f.click('ClearKeywords');
  assert.deepEqual(f.writes[3].patch, { blockedKeywords: [] });
  f.writes[3].resolve(saved(f.writes[0].patch)); await clear;
  assert.equal(f.get('Keywords').children.length, 0);
  assert.equal(f.get('Blacklist').children.length, 1);
  const remove = f.get('Blacklist').children[0].children[1].events.click();
  assert.deepEqual(f.writes[4].patch, { blockedUsers: [] });
  f.writes[4].resolve(saved()); await remove;
  assert.equal(f.get('BlacklistEmpty').hidden, false);
});

test('viewer picker searches literal names/UIDs, selects users and renders untrusted text safely', async () => {
  const f = await fixture(); f.reads[0](saved()); await flush();
  const pending = f.click('ReadViewers');
  const viewers = [{ uid: '123', name: '<img src=x onerror=bad()>' }, { uid: '456', name: '星河' }];
  f.viewerReads[0]({ ok: true, roomId: '99', viewers }); await pending;
  f.get('ViewerSearch').value = '456'; f.get('ViewerSearch').events.input();
  assert.equal(f.get('ViewerList').children.length, 1);
  const checkbox = f.get('ViewerList').children[0].children[0].children[0];
  checkbox.checked = true; checkbox.events.change();
  const adding = f.click('AddViewers');
  assert.deepEqual(f.writes[0].patch, { blockedUsers: [viewers[1]] });
  f.writes[0].resolve(saved(f.writes[0].patch)); await adding;
  assert.equal(f.get('AddViewers').disabled, true);
  assert.equal(f.get('ViewerList').children[0].children[0].children[0].disabled, true);
  f.get('ViewerSearch').value = ''; f.get('ViewerSearch').events.input();
  assert.match(f.get('ViewerList').children[0].children[0].children[1].textContent, /<img src=x/);
});

test('account changes discard pending saves/viewers and unsupported server reads stay disabled', async () => {
  const f = await fixture(); f.reads[0](saved()); await flush();
  f.submit('KeywordForm', 'KeywordInput', '旧账号');
  f.account('account-two');
  f.writes[0].resolve(saved({ blockedKeywords: ['旧账号'] }));
  f.reads[1](saved()); await flush();
  assert.equal(f.get('Keywords').children.length, 0);
  assert.equal(f.get('KeywordInput').value, '');
  const pending = f.click('ReadViewers');
  f.account('account-three');
  f.viewerReads[0]({ ok: true, roomId: '99', viewers: [{ uid: '1', name: '旧观众' }] }); await pending;
  assert.equal(f.get('ViewerList').children.length, 0);
  assert.equal(f.get('ViewerPicker').hidden, true);
  f.reads[2]({ ok: false, error: 'OVERLAY_FILTERS_UNSUPPORTED' }); await flush();
  assert.match(f.get('FiltersState').textContent, /更新服务器/);
  assert.equal(f.get('ReadViewers').disabled, true);
});

test('link appears above style options, and filters occupy the former link position', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/pages/admin/toolbox/danmaku.html'), 'utf8');
  assert.ok(html.indexOf('id="danmakuOverlayUrl"') < html.indexOf('class="danmaku-style-picker"'));
  assert.ok(html.indexOf('id="danmakuOverlayFilters"') > html.indexOf('id="danmakuApplyOverlayBtn"'));
});
