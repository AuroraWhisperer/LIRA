'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.resolve(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(ROOT_DIR, ...segments), 'utf8');

test('desktop lyric styles separate admin controls from shared rendering', () => {
  const entry = read('public', 'css', 'admin', 'desktop-lyric-preview.css');
  const imports = Array.from(entry.matchAll(/@import\s+url\(['"]([^'"]+)['"]\);/g), (match) => match[1]);

  assert.deepEqual(imports, [
    './desktop-lyric/settings.css',
    './desktop-lyric/controls.css',
    '../lyrics/desktop-lyric.css',
    './desktop-lyric/preview.css',
  ]);

  const settings = read('public', 'css', 'admin', 'desktop-lyric', 'settings.css');
  const controls = read('public', 'css', 'admin', 'desktop-lyric', 'controls.css');
  const preview = read('public', 'css', 'admin', 'desktop-lyric', 'preview.css');
  const renderer = read('public', 'css', 'lyrics', 'desktop-lyric.css');
  const overlay = read('public', 'pages', 'overlays', 'lyric-window.html');

  assert.match(settings, /\.desktop-lyric-settings\s*\{/);
  assert.match(settings, /\.desktop-lyric-source-options\s*\{/);
  assert.match(controls, /\.desktop-lyric-karaoke-card\s*\{/);
  assert.match(controls, /\.desktop-lyric-control \.range-row\s*\{/);
  assert.match(preview, /\.desktop-lyric-preview-header\s*\{/);
  assert.match(preview, /@container admin-lyric-preview \(max-width:\s*560px\)/);
  assert.match(renderer, /\.desktop-lyric-preview-card\s*\{/);
  assert.match(renderer, /\.desktop-lyric-preview-stage\s*\{/);
  assert.match(renderer, /\.desktop-lyric-preview-row-text\s*\{/);
  assert.match(renderer, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(
    renderer,
    /\.desktop-lyric-(?:settings|source|control|preview-header|preview-tools|preview-backgrounds|workspace)|admin-lyric-preview/,
  );
  assert.match(overlay, /\/css\/lyrics\/desktop-lyric\.css\?v=20260913-01/);
  assert.doesNotMatch(overlay, /\/css\/admin\/desktop-lyric-preview\.css/);
  assert.ok(overlay.indexOf('/css/lyrics/desktop-lyric.css') < overlay.indexOf('/css/styles-playback.css'));

  const bundle = readCssBundle('public', 'css', 'admin', 'desktop-lyric-preview.css');
  for (const selector of [
    '.desktop-lyric-settings',
    '.desktop-lyric-karaoke-card',
    '.desktop-lyric-preview-card',
    '.desktop-lyric-preview-header',
    '.desktop-lyric-preview-row',
  ]) {
    assert.ok(bundle.includes(selector), `${selector} should remain composed`);
  }
});
