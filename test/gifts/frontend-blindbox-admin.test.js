'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createClock } = require('../helpers/toast-dom');

const ROOT_DIR = path.join(__dirname, '../..');

test('blind box calendar fits each month while keeping its weekday positions', async () => {
  const elements = new Map();
  function element() {
    const classes = new Set();
    const listeners = new Map();
    return {
      dataset: {}, children: [],
      classList: {
        toggle(name, active) {
          if (active) classes.add(name);
          else classes.delete(name);
        },
        contains: (name) => classes.has(name),
      },
      setAttribute() {}, focus() {},
      addEventListener: (name, listener) => listeners.set(name, listener),
      click: () => listeners.get('click')?.(),
      querySelector: () => null, querySelectorAll: () => [],
      append(child) { this.children.push(child); },
      replaceChildren(fragment) { this.children = fragment.children; },
    };
  }
  function getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  }
  const days = getElementById('blindBoxAnalysisDateDays');
  days.querySelectorAll = () => days.children;
  const { createBlindBoxDatePicker } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox-analysis-dates.js'),
    {
      document: {
        getElementById, addEventListener() {},
        createElement: element, createDocumentFragment: element,
      },
    },
  );
  const picker = createBlindBoxDatePicker({ onChange() {} });
  for (const [month, dayCount, weekdayOffset] of [
    ['2021-02', 28, 0],
    ['2024-02', 29, 3],
  ]) {
    const firstDate = `${month}-01`;
    picker.setSelection({ startDate: firstDate, endDate: firstDate });
    getElementById('blindBoxAnalysisDateTrigger').click();
    const monthDays = days.children.filter((button) => !button.classList.contains('is-outside'));
    assert.equal(monthDays.length, dayCount, month);
    assert.equal(days.children.indexOf(monthDays[0]), weekdayOffset, `${month} keeps weekday alignment`);
    assert.equal(monthDays.at(-1).dataset.date, `${month}-${dayCount}`, month);
  }
});

async function createAnalysisHarness({ autoResolve = false, filters = {} } = {}) {
  const elements = new Map();
  const optionCounts = { created: 0 };
  const element = (id = '') => {
    if (id && elements.has(id)) return elements.get(id);
    const listeners = new Map();
    const node = {
      id, hidden: true, dataset: {}, textContent: '', innerHTML: '', disabled: false,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener: (name, listener) => listeners.set(name, listener),
      emit: (name, event) => listeners.get(name)?.(event),
      setAttribute() {}, getAttribute: () => null, focus() {}, children: [],
      replaceChildren(...children) { this.children = children; },
      querySelector: () => element(), querySelectorAll: () => [],
    };
    if (id) elements.set(id, node);
    return node;
  };
  const clock = createClock();
  const requests = [];
  const window = {};
  const [{ giftAnalysis }, { eventBus }] = await loadModuleExports([
    path.join(ROOT_DIR, 'public/js/admin/gifts/blindbox-analysis.js'),
    path.join(ROOT_DIR, 'public/js/shared/event-bus.js'),
  ], {
    window,
    HTMLElement: class {},
    Option: class {
      constructor(label, value) { this.textContent = label; this.value = value; optionCounts.created += 1; }
    },
    AbortController,
    URLSearchParams,
    document: {
      readyState: 'complete', activeElement: null, body: element(),
      addEventListener() {}, getElementById: (id) => element(id),
      querySelector: () => null, querySelectorAll: () => [],
    },
    ...clock,
    fetch: (url, { signal }) => {
      const request = Promise.withResolvers();
      requests.push({ url, signal, ...request });
      if (autoResolve) request.resolve(result(1));
      return request.promise;
    },
  });
  function result(count, selectedFilters = filters) {
    return { ok: true, text: async () => JSON.stringify({ ok: true, data: {
      filters: selectedFilters, summary: { boxCount: count }, items: [], pagination: {},
    } }) };
  }
  return { giftAnalysis, eventBus, clock, requests, element, optionCounts,
    async finish(index, count = 1, selectedFilters) {
      requests[index].resolve(result(count, selectedFilters));
      await new Promise(setImmediate);
    } };
}

test('open blind box analysis refreshes throughout continuous gift traffic and stops after closing', async () => {
  const filters = { viewers: Array.from({ length: 1000 }, (_, i) => ({ value: `uid:${i}`, label: `Viewer ${i}` })) };
  const { giftAnalysis, eventBus, clock, requests, optionCounts } = await createAnalysisHarness({ autoResolve: true, filters });

  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  clock.tick(1000);
  assert.equal(requests.length, 0, 'a closed workspace ignores gift events');
  giftAnalysis.open();
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  const initialOptions = optionCounts.created;
  assert.match(requests[0].url, /^\/api\/gifts\/blind-box-analysis\?view=users&page=1/);
  for (let i = 0; i < 240; i++) {
    eventBus.emit('gift:received', { reason: 'bilibili:gift' });
    clock.tick(250);
    await new Promise(setImmediate);
  }
  assert.equal(requests.length, 121, 'continuous gifts share bounded refreshes without postponing them forever');
  assert.equal(optionCounts.created, initialOptions, 'unchanged refreshes retain the filter options');
  giftAnalysis.close();
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  clock.tick(1000);
  assert.equal(requests.length, 121);
});

test('blind box filter selections update without replacing unchanged options and changed labels rebuild', async () => {
  const { giftAnalysis, eventBus, clock, element, finish } = await createAnalysisHarness();
  const viewers = [{ value: 'uid:a', label: 'A' }, { value: 'uid:b', label: 'B' }];
  giftAnalysis.open();
  await finish(0, 1, { viewers, selectedViewer: 'uid:a', boxes: ['Box A'] });
  const viewerSelect = element('blindBoxAnalysisViewer');
  const original = viewerSelect.children;
  viewerSelect.emit('change', { target: { value: 'uid:b' } });
  await finish(1, 2, { viewers, selectedViewer: 'uid:b', boxes: ['Box A'] });
  assert.equal(viewerSelect.children, original);
  assert.equal(viewerSelect.value, 'uid:b');
  eventBus.emit('gift:received');
  clock.tick(500);
  await finish(2, 3, { viewers: [{ value: 'uid:b', label: 'Renamed B' }], selectedViewer: 'uid:b', boxes: [] });
  assert.equal(viewerSelect.children.length, 2);
  assert.equal(viewerSelect.children[1].textContent, 'Renamed B');
  assert.equal(viewerSelect.value, 'uid:b');
  assert.equal(element('blindBoxAnalysisBox').children.length, 1);
  giftAnalysis.close();
});

test('gift refreshes finish slow analysis reads while newer filters and closing reject stale results', async () => {
  const { giftAnalysis, eventBus, clock, requests, element, finish } = await createAnalysisHarness();
  giftAnalysis.open();
  for (let i = 0; i < 4; i++) {
    eventBus.emit('gift:received', { reason: 'bilibili:gift' });
    clock.tick(250);
  }
  assert.equal(requests.length, 1, 'gift refreshes cannot continuously abort a slow read');
  assert.equal(requests[0].signal.aborted, false);
  await finish(0);
  clock.tick(500);
  assert.equal(requests.length, 2);
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  clock.tick(1000);
  assert.equal(requests.length, 2);
  element('blindBoxAnalysisViewer').emit('change', { target: { value: 'uid:new' } });
  assert.equal(requests.length, 3);
  assert.equal(requests[1].signal.aborted, true);
  assert.match(requests[2].url, /viewer=uid%3Anew/);
  await finish(2, 9);
  await finish(1, 2);
  assert.equal(element('blindBoxAnalysisCount').textContent, '9');
  clock.tick(1000);
  assert.equal(requests.length, 3, 'the newer filtered read consumes earlier invalidation');
  giftAnalysis.open();
  giftAnalysis.close();
  assert.equal(requests[3].signal.aborted, true);
  await finish(3, 20);
  assert.equal(element('blindBoxAnalysisCount').textContent, '9');
});

test('source changes reset blind box analysis filters and reject old reads while reconnect consumes queued refreshes', async () => {
  const { giftAnalysis, eventBus, clock, requests, element, finish } = await createAnalysisHarness();
  const oldFilters = { selectedViewer: 'uid:old', viewers: [{ value: 'uid:old', label: 'Old viewer' }],
    selectedBox: 'Old box', boxes: ['Old box'] };
  giftAnalysis.open({ viewer: 'uid:old', box: 'Old box' });
  await finish(0, 5, oldFilters);
  element('blindBoxAnalysisNext').emit('click');
  eventBus.emit('gift:received', { reason: 'gift:source' });
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(requests.length, 3);
  const sourceQuery = new URL(requests[2].url, 'http://localhost').searchParams;
  assert.equal(sourceQuery.get('page'), '1');
  assert.equal(sourceQuery.has('viewer'), false);
  assert.equal(sourceQuery.has('box'), false);
  assert.equal(element('blindBoxAnalysisViewer').children.length, 1);
  assert.equal(element('blindBoxAnalysisBox').children.length, 1);
  assert.equal(element('blindBoxAnalysisCount').textContent, '0');
  await finish(2, 10);
  await finish(1, 99, oldFilters);
  assert.equal(element('blindBoxAnalysisCount').textContent, '10');
  assert.equal(element('blindBoxAnalysisViewer').value, '');
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  eventBus.emit('gift:received', { reason: 'connect' });
  assert.equal(requests.length, 4);
  clock.tick(1000);
  assert.equal(requests.length, 4, 'reconnect consumes the queued ordinary gift refresh');
  await finish(3, 8);
  assert.equal(element('blindBoxAnalysisCount').textContent, '8');
  giftAnalysis.close();
  eventBus.emit('gift:received', { reason: 'gift:source' });
  assert.equal(requests.length, 4, 'closed workspaces clear old data without reading');
  assert.equal(element('blindBoxAnalysisCount').textContent, '0');
});

test('blindbox controls keep a stable IPv4 source URL that follows saved settings', async () => {
  const elements = {
    blindboxOverlayTop: { value: '' },
    blindboxOverlayTitle: { value: '  盲盒 & 观众  ' },
    blindboxWinnersOnly: { checked: true },
    blindboxHeartBoxOnly: { checked: true },
    blindboxOverlayUrl: {},
  };
  const { localOverlayOrigin } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/shared/utils.js'));
  const { createBlindboxSettings } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/settings-blindbox.js'));
  const settings = createBlindboxSettings({
    documentRef: { getElementById: (id) => elements[id] },
    locationRef: { protocol: 'http:', hostname: 'localhost', port: '3012' },
    localOverlayOrigin,
    value: (id) => elements[id].value,
  });
  elements.blindboxOverlayTop.value = '4';
  settings.updateOverlayUrl();
  assert.equal(elements.blindboxOverlayUrl.textContent, 'http://127.0.0.1:3012/blindbox');
  elements.blindboxOverlayTop.value = '';
  elements.blindboxOverlayTitle.value = '';
  elements.blindboxWinnersOnly.checked = false;
  elements.blindboxHeartBoxOnly.checked = false;
  assert.equal(settings.buildOverlayUrl(), 'http://127.0.0.1:3012/blindbox');
});
