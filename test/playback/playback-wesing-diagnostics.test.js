'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readAdminFragmentHtml } = require('../helpers/admin-html');

async function fixture(request) {
  const elements = new Map();
  const listeners = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { hidden: true, disabled: false, textContent: '',
        addEventListener(type, fn) {
          const key = `${id}:${type}`;
          listeners.set(key, [...(listeners.get(key) || []), fn]);
        },
      });
      return elements.get(id);
    },
  };
  const { createWeSingDiagnostics } = await loadModuleExports(path.resolve('public/js/playback/services/wesing-diagnostics.js'), {
    document,
  });
  const controller = createWeSingDiagnostics({ request });
  controller.init(); controller.init();
  return { controller, listeners,
    element: (suffix) => document.getElementById(`weSingDiagnostic${suffix}`),
    click(suffix) { return Promise.all(listeners.get(`weSingDiagnostic${suffix}:click`).map(fn => fn())); },
  };
}

function report(result = 'playback-stalled') {
  return { version: 1, startedAt: '2026-10-15T12:30:00.123Z', initial: { currentMs: 5000 },
    final: { trackTitle: '<img src=x onerror=alert(1)>', lyricsReady: true, lyricLineCount: 23, currentMs: 5000, hasCurrentLine: false },
    summary: { result, clockAdvanced: false, outputDeviceCount: 3, audioSessionCount: 1, audible: false },
    samples: [{ playback: { currentMs: 5000 } }],
  };
}

test('WeSing playback diagnostic is immediately left of refresh and starts one recording', async () => {
  const html = readAdminFragmentHtml('pages/admin/playback/page.html');
  assert.match(html, /id="weSingDiagnosticBtn"[^>]*>播放诊断<\/button>\s*<button id="weSingRefreshBtn"/);
  assert.match(html, /id="weSingDiagnosticPanel"[^>]*hidden/);
  const deferred = Promise.withResolvers();
  const requests = [];
  const f = await fixture((url, options) => { requests.push({ url, options }); return deferred.promise; });
  assert.ok([...f.listeners.values()].every((handlers) => handlers.length === 1));
  const first = f.controller.start();
  const duplicate = f.controller.start();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/music/wesing/diagnose');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(f.element('Panel').hidden, false);
  assert.equal(f.element('Btn').disabled, true);
  assert.match(f.element('Message').textContent, /20 秒/);
  f.click('Close');
  deferred.resolve(report());
  await Promise.all([first, duplicate]);
  assert.equal(f.element('Panel').hidden, true, 'a late report must not reopen a closed panel');
  assert.equal(f.element('Btn').disabled, false);
  assert.equal(f.element('Export').disabled, false);
  assert.match(f.element('Message').textContent, /时钟没有推进/);
  assert.equal(f.element('Track').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(f.element('Track').innerHTML, undefined);
  assert.match(f.element('Audio').textContent, /3 个输出设备.*未检测到声音/);
});

test('WeSing playback diagnostic retries failures without changing playback and exports only on click', async () => {
  let calls = 0;
  let exports = 0;
  const requests = [];
  const savedPath = 'C:/LIRA/logs/wesing-playback-diagnostic-2026-10-15_20-30-00-123.json';
  const f = await fixture(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/export')) {
      if (++exports === 1) throw new Error('日志文件夹不可写');
      return { path: savedPath };
    }
    if (++calls === 1) throw new Error('网络中断');
    return report('ready');
  });
  await f.controller.start();
  assert.match(f.element('Message').textContent, /网络中断/);
  assert.equal(f.element('Btn').disabled, false);
  assert.equal(f.element('Export').disabled, true);
  await f.controller.start();
  assert.equal(exports, 0);
  await f.click('Export');
  assert.match(f.element('Message').textContent, /日志文件夹不可写/);
  assert.equal(f.element('Export').disabled, false);
  await f.click('Export');
  assert.equal(exports, 2);
  assert.equal(f.element('Message').textContent, `已保存到日志文件夹：${savedPath}`);
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))), { url: '/api/music/wesing/diagnose/export',
    options: { method: 'POST', body: { startedAt: report().startedAt } } });
});

test('WeSing export blocks duplicate saves and does not overwrite a newer diagnosis message', async () => {
  const save = Promise.withResolvers();
  const nextDiagnosis = Promise.withResolvers();
  let diagnoses = 0;
  let saves = 0;
  const f = await fixture((url) => {
    if (url.endsWith('/export')) { saves++; return save.promise; }
    return ++diagnoses === 1 ? Promise.resolve(report()) : nextDiagnosis.promise;
  });
  await f.controller.start();
  const first = f.click('Export');
  await f.click('Export');
  assert.equal(saves, 1);
  assert.equal(f.element('Export').disabled, true);
  const next = f.controller.start();
  save.resolve({ path: 'logs/old-report.json' });
  await first;
  assert.match(f.element('Message').textContent, /正在采样/);
  assert.equal(f.element('Export').disabled, true);
  nextDiagnosis.resolve(report('ready')); await next;
});
