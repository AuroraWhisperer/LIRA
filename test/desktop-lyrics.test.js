'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeLyricState } = require('../src/music/lyric-state');

const ROOT_DIR = path.resolve(__dirname, '..');

test('lyric state normalization limits browser-source payloads', () => {
  const state = normalizeLyricState({
    trackTitle: ` Song\u0000${'x'.repeat(200)} `,
    artists: ['Artist', '', ...Array.from({ length: 10 }, (_, index) => `Guest ${index}`)],
    lineText: '<b>lyric</b>',
    words: [
      { text: 'first ', startMs: -20, endMs: 100 },
      { text: 'second', startMs: 500, endMs: 200 }
    ],
    currentMs: -1,
    durationMs: 240000,
    progress: 4,
    playing: true,
    status: 'ready'
  });

  assert.equal(state.trackTitle.length, 120);
  assert.equal(state.trackTitle.includes('\u0000'), false);
  assert.equal(state.artists.length, 8);
  assert.equal(state.lineText, '<b>lyric</b>');
  assert.deepEqual(state.words[0], { text: 'first ', startMs: 0, endMs: 100 });
  assert.deepEqual(state.words[1], { text: 'second', startMs: 500, endMs: 500 });
  assert.equal(state.currentMs, 0);
  assert.equal(state.durationMs, 240000);
  assert.equal(state.progress, 1);
  assert.equal(state.playing, true);
});

test('lyrics browser source shows only current lyrics and real translations', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'lyric-window.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'lyric-window.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'playback', 'desktop-lyric.css'), 'utf8');

  assert.doesNotMatch(html, /id="lyricMeta"|id="lyricPlaybackState"|id="lyricTrack"/);
  assert.match(html, /id="lyricTranslation"[^>]*hidden/);
  assert.match(html, /id="lyricProgress"/);
  assert.match(source, /new WebSocket\(`/);
  assert.match(source, /payload\.type === 'lyric-state'/);
  assert.match(source, /正在载入歌词/);
  assert.match(source, /这首歌暂无歌词/);
  assert.match(source, /正在重新连接/);
  assert.match(source, /escapeHtml\(word\.text/);
  assert.match(source, /translation\.textContent = lyricState\.translation/);
  assert.match(source, /translation\.hidden = !lyricState\.translation/);
  assert.match(source, /requestAnimationFrame\(renderPlaybackFrame\)/);
  assert.match(source, /cancelAnimationFrame\(animationFrame\)/);
  assert.match(source, /progress\.style\.transform = `scaleX/);
  assert.doesNotMatch(source, /lyricPlaybackState|lyricTrack|formatArtists|fallback\.detail/);
  assert.match(styles, /-webkit-text-stroke:\s*var\(--lyric-stroke-width\)/);
  assert.match(styles, /linear-gradient\(90deg, #ffcf4a var\(--word-progress\)/);
  assert.doesNotMatch(styles, /transition:\s*width/);
  assert.match(styles, /transform-origin:\s*left center/);
});

test('desktop lyric surface is compact and independently resizable', () => {
  const windowSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'lyric-window.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'playback', 'desktop-lyric.css'), 'utf8');

  assert.match(windowSource, /width:\s*840/);
  assert.match(windowSource, /height:\s*128/);
  assert.match(windowSource, /minWidth:\s*280/);
  assert.match(windowSource, /minHeight:\s*64/);
  assert.match(windowSource, /resizable:\s*true/);
  assert.doesNotMatch(windowSource, /setAspectRatio|aspectRatio/);
  assert.match(styles, /height:\s*min\(78vh,\s*220px\)/);
  assert.match(styles, /font-size:\s*min\(var\(--lyric-size\),\s*8\.5vw,\s*34vh\)/);
  assert.match(styles, /@media \(max-height:\s*96px\)/);
  assert.match(styles, /\.lyric-window-translation,\s*\.lyric-window-progress\s*\{\s*display:\s*none/);
  assert.match(styles, /font-size:\s*min\(var\(--lyric-size\),\s*8\.5vw,\s*52vh\)/);
});

test('playback publishes lyrics through the authenticated local API', () => {
  const service = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'),
    'utf8'
  );
  const routes = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server', 'routes', 'playback-routes.js'), 'utf8');

  assert.match(service, /fetch\('\/api\/playback\/lyric-state'/);
  assert.match(service, /status:\s*!track \? 'idle'/);
  assert.match(service, /durationMs:\s*Math\.round\(duration \* 1000\)/);
  assert.match(routes, /'POST \/api\/playback\/lyric-state'/);
  assert.match(routes, /normalizeLyricState/);
});
