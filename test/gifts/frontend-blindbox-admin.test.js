'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

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

test('open blind box analysis debounces gift events into one quiet reload and stops after closing', async () => {
  const elements = new Map();
  const element = (id = '') => {
    if (id && elements.has(id)) return elements.get(id);
    const node = {
      id, hidden: true, dataset: {}, textContent: '', innerHTML: '', disabled: false,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, setAttribute() {}, getAttribute: () => null, focus() {},
      querySelector: () => element(), querySelectorAll: () => [],
    };
    if (id) elements.set(id, node);
    return node;
  };
  const timers = [];
  const requests = [];
  const window = {};
  const { giftAnalysis } = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox-analysis.js'), {
    window,
    HTMLElement: class {},
    AbortController,
    URLSearchParams,
    document: {
      readyState: 'complete', activeElement: null, body: element(),
      addEventListener() {}, getElementById: (id) => element(id),
      querySelector: () => null, querySelectorAll: () => [],
    },
    setTimeout: (callback, delay) => timers.push({ callback, delay, cleared: false }) - 1,
    clearTimeout: (index) => {
      if (timers[index]) timers[index].cleared = true;
    },
    fetch: (url, { signal }) => {
      requests.push({ url, signal });
      return new Promise(() => {});
    },
  });
  const { eventBus } = window.AdminApp;
  const pendingTimers = () => timers.filter((timer) => !timer.cleared);

  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  assert.equal(pendingTimers().length, 0, 'a closed workspace ignores gift events');
  giftAnalysis.open();
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^\/api\/gifts\/blind-box-analysis\?view=users&page=1/);
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  assert.equal(pendingTimers().length, 1, 'gift bursts share one delayed reload');
  pendingTimers()[0].callback();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true, 'the newer reload aborts the older request');
  giftAnalysis.close();
  assert.equal(requests[1].signal.aborted, true);
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  assert.equal(pendingTimers().length, 0);
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
