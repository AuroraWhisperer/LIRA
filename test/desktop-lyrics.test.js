'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { normalizeLyricState } = require('../src/music/lyric-state');
const { normalizeLyricTimeline } = require('../src/music/lyric-timeline');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');

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

test('lyrics browser source reuses the full live timeline preview', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'lyric-window.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'lyric-window.js'), 'utf8');
  const previewSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric-preview.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'playback', 'desktop-lyric.css'), 'utf8');

  assert.match(html, /css\/admin\/desktop-lyric-preview\.css/);
  assert.match(html, /id="desktopLyricPreviewViewport"[^>]*tabindex="0"/);
  assert.match(html, /id="desktopLyricPreviewTimeline"/);
  assert.match(html, /id="desktopLyricPreviewPlayback"[^>]*aria-live="polite"/);
  assert.match(html, /id="desktopLyricPreviewProgress"/);
  assert.match(html, /script type="module"[^>]*js\/overlays\/lyric-window\.js/);
  assert.match(source, /import '\.\.\/admin\/desktop-lyric-preview\.js\?v=20260816-02';/);
  assert.match(source, /desktopLyricPreview\.init\(null\)/);
  assert.match(source, /new WebSocket\(`/);
  assert.match(source, /payload\.type === 'lyric-state'/);
  assert.match(source, /payload\.type === 'lyric-timeline'/);
  assert.match(source, /payload\.state\?\.lyricTimeline/);
  assert.match(source, /desktopLyricPreview\.applySettings/);
  assert.match(previewSource, /getElementById\('desktopLyricSurface'\)/);
  assert.match(styles, /\.lyric-window-card\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/);
  assert.match(styles, /\.lyric-window-stage\s*\{[^}]*height:\s*100vh/);
  assert.match(styles, /background(?:-color)?:\s*transparent/);
});

test('obsolete Electron lyric window path is removed', () => {
  const mainSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'main.js'), 'utf8');
  const ipcSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'ipc', 'music-ipc.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'preload.js'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'), 'utf8');

  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'src', 'electron', 'lyric-window.js')), false);
  assert.doesNotMatch(mainSource, /lyricWin|openLyricWindow|closeLyricWindow|updateLyricWindow|setLyricWindowLocked/);
  assert.doesNotMatch(ipcSource, /music:(?:open|close|update|set)-lyric-window|LyricWindow/);
  assert.doesNotMatch(preloadSource, /openLyricWindow|closeLyricWindow|updateLyricWindow|setLyricWindowLocked|onLyricState/);
  assert.doesNotMatch(serviceSource, /windowOpen|windowLocked|musicAPI\.(?:open|close|update|set)LyricWindow/);
  assert.match(serviceSource, /fetch\('\/api\/playback\/lyric-state'/);
  assert.match(serviceSource, /fetch\('\/api\/playback\/lyric-timeline'/);
});

test('lyric timeline normalization bounds complete browser lyric payloads', () => {
  const timeline = normalizeLyricTimeline({
    trackTitle: ` Song\u0000${'x'.repeat(200)} `,
    artists: ['Artist', '', ...Array.from({ length: 10 }, (_, index) => `Guest ${index}`)],
    status: 'ready',
    lines: Array.from({ length: 600 }, (_, index) => ({
      startMs: 600000 - index * 1000,
      endMs: index % 2 === 0 ? -20 : 700000,
      text: `第 ${index} 行\u0000${'词'.repeat(160)}`,
      translation: '<b>translation</b>',
      roma: 'romanization'
    }))
  });

  assert.equal(timeline.trackTitle.length, 120);
  assert.equal(timeline.trackTitle.includes('\u0000'), false);
  assert.equal(timeline.artists.length, 8);
  assert.equal(timeline.status, 'ready');
  assert.ok(timeline.lines.length > 0);
  assert.ok(timeline.lines.length <= 500);
  assert.ok(timeline.lines.every((line, index) => (
    index === 0 || timeline.lines[index - 1].startMs <= line.startMs
  )));
  assert.ok(timeline.lines.every((line) => !line.text.includes('\u0000')));
  assert.ok(Buffer.byteLength(JSON.stringify(timeline), 'utf8') < 220 * 1024);
});

test('lyric timeline normalization preserves all 64 renderable lines from 失控', () => {
  const timeline = normalizeLyricTimeline({
    trackTitle: '失控',
    artists: ['井迪'],
    status: 'ready',
    lines: Array.from({ length: 64 }, (_, index) => ({
      startMs: index === 63 ? 247519 : index * 3900,
      endMs: index === 63 ? 248500 : index * 3900 + 3000,
      text: index === 0 ? '井迪儿 - 失控' : index === 63 ? '多嘲讽' : `第 ${index + 1} 行`
    }))
  });

  assert.equal(timeline.lines.length, 64);
  assert.equal(timeline.lines[0].text, '井迪儿 - 失控');
  assert.equal(timeline.lines.at(-1).text, '多嘲讽');
  assert.equal(timeline.lines.at(-1).startMs, 247519);
});

test('desktop lyric settings expose WeSing-only lyric source preferences', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'song', 'desktop-lyric.html'),
    'utf8'
  );
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'desktop-lyric-preview.css'),
    'utf8'
  );
  const sourceSettingsIndex = html.indexOf('class="theme-section desktop-lyric-source-settings"');
  const styleSettingsIndex = html.indexOf('<strong>基础样式</strong>');

  assert.ok(sourceSettingsIndex >= 0 && sourceSettingsIndex < styleSettingsIndex);
  assert.match(html, /role="radiogroup"[^>]*aria-labelledby="weSingLyricSourceLabel"/);
  assert.match(html, /<input type="radio" name="weSingLyricSource" value="netease" checked>/);
  assert.match(html, /<input type="radio" name="weSingLyricSource" value="qq">/);
  assert.doesNotMatch(html, /网易云音乐（默认）/);
  assert.match(html, /<input id="weSingSmartLyricMatch" type="checkbox" checked/);
  assert.match(html, /<legend>全民 K 歌在线歌词<\/legend>/);
  assert.match(html, /仅在本地 QRC 不可用时生效/);
  assert.match(html, /不会改变 QQ 音乐或网易云音乐播放器的歌词来源/);
  assert.doesNotMatch(html, /\bsource-tab\b/);
  assert.match(styles, /\.desktop-lyric-source-options\s*\{/);
  assert.match(styles, /\.desktop-lyric-source-option input:checked \+ \.desktop-lyric-source-choice/);
  assert.match(styles, /\.desktop-lyric-source-option input:focus-visible \+ \.desktop-lyric-source-choice/);
  assert.match(styles, /\.desktop-lyric-smart-match-row\s*\{/);
});

test('desktop lyric settings define the merged presentation defaults', () => {
  assert.equal(DEFAULT_SETTINGS.desktopLyricFallbackFontFamily, 'Microsoft JhengHei');
  assert.equal(DEFAULT_SETTINGS.desktopLyricTextAlign, 'left');
  assert.equal(DEFAULT_SETTINGS.desktopLyricShowTranslation, 'true');
  assert.equal(DEFAULT_SETTINGS.desktopLyricKaraokeEnabled, 'true');
  assert.equal(DEFAULT_SETTINGS.desktopLyricHideOnPause, 'false');
  assert.equal(DEFAULT_SETTINGS.desktopLyricTimeOffsetMs, '0');
  assert.equal(DEFAULT_SETTINGS.desktopLyricSpringAnimation, 'false');
  assert.equal(DEFAULT_SETTINGS.desktopLyricBlurEffect, 'false');
  assert.equal(DEFAULT_SETTINGS.desktopLyricScaleEffect, 'false');
  assert.equal(DEFAULT_SETTINGS.desktopLyricAlignPosition, '0.5');
  assert.equal(DEFAULT_SETTINGS.desktopLyricBackgroundEnabled, 'false');
  assert.equal(DEFAULT_SETTINGS.desktopLyricBrightness, '1');
  assert.equal(DEFAULT_SETTINGS.desktopLyricVisibleLines, '0');
});

test('desktop lyric settings use icon alignment controls and performance-safe motion defaults', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'song', 'desktop-lyric.html'),
    'utf8'
  );
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'),
    'utf8'
  );
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'desktop-lyric-preview.css'),
    'utf8'
  );

  assert.match(html, /id="desktopLyricTextAlign"[^>]*role="radiogroup"/);
  for (const value of ['left', 'center', 'right', 'justify']) {
    assert.match(html, new RegExp(`name="desktopLyricTextAlign" value="${value}"`));
  }
  assert.match(html, /id="desktopLyricSpringAnimation" type="checkbox">/);
  assert.match(html, /id="desktopLyricBlurEffect" type="checkbox">/);
  assert.match(html, /id="desktopLyricScaleEffect" type="checkbox">/);
  assert.match(html, /id="desktopLyricVisibleLines" type="number"/);
  assert.doesNotMatch(source, /\['desktopLyricVisibleLines', 0, 99, 0\]/);
  assert.match(html, /id="desktopLyricSpringHint" role="tooltip"/);
  assert.match(html, /id="desktopLyricBlurHint" role="tooltip"/);
  assert.match(styles, /\.desktop-lyric-align-options\s*\{/);
  assert.match(styles, /label:has\(input:focus-visible\)/);
  assert.match(styles, /\.desktop-lyric-performance-hint:focus-visible \[role="tooltip"\]/);
});

test('desktop lyric settings organize the merged controls below lyric matching', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'song', 'desktop-lyric.html'),
    'utf8'
  );
  const sourceIndex = html.indexOf('<legend>全民 K 歌在线歌词</legend>');
  const groupNames = [
    '基础样式',
    '描边与阴影',
    '内容与显示',
    '可见性与同步',
    '动画与布局',
    '背景与渲染',
    '操作'
  ];
  let previousIndex = sourceIndex;
  for (const name of groupNames) {
    const index = html.indexOf(`>${name}<`);
    assert.ok(index > previousIndex, `${name} should follow the previous settings group`);
    previousIndex = index;
  }

  for (const id of [
    'desktopLyricLoadLocalFontsBtn',
    'desktopLyricLocalFontStatus',
    'desktopLyricFallbackFontFamily',
    'desktopLyricTextAlign',
    'desktopLyricLetterSpacing',
    'desktopLyricStrokeEnabled',
    'desktopLyricShadowEnabled',
    'desktopLyricShadowColor',
    'desktopLyricShowTranslation',
    'desktopLyricKaraokeEnabled',
    'desktopLyricHidePassedLines',
    'desktopLyricTraditionalMode',
    'desktopLyricHideOnPause',
    'desktopLyricCurrentLineEnhanced',
    'desktopLyricBaseOpacity',
    'desktopLyricTranslationOpacity',
    'desktopLyricTimeOffsetMs',
    'desktopLyricNoLyricText',
    'desktopLyricSpringAnimation',
    'desktopLyricBlurEffect',
    'desktopLyricScaleEffect',
    'desktopLyricAlignPosition',
    'desktopLyricAlignAnchor',
    'desktopLyricTranslateX',
    'desktopLyricTranslateY',
    'desktopLyricPerspective',
    'desktopLyricRotateX',
    'desktopLyricRotateY',
    'desktopLyricBackgroundEnabled',
    'desktopLyricBackgroundRenderer',
    'desktopLyricGlobalOpacity',
    'desktopLyricBrightness',
    'desktopLyricContrast',
    'desktopLyricSaturation',
    'desktopLyricResetBtn'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('desktop lyric settings list unique local font families and preserve denial state', async () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'), 'utf8');
  const listeners = new Map();
  const form = { addEventListener() {} };
  const status = { textContent: '', className: '' };
  const builtInOption = { value: 'Microsoft YaHei', textContent: '微软雅黑（默认）' };
  const select = {
    value: 'Microsoft YaHei',
    children: [],
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector !== 'optgroup[data-local-fonts="true"]') return null;
      return this.children.find((child) => child.dataset?.localFonts === 'true') || null;
    },
    get options() {
      return [builtInOption, ...this.children.flatMap((child) => child.children || [])];
    }
  };
  const button = {
    disabled: false,
    attributes: new Map(),
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    }
  };
  const elements = new Map([
    ['desktopLyricForm', form],
    ['desktopLyricFontFamily', select],
    ['desktopLyricLoadLocalFontsBtn', button],
    ['desktopLyricLocalFontStatus', status]
  ]);
  function createNode(tagName) {
    return {
      tagName: tagName.toUpperCase(),
      children: [],
      dataset: {},
      value: '',
      textContent: '',
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
      }
    };
  }

  let queryCount = 0;
  let denyPermission = false;
  const sandbox = {
    console: { ...console, warn() {} },
    document: {
      getElementById(id) { return elements.get(id) || null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement: createNode
    },
    setTimeout,
    clearTimeout,
    window: {
      addEventListener() {},
      async queryLocalFonts() {
        queryCount += 1;
        if (denyPermission) {
          const error = new Error('Permission denied');
          error.name = 'NotAllowedError';
          throw error;
        }
        return [
          { family: 'Arial' },
          { family: 'Arial' },
          { family: ' 宋体 ' },
          { family: 'Cascadia Code' },
          { family: '' }
        ];
      },
      AdminApp: {
        utils: { setValue() {}, api: async () => ({ ok: true }) },
        forms: { bindRangePair() {} },
        desktopLyricPreview: { init() {}, applySettings() {} }
      }
    }
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.desktopLyric.initDesktopLyricForm();
  await listeners.get('click')();

  assert.equal(queryCount, 1);
  const localGroup = select.querySelector('optgroup[data-local-fonts="true"]');
  assert.equal(localGroup.label, '本机字体');
  assert.deepEqual(localGroup.children.map((option) => option.textContent), ['Arial', 'Cascadia Code', '宋体']);
  assert.deepEqual(localGroup.children.map((option) => option.value), ['"Arial"', '"Cascadia Code"', '"宋体"']);
  assert.equal(select.value, 'Microsoft YaHei');
  assert.equal(button.disabled, false);
  assert.equal(button.attributes.has('aria-busy'), false);
  assert.equal(status.textContent, '已读取 3 个本机字体');

  await listeners.get('click')();
  assert.equal(queryCount, 2);
  assert.equal(select.querySelector('optgroup[data-local-fonts="true"]').children.length, 3);

  denyPermission = true;
  await listeners.get('click')();
  assert.equal(queryCount, 3);
  assert.equal(select.querySelector('optgroup[data-local-fonts="true"]').children.length, 3);
  assert.equal(status.textContent, '未获得本机字体读取权限');
});

test('desktop lyric settings include a live word-timed preview', () => {
  const html = readAdminHtml();
  const settingsSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric-preview.js'), 'utf8');
  const sharedRenderer = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-word-renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'desktop-lyric-preview.css'), 'utf8');
  const workspaceStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace', 'song.css'), 'utf8');

  assert.match(html, /class="desktop-lyric-workspace"/);
  assert.match(html, /class="[^"]*desktop-lyric-settings-fields[^"]*"/);
  assert.match(html, /id="desktopLyricAutosaveState"/);
  assert.ok(html.indexOf('id="desktopLyricForm"') < html.indexOf('id="desktopLyricLivePreview"'));
  assert.doesNotMatch(html, /保存桌面歌词设置/);
  assert.match(html, /id="desktopLyricLivePreview"/);
  assert.match(html, /id="desktopLyricPreviewViewport"[^>]*tabindex="0"/);
  assert.match(html, /id="desktopLyricPreviewTimeline"/);
  assert.match(html, /id="desktopLyricPreviewPlayback"[^>]*aria-live="polite"/);
  assert.match(html, /id="desktopLyricPreviewProgress"/);
  assert.match(html, /id="desktopLyricCopyUrlBtn"[^>]*>复制桌面歌词</);
  assert.match(html, /data-lyric-preview-background="grid"/);
  assert.match(source, /new LyricWordRenderer/);
  assert.match(source, /app:lyric-state/);
  assert.match(source, /app:lyric-timeline/);
  assert.match(source, /createElement\('div'\)/);
  assert.match(source, /latestTimeline\.lines\.forEach/);
  assert.match(source, /`歌词已载入 · \$\{lineCount\} 行`/);
  assert.match(source, /textContent\s*=/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.match(source, /import \{ copyText, localOverlayOrigin \} from '\.\.\/shared\/utils\.js';/);
  assert.match(source, /await copyText\(desktopLyricUrl\)/);
  assert.doesNotMatch(source, /navigator\.clipboard\.writeText\(desktopLyricUrl\)/);
  assert.match(source, /`\$\{localOverlayOrigin\(location\)\}\/lyrics`/);
  assert.match(source, /桌面歌词地址已复制/);
  assert.doesNotMatch(source, /musicAPI\.openLyricWindow|desktopLyricOpenWindowBtn/);
  assert.match(source, /desktopLyricFontFamily/);
  assert.match(source, /style\.setProperty/);
  assert.match(source, /desktopLyricTimeOffsetMs/);
  assert.match(source, /desktopLyricHideOnPause/);
  assert.match(source, /desktopLyricBackgroundRenderer/);
  assert.match(sharedRenderer, /element\.textContent = word\.text/);
  assert.match(sharedRenderer, /requestAnimationFrame/);
  assert.match(styles, /--preview-word-progress/);
  assert.match(styles, /\.desktop-lyric-preview-stage\.is-solid/);
  assert.match(styles, /height:\s*clamp\(520px,\s*calc\(100vh - 210px\),\s*760px\)/);
  assert.match(workspaceStyles, /\.song-workspace[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.desktop-lyric-settings\s*\{[^}]*max-height:\s*clamp\(580px,\s*calc\(100vh - 145px\),\s*820px\)[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.desktop-lyric-settings\s*\{[^}]*overscroll-behavior-y:\s*contain[^}]*scrollbar-color:\s*rgba\(217, 75, 112, 0\.58\) transparent/);
  assert.match(styles, /\.desktop-lyric-settings:hover,[\s\S]*?\.desktop-lyric-settings:focus-within\s*\{[^}]*scrollbar-color:\s*#d94b70 transparent/);
  assert.match(styles, /\.desktop-lyric-settings::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/);
  assert.match(styles, /\.desktop-lyric-settings::-webkit-scrollbar-thumb\s*\{[^}]*border:\s*4px solid transparent[^}]*background:\s*rgba\(217, 75, 112, 0\.58\)/);
  assert.match(styles, /\.desktop-lyric-preview-viewport[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /@media \(max-width:\s*980px\)[\s\S]*?\.desktop-lyric-settings\s*\{[^}]*max-height:\s*none[^}]*overflow:\s*visible/);
  assert.match(styles, /\.desktop-lyric-preview-row\.is-active/);
  assert.match(styles, /\.desktop-lyric-preview-countdown-dot/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /requestAnimationFrame\(animateLyricFollow\)/);
  assert.match(source, /stepSpringScroll/);
  assert.match(source, /MANUAL_FOLLOW_PAUSE_MS = 6000/);
  assert.match(source, /addEventListener\('pointerdown', pauseAutomaticFollow/);
  assert.doesNotMatch(source, /behavior:\s*['"]smooth['"]/);
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.match(styles, /mask-image:\s*linear-gradient\(to bottom/);
  assert.match(styles, /\.desktop-lyric-preview-viewport\.is-following/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-translation-hidden/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-hide-passed/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-paused-hidden/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-background-enabled/);
  assert.match(styles, /--preview-global-opacity/);
  assert.match(styles, /scale\(1\.02\)/);
  assert.match(styles, /grid-template-columns:\s*minmax\(460px, 1fr\) minmax\(320px, 720px\)/);
  assert.match(styles, /\.desktop-lyric-preview-card\s*\{[^}]*max-width:\s*720px/);
  assert.match(styles, /container-name:\s*admin-lyric-preview/);
  assert.match(styles, /font-size:\s*min\(var\(--preview-size\), 8\.5cqi\)/);
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
  const resetListeners = new Map();
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
    desktopLyricTranslationScale: '0.65',
    desktopLyricTextAlign: 'justify'
  };
  const elements = new Map(Object.entries(values).map(([id, value]) => [id, { value }]));
  const lyricSourceInputs = [
    { value: 'netease', checked: true },
    { value: 'qq', checked: false }
  ];
  const textAlignInputs = [
    { value: 'left', checked: false },
    { value: 'center', checked: false },
    { value: 'right', checked: false },
    { value: 'justify', checked: true }
  ];
  const smartLyricMatch = { checked: true };
  elements.set('desktopLyricForm', form);
  elements.set('desktopLyricAutosaveState', autosaveState);
  elements.set('weSingSmartLyricMatch', smartLyricMatch);
  elements.set('desktopLyricResetBtn', {
    addEventListener(type, handler) {
      resetListeners.set(type, handler);
    }
  });
  let scheduledTimer = null;
  let resolveFirstSave;
  const sandbox = {
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector(selector) {
        if (selector === 'input[name="weSingLyricSource"]:checked') {
          return lyricSourceInputs.find((input) => input.checked) || null;
        }
        if (selector === 'input[name="desktopLyricTextAlign"]:checked') {
          return textAlignInputs.find((input) => input.checked) || null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'input[name="weSingLyricSource"]') return lyricSourceInputs;
        if (selector === 'input[name="desktopLyricTextAlign"]') return textAlignInputs;
        return [];
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
          setValue: (id, value) => {
            const element = elements.get(id);
            if (element) element.value = value;
          },
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
  windowListeners.get('app:settings-state')({
    detail: {
      ...values,
      weSingLyricSource: 'netease',
      weSingSmartLyricMatch: 'true'
    }
  });
  assert.equal(scheduledTimer.delay, 500);
  scheduledTimer.callback();
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].body.weSingLyricSource, 'netease');
  assert.equal(apiCalls[0].body.weSingSmartLyricMatch, 'true');
  assert.equal(apiCalls[0].body.desktopLyricTextAlign, 'justify');

  windowListeners.get('app:settings-state')({
    detail: {
      ...values,
      weSingLyricSource: 'qq',
      weSingSmartLyricMatch: 'false'
    }
  });
  assert.equal(lyricSourceInputs[0].checked, false);
  assert.equal(lyricSourceInputs[1].checked, true);
  assert.equal(smartLyricMatch.checked, false);

  elements.get('desktopLyricFontSize').value = '64';
  listeners.get('change')();
  assert.equal(apiCalls.length, 1, 'a second write waits for the in-flight request');
  resolveFirstSave({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[0].url, '/api/settings');
  assert.equal(apiCalls[1].body.desktopLyricFontSize, '64');
  assert.equal(apiCalls[1].body.weSingLyricSource, 'qq');
  assert.equal(apiCalls[1].body.weSingSmartLyricMatch, 'false');
  assert.equal(autosaveState.textContent, '已自动保存');
  assert.match(autosaveState.className, /is-saved/);

  await new Promise((resolve) => setImmediate(resolve));
  resetListeners.get('click')();
  assert.equal(apiCalls.length, 3);
  assert.equal(apiCalls[2].body.desktopLyricFontSize, '56');
  assert.equal(apiCalls[2].body.weSingLyricSource, 'qq');
  assert.equal(apiCalls[2].body.weSingSmartLyricMatch, 'false');
});

test('playback publishes lyrics through the authenticated local API', () => {
  const service = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'),
    'utf8'
  );
  const routes = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server', 'routes', 'playback-routes.js'), 'utf8');

  assert.match(service, /fetch\('\/api\/playback\/lyric-state'/);
  assert.match(service, /fetch\('\/api\/playback\/lyric-timeline'/);
  assert.match(service, /status:\s*!track \? 'idle'/);
  assert.match(service, /durationMs:\s*Math\.round\(duration \* 1000\)/);
  assert.match(routes, /'POST \/api\/playback\/lyric-state'/);
  assert.match(routes, /'POST \/api\/playback\/lyric-timeline'/);
  assert.match(routes, /normalizeLyricState/);
  assert.match(routes, /normalizeLyricTimeline/);
});

test('playback publishes a complete timeline only when the lyric identity changes', async () => {
  const requests = [];
  const playback = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'),
    {
      fetch: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return { ok: true };
      }
    }
  );
  const service = new playback.LyricService();
  const track = {
    id: 'qq:timeline-song',
    source: 'qq',
    title: 'Timeline Song',
    artists: ['Timeline Artist'],
    lyrics: { lines: [{ startMs: 0, text: '制作：Timeline Studio' }] }
  };
  const audio = { currentTime: 1, duration: 120, paused: false };

  await service.syncWindow(track, audio);
  await service.syncWindow(track, audio);
  track.lyrics = { lines: [{ startMs: 0, text: '制作：Timeline Studio' }] };
  await service.syncWindow(track, audio);

  const timelineRequests = requests.filter((request) => request.url === '/api/playback/lyric-timeline');
  assert.equal(timelineRequests.length, 2);
  assert.equal(timelineRequests[0].body.lines[0].text, '制作：Timeline Studio');
});

test('forced playback states bypass throttling and preserve publication order', async () => {
  const stateRequests = [];
  let releaseFirstState;
  const playback = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'),
    {
      fetch: async (url, options) => {
        if (url === '/api/playback/lyric-timeline') return { ok: true };
        stateRequests.push(JSON.parse(options.body));
        if (stateRequests.length === 1) {
          return new Promise((resolve) => {
            releaseFirstState = () => resolve({ ok: true });
          });
        }
        return { ok: true };
      }
    }
  );
  const service = new playback.LyricService();
  const track = {
    id: 'qq:controlled-song',
    source: 'qq',
    title: 'Controlled Song',
    artists: ['Controlled Artist'],
    lyrics: { lines: [{ startMs: 0, text: '第一句' }, { startMs: 42000, text: '跳转后' }] }
  };
  const audio = { currentTime: 1, duration: 120, paused: false };

  const playingPublish = service.syncWindow(track, audio, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stateRequests.length, 1);

  audio.currentTime = 42;
  audio.paused = true;
  const seekAndPausePublish = service.syncWindow(track, audio, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stateRequests.length, 1, 'newer state waits until the prior request finishes');

  releaseFirstState();
  await Promise.all([playingPublish, seekAndPausePublish]);
  assert.equal(stateRequests.length, 2);
  assert.equal(stateRequests[0].playing, true);
  assert.equal(stateRequests[0].currentMs, 1000);
  assert.equal(stateRequests[1].playing, false);
  assert.equal(stateRequests[1].currentMs, 42000);
  assert.equal(stateRequests[1].lineText, '跳转后');
});

test('lyric states carry monotonic generation and sequence discontinuity markers', () => {
  const first = normalizeLyricState({ lineText: 'first', generation: 3, sequence: 7 });
  const legacy = normalizeLyricState({ lineText: 'legacy' });
  assert.equal(first.generation, 3);
  assert.equal(first.sequence, 7);
  assert.equal(legacy.generation, 0);
  assert.equal(legacy.sequence, 0);
});

test('ordinary lyric publication is latest-wins while one request is in flight', async () => {
  const requests = [];
  let releaseFirst;
  const playback = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'),
    {
      fetch: async (url, options) => {
        if (url === '/api/playback/lyric-timeline') return { ok: true };
        requests.push(JSON.parse(options.body));
        if (requests.length === 1) {
          return new Promise((resolve) => { releaseFirst = () => resolve({ ok: true }); });
        }
        return { ok: true };
      }
    }
  );
  const service = new playback.LyricService();
  const track = {
    id: 'latest-wins', source: 'qq', title: 'Latest', artists: [],
    lyrics: { lines: [{ startMs: 0, text: 'line' }] }
  };
  const audio = { currentTime: 1, duration: 120, paused: false };
  const first = service.syncWindow(track, audio);
  audio.currentTime = 2;
  const second = service.syncWindow(track, audio);
  audio.currentTime = 3;
  const third = service.syncWindow(track, audio);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  releaseFirst();
  await Promise.all([first, second, third]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].currentMs, 3000);
  assert.ok(requests[1].sequence > requests[0].sequence);
});

test('lyric scheduler uses rAF time gating and performance profile degrades with hysteresis', async () => {
  const schedulerSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-frame-scheduler.js'),
    'utf8'
  );
  assert.match(schedulerSource, /requestAnimationFrame/);
  assert.match(schedulerSource, /1000 \/ this\.targetFps/);
  assert.doesNotMatch(schedulerSource, /setInterval/);

  const performanceModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-performance.js'),
    { window: { matchMedia: () => ({ matches: false }) } }
  );
  const profile = performanceModule.createLyricPerformanceProfile({});
  for (let index = 0; index < 4; index += 1) profile.recordFrame(60);
  assert.equal(profile.profile.targetFps, 30);
  assert.equal(profile.profile.wordAnimation, 'manual');
  profile.setVisible(false);
  assert.equal(profile.profile.targetFps, 30);
});

test('shared lyric renderer freezes its clock when playback pauses', async () => {
  let currentTime = 1000;
  let nextFrameId = 0;
  const scheduledFrames = new Map();
  const canceledFrames = new Set();
  const lineElement = {
    textContent: '',
    replaceChildren() {},
    appendChild() {}
  };
  const progressElement = { style: { transform: '' } };
  const rendererModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-word-renderer.js'),
    {
      document: {
        createElement() {
          return {
            className: '',
            textContent: '',
            style: { setProperty() {} }
          };
        }
      },
      performance: { now: () => currentTime },
      requestAnimationFrame(callback) {
        nextFrameId += 1;
        scheduledFrames.set(nextFrameId, callback);
        return nextFrameId;
      },
      cancelAnimationFrame(frameId) {
        canceledFrames.add(frameId);
      }
    }
  );
  const renderer = new rendererModule.LyricWordRenderer({ lineElement, progressElement });

  renderer.setState({ currentMs: 1000, durationMs: 10000, playing: true, lineText: '播放中' });
  const playingFrameId = nextFrameId;
  currentTime = 1500;
  scheduledFrames.get(playingFrameId)(currentTime);
  const pendingFrameId = nextFrameId;
  assert.equal(renderer.getPosition(currentTime).currentMs, 1500);

  renderer.setState({ currentMs: 1200, durationMs: 10000, playing: false, lineText: '已暂停' });
  assert.equal(canceledFrames.has(pendingFrameId), true);
  assert.equal(nextFrameId, pendingFrameId, 'paused rendering does not schedule another animation frame');
  assert.equal(renderer.getPosition(5000).currentMs, 1200);
});

test('shared lyric renderer accepts small backward authoritative corrections', async () => {
  let currentTime = 1000;
  const rendererModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-word-renderer.js'),
    {
      document: { createElement() { return {}; } },
      performance: { now: () => currentTime },
      requestAnimationFrame() { return 0; },
      cancelAnimationFrame() {}
    }
  );
  const renderer = new rendererModule.LyricWordRenderer();

  renderer.setState({ currentMs: 1000, durationMs: 10000, playing: true });
  currentTime = 1300;
  assert.equal(renderer.getPosition(currentTime).currentMs, 1300);

  renderer.setState({ currentMs: 1100, durationMs: 10000, playing: true });
  assert.equal(renderer.getPosition(currentTime).currentMs, 1100);

  const overlaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'lyric-window.js'),
    'utf8'
  );
  assert.doesNotMatch(overlaySource, /Math\.max\(incoming, estimated\)/);
});

test('built-in playback forces lyric sync for play, pause, and seek transitions', () => {
  const initializer = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'core', 'initializer.js'),
    'utf8'
  );
  const handlers = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'core', 'event-handlers.js'),
    'utf8'
  );

  assert.match(initializer, /addEventListener\('play', \(\) => \{[^}]*syncPlaybackLyricWindow\(true\)[^}]*\}\);/);
  assert.match(initializer, /addEventListener\('pause', \(\) => \{[^}]*syncPlaybackLyricWindow\(true\)[^}]*\}\);/);
  assert.match(initializer, /addEventListener\('seeking', \(\) => \{[^}]*syncPlaybackLyricWindow\(true\)[^}]*\}\);/);
  assert.match(initializer, /addEventListener\('seeked', \(\) => \{[^}]*syncPlaybackLyricWindow\(true\)[^}]*\}\);/);
  assert.match(handlers, /getElementById\('playbackSeek'\)[\s\S]*?syncPlaybackLyricWindow\(true\)/);
});

test('desktop lyric timeline identifies active lines and countdowns for long gaps', async () => {
  const preview = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric-preview.js')
  );
  const lines = [
    { startMs: 0, text: '出品：骁Studio' },
    { startMs: 9000, text: '请原谅我的词穷' },
    { startMs: 12000, text: '再见都哽在喉咙' }
  ];

  assert.equal(preview.findActiveLyricIndex(lines, 500), 0);
  assert.equal(preview.findActiveLyricIndex(lines, 9500), 1);
  assert.deepEqual(
    { ...preview.getLyricCountdown(lines, 0, 6200) },
    { nextIndex: 1, seconds: 3 }
  );
  assert.deepEqual(
    { ...preview.getLyricCountdown(lines, 0, 7200) },
    { nextIndex: 1, seconds: 2 }
  );
  assert.equal(preview.getLyricCountdown(lines, 0, 4000), null);
  assert.equal(preview.getLyricCountdown(lines, 1, 9500), null);
});

test('desktop lyric timeline spring converges smoothly on the active-line anchor', async () => {
  const preview = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric-preview.js')
  );
  let frame = { position: 0, velocity: 0 };

  frame = preview.stepSpringScroll(frame.position, frame.velocity, 500, 16);
  assert.ok(frame.position > 0 && frame.position < 500);

  for (let index = 0; index < 180; index += 1) {
    frame = preview.stepSpringScroll(frame.position, frame.velocity, 500, 16);
  }

  assert.equal(frame.position, 500);
  assert.equal(frame.velocity, 0);
});

test('desktop lyric renderer normalizes timing, empty text, and anchor settings', async () => {
  const preview = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric-preview.js')
  );
  const settings = preview.resolveDesktopLyricSettings({
    desktopLyricTimeOffsetMs: '350',
    desktopLyricShowTitleWhenNoLyric: 'true',
    desktopLyricNoLyricText: '没有歌词',
    desktopLyricHideOnPause: 'true',
    desktopLyricAlignPosition: '0.25',
    desktopLyricAlignAnchor: 'end'
  });

  assert.equal(settings.timeOffsetMs, 350);
  assert.equal(settings.showTitleWhenNoLyric, true);
  assert.equal(settings.hideOnPause, true);
  assert.equal(settings.alignPosition, 0.25);
  assert.equal(settings.alignAnchor, 'end');
  assert.equal(preview.resolveLyricTime(1000, settings), 1350);
  assert.equal(preview.resolveNoLyricText({ trackTitle: '测试歌曲' }, settings), '测试歌曲');
  assert.equal(
    preview.calculateFollowTarget(600, 100, 400, 1200, settings.alignPosition, settings.alignAnchor),
    600
  );

  const fallbackSettings = preview.resolveDesktopLyricSettings({
    desktopLyricShowTitleWhenNoLyric: 'false',
    desktopLyricNoLyricText: '纯音乐'
  });
  assert.equal(preview.resolveNoLyricText({ trackTitle: '测试歌曲' }, fallbackSettings), '纯音乐');
});

test('desktop lyric visible-line window keeps full timeline semantics', async () => {
  const preview = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric-preview.js')
  );

  const range = (activeLine, visibleLines, lineCount) => JSON.parse(JSON.stringify(
    preview.getVisibleLyricRange(activeLine, visibleLines, lineCount)
  ));
  assert.deepEqual(range(4, 0, 9), { first: 0, last: 8 });
  assert.deepEqual(range(4, 1, 9), { first: 4, last: 4 });
  assert.deepEqual(range(4, 2, 9), { first: 4, last: 5 });
  assert.deepEqual(range(4, 3, 9), { first: 3, last: 5 });
  assert.deepEqual(range(4, 4, 9), { first: 3, last: 6 });
  assert.deepEqual(range(0, 5, 3), { first: 0, last: 2 });
  assert.deepEqual(range(8, 5, 9), { first: 6, last: 8 });

  const settings = preview.resolveDesktopLyricSettings({ desktopLyricVisibleLines: '-2' });
  assert.equal(settings.visibleLines, 0);
});

async function loadModuleExports(entryPath, globals = {}) {
  const context = vm.createContext({ console, window: {}, ...globals });
  const modules = new Map();

  async function load(filePath) {
    const identifier = pathToFileURL(filePath).href;
    if (modules.has(identifier)) return modules.get(identifier);
    const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
      context,
      identifier
    });
    modules.set(identifier, module);
    await module.link((specifier, referencingModule) => {
      const dependencyUrl = new URL(specifier, referencingModule.identifier);
      return load(fileURLToPath(dependencyUrl));
    });
    return module;
  }

  const module = await load(entryPath);
  await module.evaluate();
  return module.namespace;
}
