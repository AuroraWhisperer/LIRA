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
