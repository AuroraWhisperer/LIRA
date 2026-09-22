'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');

test('lyrics browser source reuses the neutral live timeline renderer', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'lyric-window.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'lyric-window.js'), 'utf8');
  const adminPreviewSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric-preview.js'),
    'utf8',
  );
  const rendererSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-renderer.js'),
    'utf8',
  );
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'playback', 'desktop-lyric.css'), 'utf8');

  assert.match(html, /css\/lyrics\/desktop-lyric\.css/);
  assert.match(html, /id="desktopLyricPreviewViewport"[^>]*tabindex="0"/);
  assert.match(html, /id="desktopLyricPreviewTimeline"/);
  assert.match(html, /id="desktopLyricPreviewPlayback"[^>]*aria-live="polite"/);
  assert.match(html, /id="desktopLyricPreviewProgress"/);
  assert.match(html, /type="module"[\s\S]*js\/overlays\/lyric-window\.js/);
  assert.match(
    source,
    /import \{ desktopLyricRenderer \} from ["']\.\.\/lyrics\/desktop-lyric-renderer\.js\?v=20260913-01["'];/,
  );
  assert.doesNotMatch(source, /\.\.\/admin\/|window\.AdminApp/);
  assert.match(source, /desktopLyricRenderer\.init\(\)/);
  assert.match(source, /new WebSocket\(`/);
  assert.match(source, /payload\.type === ["']lyric-state["']/);
  assert.match(source, /payload\.type === ["']lyric-timeline["']/);
  assert.match(source, /payload\.state\?\.lyricTimeline/);
  assert.match(source, /desktopLyricRenderer\.applySettings/);
  assert.match(adminPreviewSource, /from ["']\.\.\/lyrics\/desktop-lyric-renderer\.js["'];/);
  assert.match(rendererSource, /export const desktopLyricRenderer = Object\.freeze\(\{/);
  assert.doesNotMatch(rendererSource, /window\.AdminApp|desktop-lyric-controls|shared\/utils/);
  assert.match(rendererSource, /getElementById\(["']desktopLyricSurface["']\)/);
  assert.match(styles, /\.lyric-window-card\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/);
  assert.match(styles, /\.lyric-window-stage\s*\{[^}]*height:\s*100vh/);
  assert.match(styles, /background(?:-color)?:\s*transparent/);
});
