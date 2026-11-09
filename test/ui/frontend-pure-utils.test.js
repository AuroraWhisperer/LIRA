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
  const { withMultilingualFallback } = await loadModuleExports(modulePath('shared/font-family.js'), globals);
  const playback = await loadModuleExports(modulePath('playback/utils.js'), globals);

  const fallback = withMultilingualFallback('');
  assert.ok(fallback.length > 0);
  assert.equal(withMultilingualFallback('  Noto Sans  '), `Noto Sans, ${fallback}`);
  const artwork = playback.renderArtwork({ coverUrl: 'https://example.test/a?x="`&y=1' }, { fallback: '<歌>' });
  assert.ok(artwork.includes('src="https://example.test/a?x=&quot;&#96;&amp;y=1"'));
  assert.ok(artwork.includes('<span>&lt;歌&gt;</span>'));
  assert.deepEqual(window, {});
});

test('HTML escaping retains falsy normalization and attribute-only backtick escaping', async () => {
  const { escapeHtml, escapeAttr } = await loadModuleExports(modulePath('shared/html-escape.js'));
  assert.equal(escapeHtml(0), '');
  assert.equal(escapeAttr(0), '');
  assert.equal(escapeHtml('&<>"\'`'), '&amp;&lt;&gt;&quot;&#39;`');
  assert.equal(escapeAttr('&<>"\'`'), '&amp;&lt;&gt;&quot;&#39;&#96;');
  assert.equal(escapeHtml('0'), '0');
  assert.equal(escapeHtml(true), 'true');
});

test('money formatting rounds to cents and never displays invalid or negative amounts', async () => {
  const { formatMoney } = await loadModuleExports(modulePath('shared/display-format.js'));
  for (const [input, expected] of [[NaN, '¥0.00'], [-1, '¥0.00'], [1.236, '¥1.24']]) assert.equal(formatMoney(input), expected);
});
