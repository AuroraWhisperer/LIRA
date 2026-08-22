'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { addFrameProtectionHeaders, contentType } = require('../src/server/http-utils');

const ROOT_DIR = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');

test('opening overlay assets and explicit route are registered', () => {
  const musicPath = path.join(ROOT_DIR, 'public/img/overlays/opening/music.ogg');
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/pages/overlays/opening.html')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/css/overlays/opening.css')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/js/overlays/opening.js')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/img/overlays/opening/avatar.webp')));
  assert.ok(fs.existsSync(musicPath));
  assert.ok(fs.statSync(musicPath).size > 100_000);
  assert.equal(fs.readFileSync(musicPath).subarray(0, 4).toString('ascii'), 'OggS');
  const server = read('src', 'server', 'http-utils.js');
  assert.match(server, /\['\/opening',\s*'pages\/overlays\/opening\.html'\]/);
  assert.match(server, /'\.ogg':\s*'audio\/ogg'/);
  assert.equal(contentType(path.join(ROOT_DIR, 'public/img/overlays/opening/music.ogg')), 'audio/ogg');
});

test('opening overlay is frameable and keeps the required character transform layers', () => {
  const headers = new Map();
  addFrameProtectionHeaders({ setHeader(name, value) { headers.set(name, value); } }, '/opening');
  assert.equal(headers.has('Content-Security-Policy'), false);
  assert.equal(headers.has('X-Frame-Options'), false);

  const html = read('public', 'pages', 'overlays', 'opening.html');
  for (const className of ['character-anchor', 'character-enter', 'character-float', 'character-sway', 'character-breathe', 'character-image']) {
    assert.match(html, new RegExp(`class="[^"]*${className}[^"]*"`));
  }
  assert.match(html, /class="track-waveform"/);
  assert.match(html, /id="openingTrackPath"/);
  assert.match(html, /<animateMotion[^>]+repeatCount="indefinite"/);
  assert.match(html, /<mpath href="#openingTrackPath"/);
  assert.doesNotMatch(html, /<span class="track-heart"/);
  assert.doesNotMatch(html, />@<\/span>/);
  assert.doesNotMatch(html, /track-flow/);
});

test('opening overlay animation honors quality, motion, visibility, and safe text rendering', () => {
  const css = read('public', 'css', 'overlays', 'opening.css');
  const script = read('public', 'js', 'overlays', 'opening.js');
  assert.match(css, /background-color:\s*var\(--opening-night\)/);
  assert.match(css, /height:\s*100vh/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /container-type:\s*size/);
  assert.match(css, /width:\s*min\(100vw,\s*177\.7778dvh\)/);
  assert.match(css, /font-size:\s*var\(--opening-title-size(?:,[^)]+)?\)/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /cqw/);
  assert.match(css, /\.track::before/);
  assert.match(css, /\.track-heart-motion/);
  assert.match(css, /translate3d\(/);
  assert.doesNotMatch(css, /background-position/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /Array\.from/);
  assert.match(script, /textContent/);
  assert.match(script, /QUALITY_LIMITS/);
  assert.match(script, /titleSizeForLength/);
  assert.match(script, /title:\s*'唱一首，在一首，给你的歌'/);
  assert.match(script, /MAX_LENGTHS = Object\.freeze\(\{ title: 20/);
  assert.match(script, /name:\s*''/);
  assert.match(script, /audio:\s*'browser'/);
  assert.match(script, /openingNameRow/);
  assert.match(script, /audio === 'browser'/);
  assert.match(script, /console\.warn/);
});

test('Toolbox opening animation owns the master switch and URL preview without settings writes', () => {
  const html = read('public', 'pages', 'admin', 'toolbox', 'start-animation.html');
  const script = read('public', 'js', 'admin', 'start-animation.js');
  const styles = read('public', 'css', 'admin', 'other-features', 'start-animation.css');
  assert.match(html, /class="[^"]*other-feature-panel-body[^"]*opening-animation-panel/);
  assert.match(html, /id="openingEnabled"[^>]*type="checkbox"/);
  for (const id of ['openingTitle', 'openingTitleCount', 'openingSubtitle', 'openingName', 'openingFooter', 'openingQuality', 'openingShowNotes', 'openingShowEq', 'openingUrl', 'openingPreview']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="openingTitle"[^>]+value="唱一首，在一首，给你的歌"/);
  assert.match(html, /id="openingTitle"[^>]+maxlength="20"/);
  assert.match(html, /id="openingName"[^>]+value=""/);
  assert.match(script, /URLSearchParams/);
  assert.match(script, /localOverlayOrigin/);
  assert.match(script, /params\.set\('enabled'/);
  assert.match(script, /params\.set\('audio',\s*'browser'\)/);
  assert.match(script, /openingTitleCount/);
  assert.match(script, /Array\.from\(config\.title\)\.length}\/20/);
  assert.doesNotMatch(script, /\/api\/settings/);
  assert.doesNotMatch(script, /localStorage/);
  assert.match(styles, /aspect-ratio:\s*16 \/ 9/);
  assert.match(styles, /overflow-y:\s*auto/);
  assert.match(read('public', 'js', 'admin', 'app.js'), /initStartAnimation\(\)/);
});
