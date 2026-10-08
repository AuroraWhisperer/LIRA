'use strict';

const { readAdminFragmentHtml, readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('blind box analysis mounts once beside its entry in the composed admin page', () => {
  const html = readAdminHtml();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
  for (const id of ['blindBoxAnalysisOpenBtn', 'blindBoxAnalysisWorkspace']) {
    assert.equal(ids.filter((value) => value === id).length, 1, id);
  }
});

test('blind box analysis is a separate accessible workspace module', () => {
  const html = readAdminFragmentHtml('pages/admin/gifts/blindbox-analysis.html');
  const entry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'), 'utf8');
  const stylesEntry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'), 'utf8');

  assert.match(entry, /import \{ giftAnalysis \} from '\.\/blindbox-analysis\.js';/);
  assert.match(stylesEntry, /admin\/blindbox-analysis\.css/);
  assert.match(html, /id="blindBoxAnalysisWorkspace"[^>]*role="region"[^>]*aria-labelledby="blindBoxAnalysisTitle"/);
  assert.doesNotMatch(html, /id="blindBoxAnalysisWorkspace"[^>]*aria-modal/);
  assert.match(html, /id="blindBoxAnalysisClose"[^>]*aria-label="关闭盲盒分析"/);
  assert.match(html, /id="blindBoxAnalysisViewer"/);
  assert.match(html, /id="blindBoxAnalysisBox"/);
  assert.match(html, /id="blindBoxAnalysisViewer"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="blindBoxAnalysisViewerMenu"[^>]*role="listbox"/);
  assert.match(html, /id="blindBoxAnalysisBoxMenu"[^>]*role="listbox"/);
  assert.match(html, /data-blind-analysis-view="users"/);
  assert.match(html, /data-blind-analysis-view="boxes"/);
  assert.match(html, /data-blind-analysis-view="records"/);
  assert.match(html, /id="blindBoxAnalysisBody"/);
  assert.match(html, /id="blindBoxAnalysisPrev"/);
  assert.match(html, /id="blindBoxAnalysisNext"/);
});

test('admin state forwards only gift snapshot reasons as gift events', () => {
  const stateSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'state.js'), 'utf8');

  assert.match(stateSource, /isGiftSnapshotReason\(payload\.reason\)/);
  assert.match(stateSource, /eventBus\.emit\(Events\.GIFT_RECEIVED/);
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
  const html = readAdminFragmentHtml('pages/admin/gifts/page.html');
  for (const id of ['blindboxWinnersOnly', 'blindboxHeartBoxOnly', 'blindboxOverlayTop', 'blindboxLiveLink']) {
    assert.equal([...html.matchAll(/\bid="([^"]+)"/g)].filter(([, value]) => value === id).length, 1, id);
  }
  const input = html.match(/<input\b(?=[^>]*\bid="blindboxOverlayTop")[^>]*>/)?.[0];
  assert.ok(input);
  for (const attribute of ['min="-1"', 'max="10"', 'value="3"']) assert.ok(input.includes(attribute), attribute);
  assert.match(html, /id="blindboxWinnersOnly"[^>]*checked/);

  const elements = {
    blindboxOverlayTop: { value: '' },
    blindboxOverlayTitle: { value: '  盲盒 & 观众  ' },
    blindboxWinnersOnly: { checked: true },
    blindboxHeartBoxOnly: { checked: true },
    blindboxOverlayUrl: {},
    blindboxLiveLink: {},
  };
  const { localOverlayOrigin } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/shared/utils.js'));
  const { createBlindboxSettings } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/settings-blindbox.js'));
  const settings = createBlindboxSettings({
    documentRef: { getElementById: (id) => elements[id] },
    locationRef: { protocol: 'http:', hostname: 'localhost', port: '3012' },
    localOverlayOrigin,
    value: (id) => elements[id].value,
  });
  for (const top of ['', '-1', '0', '4', '10']) {
    elements.blindboxOverlayTop.value = top;
    settings.updateOverlayUrl();
    const url = new URL(elements.blindboxLiveLink.href);
    assert.equal(url.origin, 'http://127.0.0.1:3012');
    assert.equal(url.pathname, '/blindbox');
    assert.deepEqual(Object.fromEntries(url.searchParams), {});
    assert.equal(elements.blindboxOverlayUrl.textContent, url.href);
  }
  elements.blindboxOverlayTop.value = '';
  elements.blindboxOverlayTitle.value = '';
  elements.blindboxWinnersOnly.checked = false;
  elements.blindboxHeartBoxOnly.checked = false;
  assert.equal(settings.buildOverlayUrl(), 'http://127.0.0.1:3012/blindbox');
});
