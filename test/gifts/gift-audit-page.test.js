'use strict';

const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('gift audit analysis parses bubbles without browser dependencies', async () => {
  const { parseBubbleHtml } = await loadAnalysisModule();
  const gifts = parseBubbleHtml(`
    <div class="bubble-list">
      <div class="super-gift-item">
        <div class="user-name">示例用户</div>
        <span class="gift-name">粉丝团灯牌</span>
        <div class="gift-frame gift-31164-50"></div>
        <div class="numbers">
          <span class="number number-1"></span>
          <span class="number number-5"></span>
        </div>
      </div>
    </div>
  `);

  assert.deepEqual(toPlain(gifts), [
    {
      userName: '示例用户',
      giftName: '粉丝团灯牌',
      giftId: '31164',
      comboCount: 15,
    },
  ]);
});

test('gift audit analysis separates matches, misses, and server-only gifts', async () => {
  const { crossReference } = await loadAnalysisModule();
  const captureTime = Date.parse('2026-08-14T12:00:00.000Z');
  const results = crossReference(
    [
      {
        userName: '用户A',
        giftName: '粉丝团灯牌',
        giftId: '31164',
        comboCount: 2,
      },
      { userName: '用户B', giftName: '小花花', giftId: '1', comboCount: 1 },
    ],
    [
      {
        id: 'gift-1',
        user_name: '用户A',
        gift_name: '粉丝团灯牌',
        gift_id: 31164,
        num: 2,
        total_price: 0.2,
        created_at: '2026-08-14T12:00:00.000Z',
      },
      {
        id: 'gift-2',
        user_name: '用户C',
        gift_name: '辣条',
        gift_id: 2,
        num: 1,
        total_price: 0.1,
        created_at: '2026-08-14T12:00:00.000Z',
      },
    ],
    captureTime,
  );

  assert.deepEqual(
    toPlain(
      results.map(({ source, userName, status }) => ({
        source,
        userName,
        status,
      })),
    ),
    [
      { source: 'bubble', userName: '用户A', status: 'match' },
      { source: 'bubble', userName: '用户B', status: 'miss' },
      { source: 'server', userName: '用户C', status: 'extra' },
    ],
  );
});

test('gift bubble deduplication keeps the first exact tuple and leaves fallback entries intact', async () => {
  const { parseBubbleHtml } = await loadAnalysisModule();
  const item = (userName, giftName, giftId, count) => `<div class="gift-item">
    <div class="user-name">${userName}</div><span class="gift-name">${giftName}</span>
    <div class="gift-${giftId}-50"></div><div class="numbers"><span class="number-${count}"></span></div>
  </div>`;
  const html = `<div>${item('a|b', 'c', 1, 1)}${item('a|b', 'c', 2, 1)}
    ${item('a', 'b|c', 3, 1)}${item('a|b', 'c', 4, 2)}</div>`;
  assert.deepEqual(toPlain(parseBubbleHtml(html).map(({ giftId }) => giftId)), ['1', '3', '4']);
  const fallback = '<div class="user-name">A</div><span class="gift-name">花</span>';
  assert.equal(parseBubbleHtml(fallback + fallback).length, 2);
});

test('gift matching preserves fuzzy Unicode scores, greedy tie order and unmatched records', async () => {
  const { crossReference } = await loadAnalysisModule();
  const bubble = { userName: ' 😀😁 A ', giftName: '花', giftId: '', comboCount: 10 };
  const server = { user_name: '😀😆a', gift_name: '花', num: 1 };
  const results = crossReference(
    [bubble, bubble, bubble, { ...bubble, userName: 'ab' }],
    [{ ...server, id: 'first' }, { ...server, id: 'second' }, { ...server, id: 'unmatched', user_name: 'ac' }],
    0,
  );
  assert.deepEqual(toPlain(results.map(({ status }) => status)), ['match', 'match', 'miss', 'miss', 'extra']);
  assert.deepEqual(toPlain(results.slice(0, 2).map(({ serverId }) => serverId)), ['first', 'second']);
  assert.equal(results[4].userName, 'ac');
});

test('clearing gift audit discards pending comparison success and failure', async (t) => {
  for (const ok of [true, false]) await t.test(ok ? 'successful fetch' : 'failed fetch', async () => {
    const page = await loadAuditPage();
    page.get('bubbleHtml').value = giftBubbleHtml('Synthetic User');
    const pending = page.get('parseAndCompareBtn').listeners.get('click')();
    page.get('clearAllBtn').listeners.get('click')();
    page.stateRequest.resolve({ json: async () => ({ ok, data: { gifts: { recent: [{
      id: 'synthetic-gift', user_name: 'Synthetic User', gift_name: 'Synthetic Gift', gift_id: 1, num: 1,
    }] } } }) });
    await pending;
    assert.equal(page.comparisons.length, 0, 'cleared input must not produce a late comparison');
    assert.equal(page.toasts.length, 0, 'a cancelled comparison must not report success or failure');
    assert.equal(page.get('comparisonSection').style.display, 'none');
  });
});

test('gift audit compares the submitted bubble and capture time while records load', async () => {
  const page = await loadAuditPage();
  page.get('bubbleHtml').value = giftBubbleHtml('Synthetic User');
  page.get('captureTime').value = '2026-11-12T12:00';
  const pending = page.get('parseAndCompareBtn').listeners.get('click')();
  page.get('bubbleHtml').value = giftBubbleHtml('Replacement User');
  page.get('captureTime').value = '2026-11-12T13:00';
  const gift = { user_name: 'Synthetic User', gift_name: 'Synthetic Gift', gift_id: 1, num: 1 };
  page.stateRequest.resolve({ json: async () => ({ ok: true, data: { gifts: { recent: [
    { ...gift, id: 'at-submitted-time', created_at: '2026-11-12T12:00:00' },
    { ...gift, id: 'at-edited-time', created_at: '2026-11-12T13:00:00' },
  ] } } }) });
  await pending;
  const match = page.comparisons.at(-1).find(result => result.source === 'bubble');
  assert.equal(match.userName, 'Synthetic User');
  assert.equal(match.serverId, 'at-submitted-time');
});

function giftBubbleHtml(userName) {
  return `<div class="gift-item"><div class="user-name">${userName}</div>
    <span class="gift-name">Synthetic Gift</span><div class="gift-1-50"></div></div>`;
}

async function loadAuditPage() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', style: {}, listeners: new Map(),
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      scrollIntoView() {},
    });
    return elements.get(id);
  };
  const comparisons = [];
  const toasts = [];
  const stateRequest = Promise.withResolvers();
  let firstFetch = true;
  const context = vm.createContext({
    document: { getElementById: get },
    window: { addEventListener() {} },
    location: { protocol: 'http:', host: 'synthetic.invalid' },
    WebSocket: class { static OPEN = 1; close() {} },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    fetch() {
      if (!firstFetch) return stateRequest.promise;
      firstFetch = false;
      return Promise.resolve({ json: async () => ({ ok: true, data: {} }) });
    },
  });
  const view = {
    renderBubbleTable() {}, renderConnBar() {}, renderServerTable() {}, updateStats() {},
    renderComparison(results) { comparisons.push(results); },
    showToast(message, type) { toasts.push({ message, type }); },
  };
  const modules = new Map([
    ['./view.js', new vm.SyntheticModule(Object.keys(view), function () {
      for (const [name, value] of Object.entries(view)) this.setExport(name, value);
    }, { context })],
    ['./analysis.js', new vm.SourceTextModule(
      fs.readFileSync(path.join(ROOT_DIR, 'public/js/gift-audit/analysis.js'), 'utf8'), { context },
    )],
  ]);
  const entry = new vm.SourceTextModule(
    fs.readFileSync(path.join(ROOT_DIR, 'public/js/gift-audit/index.js'), 'utf8'), { context },
  );
  await entry.link(specifier => {
    if (!modules.has(specifier)) throw new Error(`Unexpected audit import: ${specifier}`);
    return modules.get(specifier);
  });
  await entry.evaluate();
  return { get, comparisons, toasts, stateRequest };
}

function loadAnalysisModule() {
  return loadModuleExports(path.join(ROOT_DIR, 'public/js/gift-audit/analysis.js'));
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}
