'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { loadModuleExports } = require('../helpers/frontend-modules');

const modulePath = (file) => path.resolve(__dirname, '../../public/js', file);

test('pure entry points and playback helpers load as real ESM without publishing or accessing UI globals', async () => {
  assert.equal(typeof vm.SourceTextModule, 'function', 'Run with --experimental-vm-modules to test the real import graph.');
  const window = {};
  const forbiddenGlobal = new Proxy(window, {
    get(_target, property) { assert.fail(`Pure modules must not read UI global ${String(property)}`); },
    set(_target, property) { assert.fail(`Pure modules must not write UI global ${String(property)}`); },
  });
  const globals = { window: forbiddenGlobal, document: forbiddenGlobal, navigator: forbiddenGlobal, fetch: () => assert.fail('Unexpected request') };
  await loadModuleExports(modulePath('shared/html-escape.js'), globals);
  await loadModuleExports(modulePath('shared/display-format.js'), globals);
  const playback = await loadModuleExports(modulePath('playback/utils.js'), globals);

  assert.equal(playback.formatPlaylistMeta({ trackCount: 2, playCount: 12000 }), '2 首 · 1.2万 次播放');
  const artwork = playback.renderArtwork({ coverUrl: 'https://example.test/a?x="`&y=1' }, { fallback: '<歌>' });
  assert.ok(artwork.includes('src="https://example.test/a?x=&quot;&#96;&amp;y=1"'));
  assert.ok(artwork.includes('<span>&lt;歌&gt;</span>'));
  assert.deepEqual(window, {});
});

test('HTML escaping retains falsy normalization and attribute-only backtick escaping', async () => {
  const { escapeHtml, escapeAttr } = await loadModuleExports(modulePath('shared/html-escape.js'));
  for (const value of [undefined, null, false, 0, NaN, '']) {
    assert.equal(escapeHtml(value), '');
    assert.equal(escapeAttr(value), '');
  }
  assert.equal(escapeHtml('&<>"\'`'), '&amp;&lt;&gt;&quot;&#39;`');
  assert.equal(escapeAttr('&<>"\'`'), '&amp;&lt;&gt;&quot;&#39;&#96;');
  assert.equal(escapeHtml('0'), '0');
  assert.equal(escapeHtml(true), 'true');
});

test('display formatting preserves existing placeholders, units and rounding', async () => {
  const format = await loadModuleExports(modulePath('shared/display-format.js'));
  const cases = {
    formatTime: [[undefined, ''], [0, ''], ['2026-10-22T01:02:03', '01:02:03']],
    formatDateTime: [[undefined, '--'], [0, '--'], ['2026-10-22T01:02:03', '2026/10/22 01:02:03']],
    formatBytes: [[-1, '--'], [NaN, '--'], [0, '0.00 B'], [1024, '1.00 KB'], [15360, '15.0 KB']],
    formatDuration: [[0, '--'], [NaN, '--'], [59.9, '59秒'], [61, '1分钟1秒'], [3661, '1小时1分钟']],
    formatSuperChatPrice: [[NaN, '0'], [0, '0'], [1.2, '1.2'], [1.236, '1.24']],
    formatMoney: [[NaN, '¥0.00'], [-1, '¥0.00'], [0, '¥0.00'], [1.236, '¥1.24']],
    formatCompactNumber: [[NaN, '0'], [-1, '0'], [1.6, '2'], [10000, '1万'], [125000000, '1.3亿']],
  };
  for (const [name, values] of Object.entries(cases)) {
    for (const [input, expected] of values) assert.equal(format[name](input), expected, `${name}(${String(input)})`);
  }
});

test('legacy utility entry retains named exports, aggregate exports and the existing AdminApp publication', async () => {
  const window = {};
  const legacy = await loadModuleExports(modulePath('shared/utils.js'), { window });
  const names = [
    'escapeHtml', 'escapeAttr', 'formatTime', 'formatDateTime', 'formatBytes',
    'formatDuration', 'formatSuperChatPrice', 'formatMoney', 'formatCompactNumber',
    'value', 'setValue', 'localOverlayOrigin', 'copyText', 'withMultilingualFallback',
    'toast', 'showStackedToast', 'api', 'readJsonResponse', 'showError', 'debounce',
    'normalizeRangeValue', 'showConfirmationDialog', 'logoutConfirm', 'dangerConfirm',
  ];
  assert.deepEqual(Object.keys(legacy).sort(), [...names, 'utils'].sort());
  for (const name of names) {
    assert.equal(typeof legacy[name], 'function', name);
    assert.equal(legacy.utils[name], legacy[name], name);
  }
  assert.equal(typeof legacy.utils.multilingualFontFallback, 'string');
  assert.equal(window.AdminApp.utils, legacy.utils);
  assert.equal(legacy.escapeHtml(0), '');
  assert.equal(legacy.formatMoney(1.2), '¥1.20');
});
