'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom } = require('../helpers/toast-dom');

async function fixture(fetch) {
  const { documentRef } = createDom();
  const elements = new Map();
  documentRef.getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, documentRef.createElement('div'));
    return elements.get(id);
  };
  const { metrics } = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/metrics.js'), {
    document: documentRef, window: {}, fetch,
  });
  return { metrics, elements };
}

const primary = { name: '显示器 1', primary: true, width: 2560, height: 1440, scalePercent: 150, refreshRate: 240 };
const secondary = { name: '显示器 2', primary: false, width: 1080, height: 1920, scalePercent: null, refreshRate: null };

test('display rows show physical pixels, per-screen settings and only the primary badge', async () => {
  const { metrics, elements } = await fixture();
  metrics.renderHardwareSummary({ displays: [primary, secondary] }, false);
  const list = elements.get('hardwareDisplayList');
  assert.equal(list.hidden, false);
  assert.equal(elements.get('hardwareDisplayStatus').hidden, true);
  assert.equal(list.children.length, 2);
  assert.match(list.children[0].textContent, /显示器 1主屏分辨率2560 × 1440系统缩放150%刷新率240 Hz/);
  assert.match(list.children[1].textContent, /显示器 2分辨率1080 × 1920系统缩放未知刷新率未知/);
  assert.doesNotMatch(list.children[1].textContent, /主屏/);
});

test('refresh replaces display rows and unavailable results remove stale resolutions', async () => {
  const { metrics, elements } = await fixture();
  metrics.renderHardwareSummary({ displays: [primary, secondary] }, false);
  metrics.renderHardwareSummary({ displays: [{ ...primary, width: 1920, height: 1080 }] }, true);
  const list = elements.get('hardwareDisplayList');
  assert.equal(list.children.length, 1);
  assert.match(list.textContent, /1920 × 1080/);
  assert.doesNotMatch(list.textContent, /2560 × 1440/);
  metrics.renderHardwareSummary({ displays: [], displayMessage: '显示器信息暂不可用，可点击开始检测重试' }, false);
  assert.equal(list.hidden, true);
  assert.equal(list.children.length, 0);
  assert.equal(elements.get('hardwareDisplayStatus').hidden, false);
  assert.match(elements.get('hardwareDisplayStatus').textContent, /点击开始检测重试/);
});

test('reopening performance refreshes display settings without overlapping hardware queries', async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { metrics, elements } = await fixture(async () => {
    calls += 1;
    if (calls === 1) await pending;
    return { json: async () => ({ ok: true, data: { displays: [{ ...primary, width: calls === 1 ? 2560 : 1920 }] } }) };
  });
  const first = metrics.loadHardwareSummary(false);
  await metrics.loadHardwareSummary(false);
  assert.equal(calls, 1);
  release();
  await first;
  await metrics.loadHardwareSummary(false);
  assert.equal(calls, 2);
  assert.match(elements.get('hardwareDisplayList').textContent, /1920 × 1440/);
});
