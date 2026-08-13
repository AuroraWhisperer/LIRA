'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
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

test('desktop lyric settings include a live word-timed preview', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric-preview.js'), 'utf8');
  const sharedRenderer = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-word-renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'desktop-lyric-preview.css'), 'utf8');

  assert.match(html, /class="desktop-lyric-workspace"/);
  assert.match(html, /class="[^"]*desktop-lyric-settings-fields[^"]*"/);
  assert.match(html, /id="desktopLyricAutosaveState"/);
  assert.ok(html.indexOf('id="desktopLyricForm"') < html.indexOf('id="desktopLyricLivePreview"'));
  assert.doesNotMatch(html, /保存桌面歌词设置/);
  assert.match(html, /id="desktopLyricLivePreview"/);
  assert.match(html, /id="desktopLyricPreviewLine"/);
  assert.match(html, /id="desktopLyricPreviewTranslation"/);
  assert.match(html, /id="desktopLyricPreviewProgress"/);
  assert.match(html, /id="desktopLyricOpenWindowBtn"/);
  assert.match(html, /data-lyric-preview-background="grid"/);
  assert.match(source, /new LyricWordRenderer/);
  assert.match(source, /app:lyric-state/);
  assert.match(source, /musicAPI\.openLyricWindow/);
  assert.match(source, /desktopLyricFontFamily/);
  assert.match(source, /style\.setProperty/);
  assert.match(sharedRenderer, /element\.textContent = word\.text/);
  assert.match(sharedRenderer, /requestAnimationFrame/);
  assert.match(styles, /--preview-word-progress/);
  assert.match(styles, /\.desktop-lyric-preview-stage\.is-solid/);
  assert.match(styles, /grid-template-columns:\s*minmax\(280px, 380px\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.desktop-lyric-settings-fields\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(settingsSource, /AUTOSAVE_DELAY_MS/);
  assert.match(settingsSource, /form\.addEventListener\('input'/);
  assert.match(settingsSource, /form\.addEventListener\('change'/);
  assert.doesNotMatch(settingsSource, /form\.addEventListener\('submit'/);
  assert.doesNotMatch(settingsSource, /reloadState\(\)/);
});

test('desktop lyric settings debounce input and serialize the latest automatic save', async () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'), 'utf8');
  const listeners = new Map();
  const windowListeners = new Map();
  const apiCalls = [];
  const form = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    }
  };
  const autosaveState = { textContent: '', className: '' };
  const values = {
    desktopLyricFontFamily: 'Microsoft YaHei',
    desktopLyricFontWeight: '800',
    desktopLyricTextColor: '#000000',
    desktopLyricStrokeColor: '#ffffff',
    desktopLyricFontSize: '56',
    desktopLyricStrokeWidth: '3',
    desktopLyricOpacity: '0.95',
    desktopLyricBgOpacity: '0.15',
    desktopLyricScale: '1',
    desktopLyricLineHeight: '1.4',
    desktopLyricShadowIntensity: '0.35',
    desktopLyricTranslationScale: '0.65'
  };
  const elements = new Map(Object.entries(values).map(([id, value]) => [id, { value }]));
  elements.set('desktopLyricForm', form);
  elements.set('desktopLyricAutosaveState', autosaveState);
  let scheduledTimer = null;
  let resolveFirstSave;
  const sandbox = {
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      }
    },
    setTimeout(callback, delay) {
      scheduledTimer = { callback, delay };
      return 1;
    },
    clearTimeout() {
      scheduledTimer = null;
    },
    window: {
      addEventListener(type, handler) {
        windowListeners.set(type, handler);
      },
      AdminApp: {
        utils: {
          value: (id) => elements.get(id)?.value || '',
          setValue: (id, value) => { elements.get(id).value = value; },
          api: (url, body) => {
            apiCalls.push({ url, body });
            if (apiCalls.length === 1) {
              return new Promise((resolve) => { resolveFirstSave = resolve; });
            }
            return Promise.resolve({ ok: true });
          }
        },
        forms: { bindRangePair() {} },
        desktopLyricPreview: { init() {}, applySettings() {} }
      }
    }
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.desktopLyric.initDesktopLyricForm();

  listeners.get('input')();
  assert.equal(apiCalls.length, 0);
  assert.equal(scheduledTimer, null);
  assert.equal(autosaveState.textContent, '正在读取设置…');
  windowListeners.get('app:settings-state')();
  assert.equal(scheduledTimer.delay, 500);
  scheduledTimer.callback();
  assert.equal(apiCalls.length, 1);

  elements.get('desktopLyricFontSize').value = '64';
  listeners.get('change')();
  assert.equal(apiCalls.length, 1, 'a second write waits for the in-flight request');
  resolveFirstSave({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[0].url, '/api/settings');
  assert.equal(apiCalls[1].body.desktopLyricFontSize, '64');
  assert.equal(autosaveState.textContent, '已自动保存');
  assert.match(autosaveState.className, /is-saved/);
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
