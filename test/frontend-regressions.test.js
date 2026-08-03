'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');

const ROOT_DIR = path.join(__dirname, '..');

test('admin page uses one ordered module entrypoint', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');

  assert.match(html, /<script type="module" src="\/js\/admin\/index\.js\?v=[^"]+"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src="\/js\/admin\/queue\.js/);

  const giftModulePaths = [
    './gifts/notification.js',
    './gifts/detection.js',
    './gifts/sprint.js',
    './gifts/recent.js',
    './gifts/blindbox.js',
    './gifts/history.js'
  ];
  const giftIndexPosition = entrySource.indexOf("import './gifts/index.js';");
  assert.ok(giftIndexPosition > -1, 'gift index import should remain present');
  for (const modulePath of giftModulePaths) {
    const modulePosition = entrySource.indexOf(`import '${modulePath}';`);
    assert.ok(modulePosition > -1, `${modulePath} import should remain present`);
    assert.ok(modulePosition < giftIndexPosition, `${modulePath} should load before the gift index`);
  }

  const importLines = entrySource.match(/^import .+;$/gm) ?? [];
  assert.equal(importLines.at(-1), "import './app.js';");
});

test('admin overlay links do not retain the old fixed port placeholder', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const displaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'),
    'utf8'
  );
  const settingsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings.js'),
    'utf8'
  );

  assert.doesNotMatch(html, /localhost:3000\/blindbox/);
  assert.doesNotMatch(displaySource, /localhost:3000/);
  assert.doesNotMatch(settingsSource, /localhost:3000/);
  assert.match(displaySource, /location\.origin/);
  assert.match(settingsSource, /location\.host/);
});

test('toolbox owns performance and desktop update as independent features', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'), 'utf8');
  const tabStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'tabs.css'), 'utf8');
  const featureStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features.css'),
    'utf8'
  );
  const managementTabs = html.match(/<div class="tabs" role="tablist">([\s\S]*?)<\/div>/)?.[1];
  const directTabRule = tabStyles.match(/\.tabs > \.tab\s*\{[\s\S]*?\n\}/)?.[0];
  const performancePosition = html.indexOf('data-other-feature="otherPerformanceFeature"');
  const updatePosition = html.indexOf('data-other-feature="otherDesktopUpdateFeature"');

  assert.doesNotMatch(html, /data-tab="performancePage"/);
  assert.doesNotMatch(html, /id="performancePage"/);
  assert.match(html, /data-main-page="otherAssistantPage"[\s\S]*?<span>百宝箱<\/span>/);
  assert.ok(managementTabs, 'song management tabs should remain present');
  assert.equal(managementTabs.match(/data-tab=/g)?.length, 7);
  assert.doesNotMatch(managementTabs, /<details|更多|desktopUpdate/);
  assert.ok(directTabRule, 'direct tab sizing should remain defined');
  assert.match(directTabRule, /flex:\s*1 1 0/);
  assert.match(directTabRule, /min-width:\s*0/);
  assert.doesNotMatch(tabStyles, /tab-overflow/);
  assert.match(html, /data-other-feature="otherPerformanceFeature"/);
  assert.match(html, /id="otherPerformanceFeature"[^>]+data-other-feature-panel/);
  assert.match(html, /id="otherDesktopUpdateFeature"[^>]+data-other-feature-panel/);
  assert.ok(updatePosition > performancePosition, 'desktop update should follow performance in the toolbox');
  assert.equal(html.match(/id="metricsToggle"/g)?.length, 1);
  assert.equal(html.match(/id="desktopCheckUpdateBtn"/g)?.length, 1);
  assert.match(styles, /@import url\('\.\/admin\/other-features\.css'\);/);
  assert.match(
    featureStyles,
    /\.other-feature-panel-body\.stack\s*\{[^}]*grid-auto-rows:\s*max-content;/
  );
});

test('other feature navigation selects panels without feature-specific dependencies', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'), 'utf8');
  const createNode = ({ id = '', feature = '', hidden = false } = {}) => {
    const classes = new Set();
    const attributes = new Map();
    const listeners = new Map();
    return {
      id,
      dataset: feature ? { otherFeature: feature } : {},
      hidden,
      tabIndex: -1,
      focused: false,
      classList: {
        contains(name) { return classes.has(name); },
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        }
      },
      addEventListener(name, listener) { listeners.set(name, listener); },
      dispatch(name, event) { listeners.get(name)?.(event); },
      focus() { this.focused = true; },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); }
    };
  };
  const buttons = [
    createNode({ feature: 'performanceFeature' }),
    createNode({ feature: 'diagnosticsFeature' }),
    createNode({ feature: 'desktopFeature', hidden: true })
  ];
  const panels = [
    createNode({ id: 'performanceFeature' }),
    createNode({ id: 'diagnosticsFeature' }),
    createNode({ id: 'desktopFeature', hidden: true })
  ];
  const root = {
    querySelectorAll(selector) {
      return selector === '[data-other-feature]' ? buttons : panels;
    }
  };
  const sandbox = {
    console,
    document: { getElementById: () => root },
    window: { AdminApp: {} }
  };

  vm.runInNewContext(source, sandbox);
  const selected = sandbox.window.AdminApp.other.selectFeature(root, 'diagnosticsFeature');

  assert.equal(selected, true);
  assert.equal(buttons[0].classList.contains('active'), false);
  assert.equal(buttons[0].getAttribute('aria-selected'), 'false');
  assert.equal(buttons[0].tabIndex, -1);
  assert.equal(buttons[1].classList.contains('active'), true);
  assert.equal(buttons[1].getAttribute('aria-selected'), 'true');
  assert.equal(buttons[1].tabIndex, 0);
  assert.equal(panels[0].hidden, true);
  assert.equal(panels[1].hidden, false);

  sandbox.window.AdminApp.other.initOtherPage();
  let prevented = false;
  buttons[1].dispatch('keydown', {
    key: 'ArrowUp',
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(buttons[0].focused, true);
  assert.equal(panels[0].hidden, false);
  assert.equal(panels[1].hidden, true);

  sandbox.window.AdminApp.other.selectFeature(root, 'desktopFeature');
  assert.equal(buttons[0].classList.contains('active'), true);
  assert.equal(buttons[2].classList.contains('active'), false);
  assert.equal(panels[2].hidden, true);
});

test('desktop update opens its toolbox feature through module APIs', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'desktop.js'), 'utf8');
  let showUpdatePage;
  let selectedPage = '';
  let selectedFeature = '';
  const sandbox = {
    console,
    document: {
      body: { classList: { add() {} } },
      getElementById: () => null,
      querySelectorAll: () => []
    },
    window: {
      AdminApp: {
        utils: {
          toast() {},
          showStackedToast() {},
          showError() {},
          api: async () => ({})
        },
        navigation: { setMainPage(pageId) { selectedPage = pageId; } },
        other: { selectFeatureById(featureId) { selectedFeature = featureId; } }
      },
      songAssistantDesktop: {
        onShowUpdatePage(callback) { showUpdatePage = callback; },
        onUpdateState() {},
        getInfo: () => new Promise(() => {})
      }
    }
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.desktop.initDesktopShell();
  showUpdatePage();

  assert.equal(selectedPage, 'otherAssistantPage');
  assert.equal(selectedFeature, 'otherDesktopUpdateFeature');
});

test('desktop lyric address is available from the live screen tab', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const displaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'),
    'utf8'
  );

  assert.match(html, /id="lyricsUrl"/);
  assert.doesNotMatch(html, /playbackLyricBtn|playbackLyricLockBtn/);
  assert.match(displaySource, /lyricsUrl.*`\$\{origin\}\/lyrics`/);
});

test('song board defaults to a clear frosted glass theme', () => {
  const themeSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');

  assert.match(defaultsSource, /themeOpacity: '0\.48'/);
  assert.match(defaultsSource, /backdropBlur: '14'/);
  assert.match(defaultsSource, /glowIntensity: '2'/);
  assert.match(themeSource, /themeOpacity: '0\.48'/);
  assert.match(themeSource, /backdropBlur: '14'/);
  assert.match(themeSource, /glowIntensity: '2'/);
  assert.match(themeSource, /bindRangePair\('backdropBlur', 'backdropBlurNumber', 0, 30, 14\)/);
  assert.match(themeSource, /bindRangePair\('glowIntensity', 'glowIntensityNumber', 0, 20, 2\)/);
});

test('gift workspace rows keep their content height inside the scroll container', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const giftWorkspaceRule = source.match(/\.gift-workspace\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(giftWorkspaceRule, 'gift workspace styles should remain defined');
  assert.match(giftWorkspaceRule, /grid-template-rows:\s*repeat\(5, max-content\)/);
});

test('song workspace scrolls within the viewport above the player dock', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const songWorkspaceRule = source.match(/\.song-workspace\s*\{[\s\S]*?\n\}/)?.[0];
  const expandedRule = source.match(/body\.player-dock-expanded \.song-workspace\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(songWorkspaceRule, 'song workspace styles should remain defined');
  assert.ok(expandedRule, 'expanded player sizing should remain defined');
  assert.match(songWorkspaceRule, /height:\s*calc\(100vh - 58px - 96px\)/);
  assert.match(songWorkspaceRule, /overflow-y:\s*auto/);
  assert.match(expandedRule, /height:\s*calc\(100vh - 58px - 218px\)/);
});

test('queue panels keep their full height without breaking the narrow layout', () => {
  const workspaceSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const responsiveSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'responsive.css'), 'utf8');
  const queueRowRule = workspaceSource.match(/\.queues-row\s*\{[\s\S]*?\n\}/)?.[0];
  const responsiveQueueRule = responsiveSource.match(/\.queues-row\s*\{[\s\S]*?\n\s*\}/)?.[0];

  assert.ok(queueRowRule, 'desktop queue row styles should remain defined');
  assert.ok(responsiveQueueRule, 'responsive queue row styles should remain defined');
  assert.match(queueRowRule, /flex:\s*0 0 450px/);
  assert.match(queueRowRule, /height:\s*450px/);
  assert.match(responsiveQueueRule, /flex:\s*0 0 auto/);
  assert.match(responsiveQueueRule, /height:\s*auto/);
});

test('admin queue wheel scrolls overflowing lists and releases the page at their edges', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'queue.js'), 'utf8');
  const makeTarget = () => ({
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
  });
  const superChatPanel = makeTarget();
  const queuePanel = makeTarget();
  const superChatList = {
    clientHeight: 100,
    scrollHeight: 100,
    scrollTop: 0,
    closest: () => superChatPanel
  };
  const queueList = {
    clientHeight: 100,
    scrollHeight: 100,
    scrollTop: 0,
    closest: () => queuePanel
  };
  const elements = {
    manualForm: makeTarget(),
    nextBtn: makeTarget(),
    clearBtn: makeTarget(),
    superChatList,
    queueList
  };
  const sandbox = {
    console,
    confirm: () => false,
    document: { getElementById: (id) => elements[id] || null },
    window: {
      AdminApp: {
        utils: {
          escapeHtml: String,
          escapeAttr: String,
          value: () => '',
          setValue() {},
          formatTime: String,
          formatSuperChatPrice: String,
          withMultilingualFallback: String,
          toast() {},
          api: async () => ({})
        }
      }
    }
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.queue.initQueueForm();
  const wheel = superChatPanel.listeners.get('wheel');
  const dispatchWheel = (deltaY) => {
    let prevented = false;
    wheel({ deltaY, deltaMode: 0, preventDefault() { prevented = true; } });
    return prevented;
  };

  assert.equal(dispatchWheel(120), false, 'a non-overflowing queue should leave page scrolling alone');
  superChatList.scrollHeight = 300;
  assert.equal(dispatchWheel(120), true, 'an overflowing queue should consume downward wheel input');
  assert.equal(superChatList.scrollTop, 36);
  superChatList.scrollTop = 200;
  assert.equal(dispatchWheel(120), false, 'the bottom edge should release downward input to the page');
  assert.equal(dispatchWheel(-120), true, 'the list should still consume input away from the bottom edge');
  superChatList.scrollTop = 0;
  assert.equal(dispatchWheel(-120), false, 'the top edge should release upward input to the page');
});

test('desktop admin keeps scrolling on the workspace instead of nesting it in tabs', () => {
  const workspaceSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const responsiveSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'responsive.css'), 'utf8');
  const activeTabRule = workspaceSource.match(/\.song-management-panel > \.tab-page\.active\s*\{[\s\S]*?\n\}/)?.[0];
  const desktopBodyRule = responsiveSource.match(/@media \(min-width: 901px\)[\s\S]*?body\s*\{[\s\S]*?\n\s*\}/)?.[0];
  const mobileBodyRule = responsiveSource.match(/@media \(max-width: 900px\)[\s\S]*?body\s*\{[\s\S]*?\n\s*\}/)?.[0];

  assert.ok(activeTabRule, 'active management tab styles should remain defined');
  assert.ok(desktopBodyRule, 'desktop body overflow rule should remain defined');
  assert.ok(mobileBodyRule, 'mobile body overflow rule should remain defined');
  assert.match(activeTabRule, /overflow:\s*visible/);
  assert.match(desktopBodyRule, /overflow:\s*hidden/);
  assert.match(mobileBodyRule, /overflow:\s*auto/);
});

test('hidden switches and the narrow player do not widen the page', () => {
  const adminSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'toasts.css'), 'utf8');
  const playbackSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'playback', 'responsive.css'), 'utf8');
  const switchInputRule = adminSource.match(/\.switch-control input\s*\{[\s\S]*?\n\}/)?.[0];
  const narrowPlayerRule = playbackSource.match(
    /@media \(max-width: 900px\)[\s\S]*?\.playback-progress-row\s*\{[\s\S]*?\n\s*\}/
  )?.[0];

  assert.ok(switchInputRule, 'switch input styles should remain defined');
  assert.ok(narrowPlayerRule, 'narrow player progress styles should remain defined');
  assert.match(switchInputRule, /width:\s*1px/);
  assert.match(switchInputRule, /height:\s*1px/);
  assert.match(narrowPlayerRule, /width:\s*auto/);
  assert.match(narrowPlayerRule, /padding-left:\s*0/);
});

test('playback labels scroll independently without resizing the progress slot', async () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'playback', 'player.css'), 'utf8');
  const nowPlayingRule = styles.match(/\.playback-now\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(nowPlayingRule, 'now-playing layout styles should remain defined');
  assert.match(nowPlayingRule, /grid-template-columns:\s*minmax\(0, 280px\) minmax\(520px, 1fr\)/);
  assert.match(html, /id="playbackTrackTitle" class="playback-marquee"/);
  assert.match(html, /id="playbackTrackArtist" class="playback-marquee"/);

  const { PlaybackBar } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'playback-bar.js')
  );
  const player = new PlaybackBar();
  const classes = new Set();
  let animationKeyframes = null;
  let animationOptions = null;
  let cancelled = false;
  const animation = { cancel() { cancelled = true; } };
  const textElement = {
    scrollWidth: 260,
    animate(keyframes, options) {
      animationKeyframes = keyframes;
      animationOptions = options;
      return animation;
    }
  };
  const element = {
    clientWidth: 100,
    querySelector() { return textElement; },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    }
  };

  player.updateMarquee(element);

  assert.equal(classes.has('is-scrolling'), true);
  assert.equal(animationKeyframes[0].transform, 'translateX(0)');
  assert.equal(animationKeyframes[2].transform, 'translateX(-160px)');
  assert.equal(animationKeyframes[3].transform, 'translateX(-160px)');
  assert.equal(animationKeyframes[4].transform, 'translateX(0)');
  assert.equal(
    Math.round((animationKeyframes[1].offset - animationKeyframes[0].offset) * animationOptions.duration),
    1000
  );
  assert.equal(
    Math.round((animationKeyframes[3].offset - animationKeyframes[2].offset) * animationOptions.duration),
    1000
  );

  element.clientWidth = 300;
  player.updateMarquee(element);
  assert.equal(cancelled, true);
  assert.equal(classes.has('is-scrolling'), false);
});

test('admin state events render queue empty states and song data', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'), 'utf8');

  assert.match(source, /eventBus\.on\(Events\.STATE_LOADED/);
  assert.match(source, /window\.AdminApp\.queue\.renderState\(state, songs\)/);
  assert.match(source, /eventBus\.on\(Events\.SONG_UPDATED/);
  assert.match(source, /window\.AdminApp\.songs\.renderSongs\(songs, languages, artists, tags\)/);
});

test('admin initialization waits for sibling module scripts at interactive ready state', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'), 'utf8');

  assert.match(source, /document\.readyState === 'complete'/);
  assert.match(source, /document\.addEventListener\('DOMContentLoaded', initApp, \{ once: true \}\)/);
});

test('admin loads theme presets before initializing theme forms', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'), 'utf8');
  const loadPosition = source.indexOf('await Theme.loadThemeConfig()');
  const themeFormPosition = source.indexOf('window.AdminApp.theme.initThemeForm()');
  const displayFormPosition = source.indexOf('window.AdminApp.display.initDisplayForm()');

  assert.ok(loadPosition >= 0, 'theme configuration should be loaded');
  assert.ok(loadPosition < themeFormPosition, 'theme presets should load before the theme form');
  assert.ok(loadPosition < displayFormPosition, 'theme presets should load before the display form');
});

test('early theme preset references receive asynchronously loaded data', async () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'data', 'theme-presets.json'),
    'utf8'
  ));
  const browserWindow = { AdminApp: {} };
  const themeModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'theme.js'),
    {
      window: browserWindow,
      fetch: async () => ({ ok: true, json: async () => config })
    }
  );
  const earlyClassicPresets = themeModule.getAllClassicPresets();
  const earlySongBoardPresets = themeModule.getAllSongBoardPresets();

  assert.deepEqual(Object.keys(earlyClassicPresets), []);
  await themeModule.loadThemeConfig();
  assert.equal(themeModule.getAllClassicPresets(), earlyClassicPresets);
  assert.equal(themeModule.getAllSongBoardPresets(), earlySongBoardPresets);
  assert.equal(Object.keys(earlyClassicPresets).length, 14);
  assert.equal(Object.keys(earlySongBoardPresets).length, 14);
});

test('shared theme compatibility keeps admin theme form methods', async () => {
  const initThemeForm = () => {};
  const browserWindow = { AdminApp: { theme: { initThemeForm } } };

  await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'theme.js'),
    { window: browserWindow }
  );

  assert.equal(browserWindow.AdminApp.theme.initThemeForm, initThemeForm);
  assert.equal(typeof browserWindow.AdminApp.theme.loadThemeConfig, 'function');
  const defaultThemeDescriptor = Object.getOwnPropertyDescriptor(
    browserWindow.AdminApp.theme,
    'defaultThemeLook'
  );
  assert.equal(typeof defaultThemeDescriptor.get, 'function');
});

test('debug gift data attributes escape quotes, apostrophes, and backticks', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'debug-gifts.html'), 'utf8');
  const escapeHtmlSource = source.match(/function escHtml\(s\) \{[\s\S]*?\n\}/)?.[0];
  const escapeAttrSource = source.match(/function escAttr\(s\) \{[\s\S]*?\n\}/)?.[0];

  assert.ok(escapeHtmlSource, 'escHtml should remain defined');
  assert.ok(escapeAttrSource, 'escAttr should be defined for data attributes');

  const sandbox = {
    document: {
      createElement() {
        let text = '';
        return {
          set textContent(value) { text = String(value); },
          get innerHTML() {
            return text
              .replaceAll('&', '&amp;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;');
          }
        };
      }
    }
  };
  vm.runInNewContext(`${escapeHtmlSource}\n${escapeAttrSource}`, sandbox);

  assert.equal(
    sandbox.escAttr('"quoted\' `value`'),
    '&quot;quoted&#39; &#96;value&#96;'
  );
});

test('fullscreen resets lyric mode before rendering a different track', async () => {
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js')
  );
  const player = new FullscreenPlayer();
  let renderedMode = '';

  player.fsEl = { classList: { contains: () => true } };
  player.lyricMode = 'trans';
  player._lastLyricTrackId = 'old-track';
  player.lyricTogglesEl = { style: {} };
  player.renderTrackInfo = () => {};
  player.renderArtwork = () => {};
  player.applyBackgroundTheme = () => {};
  player.updateVinylAnimation = () => {};
  player.renderLyrics = () => { renderedMode = player.lyricMode; };

  player.render({ id: 'new-track', lyrics: { lines: [] } }, { paused: false });

  assert.equal(renderedMode, 'none');
  assert.equal(player.lyricMode, 'none');
  assert.equal(player._lastLyricTrackId, 'new-track');
});

test('fullscreen lyric buttons follow available track data in romanization-first order', async () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const romaButtonPosition = html.indexOf('id="fsRomaToggleBtn"');
  const translationButtonPosition = html.indexOf('id="fsTranslationToggleBtn"');

  assert.ok(romaButtonPosition >= 0, 'romanization button should exist');
  assert.ok(translationButtonPosition >= 0, 'translation button should exist');
  assert.ok(romaButtonPosition < translationButtonPosition, 'romanization button should be above translation');

  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js')
  );
  const player = new FullscreenPlayer();
  player.lyricTogglesEl = { style: {} };
  player.romaToggleBtn = createLyricToggleButton();
  player.translationToggleBtn = createLyricToggleButton();

  player._updateLyricToggles({ lyrics: { lines: [{ roma: 'romaji' }] } });
  assert.equal(player.lyricTogglesEl.style.display, 'flex');
  assert.equal(player.romaToggleBtn.style.display, 'grid');
  assert.equal(player.translationToggleBtn.style.display, 'none');

  player._updateLyricToggles({ lyrics: { lines: [{ translation: '中文译' }] } });
  assert.equal(player.romaToggleBtn.style.display, 'none');
  assert.equal(player.translationToggleBtn.style.display, 'grid');

  player._updateLyricToggles({ lyrics: { lines: [{ roma: 'romaji', translation: '中文译' }] } });
  assert.equal(player.romaToggleBtn.style.display, 'grid');
  assert.equal(player.translationToggleBtn.style.display, 'grid');

  player._updateLyricToggles({ lyrics: { lines: [{ text: '原文' }] } });
  assert.equal(player.lyricTogglesEl.style.display, 'none');
  assert.equal(player.romaToggleBtn.style.display, 'none');
  assert.equal(player.translationToggleBtn.style.display, 'none');
});

test('fullscreen lyric buttons switch mutually exclusively and close the active mode', async () => {
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js')
  );
  const player = new FullscreenPlayer();
  let renderCount = 0;

  player.romaToggleBtn = createLyricToggleButton();
  player.translationToggleBtn = createLyricToggleButton();
  player._lastLyricLines = [{ text: '原文' }];
  player.renderLyricLines = () => { renderCount += 1; };

  player._toggleLyricMode('roma');
  assert.equal(player.lyricMode, 'roma');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), true);
  assert.equal(player.translationToggleBtn.classList.contains('mode-trans'), false);

  player._toggleLyricMode('trans');
  assert.equal(player.lyricMode, 'trans');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), false);
  assert.equal(player.translationToggleBtn.classList.contains('mode-trans'), true);

  player._toggleLyricMode('trans');
  assert.equal(player.lyricMode, 'none');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), false);
  assert.equal(player.translationToggleBtn.classList.contains('mode-trans'), false);
  assert.equal(renderCount, 3);
});

test('liked tracks continue past fifty full pages', async () => {
  let requestCount = 0;
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      async fetch(_url, options) {
        const { offset } = JSON.parse(options.body);
        requestCount += 1;
        const tracks = offset < 5100
          ? Array.from({ length: 100 }, (_, index) => ({ id: `track-${offset + index}` }))
          : [];
        return response({ ok: true, data: { tracks } });
      }
    }
  );
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    readJsonResponse: async (result) => result.payload
  });

  const result = await loader._fetchLikedTracksAll('Liked');

  assert.equal(result.items.length, 5100);
  assert.equal(requestCount, 52);
});

test('liked tracks stop when a provider repeats a full page', async () => {
  let requestCount = 0;
  const repeatedTracks = Array.from({ length: 100 }, (_, index) => ({ id: `track-${index}` }));
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      async fetch() {
        requestCount += 1;
        return response({ ok: true, data: { tracks: repeatedTracks } });
      }
    }
  );
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    readJsonResponse: async (result) => result.payload
  });

  const result = await loader._fetchLikedTracksAll('Liked');

  assert.equal(result.items.length, 100);
  assert.equal(requestCount, 2);
});

test('queue overlay applies rule sizing and scrolls only overflowing super chats', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) { callback(); },
    document: {
      addEventListener() {},
      documentElement: {
        style: { setProperty(name, value) { styleValues.set(name, value); } }
      }
    }
  };
  vm.runInNewContext(source, sandbox);

  sandbox.setIdentityRuleThemeVars(sandbox.document.documentElement, { overlayRuleFontSize: 12 });
  assert.equal(styleValues.get('--identity-rule-font-size'), '24px');

  let longAnimation = null;
  const longText = {
    scrollWidth: 300,
    animate(keyframes, options) { longAnimation = { keyframes, options }; }
  };
  const shortText = { scrollWidth: 90, animate() { assert.fail('short text must not animate'); } };
  const containers = [
    { clientWidth: 100, querySelector: () => longText },
    { clientWidth: 100, querySelector: () => shortText }
  ];

  sandbox.scheduleIdentitySuperChatScroll({ querySelectorAll: () => containers });
  assert.ok(longAnimation);
  assert.equal(longAnimation.keyframes[1].transform, 'translateX(-200px)');
  const pauseMilliseconds = (
    longAnimation.keyframes[2].offset - longAnimation.keyframes[1].offset
  ) * longAnimation.options.duration;
  assert.ok(Math.abs(pauseMilliseconds - 1500) < 0.001);

  const timing = sandbox.bounceScrollTiming(12);
  const verticalTopPauseSeconds = (
    timing.topPauseEndPercent / 100
  ) * timing.totalSeconds;
  const verticalPauseSeconds = (
    (timing.pauseEndPercent - timing.downPercent) / 100
  ) * timing.totalSeconds;
  assert.ok(Math.abs(verticalTopPauseSeconds - 1.5) < 0.000001);
  assert.ok(Math.abs(verticalPauseSeconds - 1.5) < 0.000001);
});

test('identity queue has an independent scroll speed setting', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const formSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');

  assert.match(html, /id="identityQueueScrollSpeedRange"/);
  assert.match(html, /id="identityQueueScrollSpeed"/);
  assert.match(formSource, /identityQueueScrollSpeed:/);
  assert.match(defaultsSource, /identityQueueScrollSpeed: '80'/);
});

test('identity queue has an independent shared content font size setting', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const formSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const formsSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'), 'utf8');
  const overlaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const overlayStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');

  assert.match(html, /id="identityQueueFontSize"[^>]*min="9"[^>]*max="78"[^>]*value="26"/);
  assert.match(html, /id="identityQueueFontSizeNumber"[^>]*min="9"[^>]*max="78"[^>]*value="26"/);
  assert.match(formSource, /identityQueueFontSize: value\('identityQueueFontSize'\)/);
  assert.match(formsSource, /identityQueueFontSize, 26, 78, 9/);
  assert.match(defaultsSource, /identityQueueFontSize: '26'/);
  assert.match(overlaySource, /--identity-queue-font-size.*identityQueueFontSize\(settings\)/);
  assert.match(overlayStyles, /\.identity-row\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*26px\)/);
  assert.match(overlayStyles, /\.identity-rank\s*\{[\s\S]*?font-size:\s*inherit/);
  assert.match(overlayStyles, /\.identity-requester\s*\{[\s\S]*?font-size:\s*inherit/);
});

test('identity song names scroll only when their rendered width overflows', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) { callback(); },
    document: { addEventListener() {} },
    window: {}
  };
  vm.runInNewContext(source, sandbox);

  let longAnimation = null;
  const longText = {
    scrollWidth: 300,
    animate(keyframes, options) { longAnimation = { keyframes, options }; }
  };
  const shortText = {
    scrollWidth: 90,
    animate() { assert.fail('fitting song text must not animate'); }
  };
  const containers = [
    { clientWidth: 100, querySelector: () => longText },
    { clientWidth: 100, querySelector: () => shortText }
  ];

  sandbox.scheduleIdentitySongScroll({ querySelectorAll: () => containers });

  assert.ok(longAnimation);
  assert.equal(longAnimation.keyframes[1].transform, 'translateX(-200px)');
  assert.doesNotMatch(sandbox.renderIdentityRow({ song_name: '1' }, 0), / • /);
});

test('song list exposes a display board font size control', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const displaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'), 'utf8');
  const overlaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  const overlayStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');
  const themePage = html.match(/<div id="themePage"[\s\S]*?<div id="displayPage"/)?.[0];

  assert.ok(themePage);
  assert.doesNotMatch(themePage, /songBoardFontSize/);
  assert.match(html, /id="displayPage"[\s\S]*id="songBoardFontSize"[^>]*min="10"[^>]*max="80"[^>]*value="50"/);
  assert.match(displaySource, /songBoardFontSize: value\('songBoardFontSize'\)/);
  assert.match(overlaySource, /Math\.max\(10, Math\.min\(80, Number\(settings\.songBoardFontSize\) \|\| 50\)\)/);
  assert.match(overlayStyles, /\.song-board \{[\s\S]*font-size: calc\(16px \* var\(--overlay-font-scale, 1\)\)/);
  assert.match(overlayStyles, /\.song-board \.overlay-content \{[\s\S]*padding: calc\(8px \* var\(--overlay-font-scale, 1\)\)/);
  assert.match(overlayStyles, /\.song-board \.overlay-title \{[\s\S]*var\(--overlay-title-font-size, 15px\) \* var\(--overlay-font-scale, 1\)/);
  assert.match(defaultsSource, /songBoardFontSize: '50'/);
});

test('overlay utility helpers preserve shared formatting behavior', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'overlay-utils.js'),
    'utf8'
  );
  const sandbox = {
    URLSearchParams,
    location: { search: '?quality=low' },
    window: {}
  };

  vm.runInNewContext(source, sandbox);
  const utils = sandbox.window.OverlayUtils;

  assert.equal(utils.escapeHtml('"quoted" & <tag>'), '&quot;quoted&quot; &amp; &lt;tag&gt;');
  const rgb = utils.hexToRgb('#abc');
  assert.equal(rgb.r, 170);
  assert.equal(rgb.g, 187);
  assert.equal(rgb.b, 204);
  assert.equal(utils.hexToRgba('#123456', 2), 'rgba(18, 52, 86, 1)');
  assert.equal(utils.withMultilingualFallback('Noto Sans'), 'Noto Sans, "Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif');
  assert.equal(utils.scrollTravelSeconds(12, 800, 300), 32);
  assert.equal(utils.overlayLowPowerEnabled({ overlayLowPowerMode: 'false' }), true);
});

test('identity rule text scrolls independently only when it overflows', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) { callback(); },
    document: { addEventListener() {} }
  };
  vm.runInNewContext(source, sandbox);

  let longAnimation = null;
  const longClasses = new Set();
  const longText = {
    scrollWidth: 220,
    animate(keyframes, options) { longAnimation = { keyframes, options }; }
  };
  const shortText = {
    scrollWidth: 90,
    animate() { assert.fail('short rule text must not animate'); }
  };
  const longContainer = {
    clientWidth: 100,
    querySelector: () => longText,
    classList: { add(name) { longClasses.add(name); } }
  };
  const shortContainer = {
    clientWidth: 100,
    querySelector: () => shortText,
    classList: { add() {} }
  };

  sandbox.scheduleIdentityRuleScroll({
    querySelectorAll: () => [longContainer, shortContainer]
  });

  assert.ok(longAnimation);
  assert.equal(longAnimation.keyframes[1].transform, 'translateX(-120px)');
  assert.ok(longClasses.has('is-scrolling'));
  const pauseMilliseconds = (
    longAnimation.keyframes[2].offset - longAnimation.keyframes[1].offset
  ) * longAnimation.options.duration;
  assert.ok(Math.abs(pauseMilliseconds - 1500) < 0.001);
});

test('classic queue uses calculated row height and sizes indexes with song text', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const waitingRule = source.match(/\.overlay-waiting\s*\{[\s\S]*?\n\}/)?.[0];
  const windowRule = source.match(/\.classic-list-window\s*\{[\s\S]*?\n\}/)?.[0];
  const indexRule = source.match(/\.overlay-waiting-row \.index\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(waitingRule, 'classic queue list styles should remain defined');
  assert.ok(windowRule, 'classic queue viewport styles should remain defined');
  assert.ok(indexRule, 'classic queue index styles should remain defined');
  assert.doesNotMatch(waitingRule, /--classic-row-height/);
  assert.doesNotMatch(windowRule, /--classic-row-height/);
  assert.match(indexRule, /font-size:\s*var\(--overlay-waiting-font-size,\s*13px\)/);
});

test('identity queue scrolls from actual overflow instead of a fixed row count', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: {
      addEventListener() {},
      getElementById() { return { textContent: '' }; },
      documentElement: {
        style: { setProperty(name, value) { styleValues.set(name, value); } }
      }
    }
  };
  vm.runInNewContext(source, sandbox);

  const classicContent = { innerHTML: '' };
  const classicSettings = {
    queueScrollMode: 'loop',
    queueScrollSpeed: '42',
    queueSongFontSize: '40'
  };
  sandbox.renderClassicQueue(
    classicSettings,
    { song_name: 'current' },
    Array.from({ length: 6 }, (_, index) => ({ song_name: `waiting-${index}` })),
    classicContent
  );
  assert.equal(styleValues.get('--classic-loop-distance'), '364px');
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds(classicSettings), 364, 307)}s`
  );

  const classes = new Set(['identity-list', 'paused']);
  let duplicatedHtml = '';
  const list = {
    scrollHeight: 500,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    },
    insertAdjacentHTML(_position, html) { duplicatedHtml += html; }
  };

  assert.equal(
    sandbox.configureIdentityVerticalScroll({ clientHeight: 300 }, list, {
      queueScrollMode: 'loop',
      queueScrollSpeed: '10',
      identityQueueScrollSpeed: '42'
    }, '<div>rows</div>', 4),
    true
  );
  assert.equal(styleValues.get('--identity-loop-distance'), '504px');
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds({ identityQueueScrollSpeed: '42' }, 'identityQueueScrollSpeed'), 504, 300)}s`
  );
  assert.equal(duplicatedHtml, '<div>rows</div>');
  assert.equal(classes.has('paused'), false);
  assert.equal(classes.has('scrolling'), true);

  const bounceClasses = new Set(['identity-list', 'paused']);
  const bounceList = {
    scrollHeight: 500,
    classList: {
      add(name) { bounceClasses.add(name); },
      remove(name) { bounceClasses.delete(name); }
    },
    insertAdjacentHTML() { assert.fail('bounce content must not be duplicated'); }
  };
  assert.equal(
    sandbox.configureIdentityVerticalScroll({ clientHeight: 300 }, bounceList, {
      queueScrollMode: 'bounce',
      queueScrollSpeed: '10',
      identityQueueScrollSpeed: '42'
    }, '<div>rows</div>', 4),
    true
  );
  assert.equal(styleValues.get('--identity-bounce-distance'), '200px');
  const bounceTiming = sandbox.bounceScrollTiming(
    sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds({ identityQueueScrollSpeed: '42' }, 'identityQueueScrollSpeed'), 200, 300),
    sandbox.scrollTravelSeconds(3, 200, 300)
  );
  assert.equal(styleValues.get('--scroll-seconds'), `${bounceTiming.totalSeconds}s`);
  assert.equal(bounceClasses.has('paused'), false);
  assert.equal(bounceClasses.has('scrolling-bounce'), true);

  const fittingList = {
    scrollHeight: 280,
    classList: { add() {}, remove() {} },
    insertAdjacentHTML() { assert.fail('fitting content must not be duplicated'); }
  };
  assert.equal(
    sandbox.configureIdentityVerticalScroll({ clientHeight: 300 }, fittingList, {}, '', 4),
    false
  );

  const shortDistance = 200;
  const longDistance = 800;
  const shortSeconds = sandbox.scrollTravelSeconds(12, shortDistance, 300);
  const longSeconds = sandbox.scrollTravelSeconds(12, longDistance, 300);
  assert.ok(Math.abs((shortDistance / shortSeconds) - (longDistance / longSeconds)) < 0.001);
});

test('song board scroll speed stays constant as content grows', () => {
  const adminHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const utilitySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'overlay-utils.js'),
    'utf8'
  );
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  assert.match(adminHtml, /id="scrollSecondsRange" type="range" min="1" max="100"/);
  assert.match(adminHtml, /id="scrollSeconds" type="number" min="1" max="100"/);
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    window: {},
    WebSocket: function WebSocket() {},
    document: {
      addEventListener() {},
      documentElement: {
        style: { setProperty(name, value) { styleValues.set(name, value); } }
      }
    }
  };
  vm.runInNewContext(utilitySource + '\n' + source, sandbox);

  assert.equal(sandbox.scrollSpeedToDuration(1), '20.557851');
  assert.equal(sandbox.scrollSpeedToDuration(100), '2.000000');
  assert.equal(sandbox.scrollSpeedToDuration(200), '2.000000');

  const rates = Array.from({ length: 100 }, (_, index) => index + 1).map((speed) => (
    1 / Number(sandbox.scrollSpeedToDuration(speed))
  ));
  const rateSteps = rates.slice(1).map((rate, index) => rate - rates[index]);
  assert.ok(rateSteps.every((step) => Math.abs(step - rateSteps[0]) < 0.000001));

  const classes = new Set(['song-scroll-list', 'paused']);
  let duplicatedHtml = '';
  const list = {
    scrollHeight: 600,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    },
    insertAdjacentHTML(_position, html) { duplicatedHtml += html; }
  };
  const settings = { scrollSeconds: '80' };

  assert.equal(sandbox.configureSongScroll({ clientHeight: 300 }, list, settings, '<div>songs</div>'), true);
  const loopDistance = 608;
  const travelSeconds = sandbox.scrollTravelSeconds(
    sandbox.scrollSpeedToDuration(80),
    loopDistance,
    300
  );
  assert.equal(styleValues.get('--song-loop-distance'), `${loopDistance}px`);
  assert.equal(styleValues.get('--scroll-seconds'), `${travelSeconds}s`);
  assert.equal(duplicatedHtml, '<div>songs</div>');
  assert.equal(classes.has('paused'), false);

  const longerDistance = loopDistance * 2;
  const longerSeconds = sandbox.scrollTravelSeconds(sandbox.scrollSpeedToDuration(80), longerDistance, 300);
  const shortRate = loopDistance / travelSeconds;
  const longRate = longerDistance / longerSeconds;
  assert.ok(Math.abs((shortRate - longRate) / shortRate) < 0.001);
});

test('only the latest playback search updates state and renders', async () => {
  const pending = new Map();
  const renderedIds = [];
  let keyword = 'old';
  const document = {
    getElementById() {
      return { textContent: '' };
    }
  };
  const { SearchService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'search-service.js'),
    {
      fetch(_url, options) {
        const request = JSON.parse(options.body);
        return new Promise((resolve) => pending.set(request.keyword, resolve));
      }
    }
  );
  const searchService = new SearchService({
    state: { selectedSource: 'test' },
    readJsonResponse: async (searchResponse) => searchResponse.payload
  });
  const { createSearchHandler } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'features', 'search-handler.js'),
    { document }
  );
  const handler = createSearchHandler({
    playbackState: {},
    searchService,
    value(id) {
      return id === 'playbackSearchKeyword' ? keyword : '9';
    },
    toast() {},
    renderPlaybackSearchResults() {
      renderedIds.push(searchService.getResults()[0]?.id ?? '');
    }
  });

  const oldSearch = handler.runPlaybackSearch();
  keyword = 'new';
  const newSearch = handler.runPlaybackSearch();
  pending.get('new')(response({ ok: true, data: { tracks: [{ id: 'new-result' }] } }));
  await newSearch;
  pending.get('old')(response({ ok: true, data: { tracks: [{ id: 'old-result' }] } }));
  await oldSearch;

  assert.equal(searchService.getResults()[0]?.id, 'new-result');
  assert.deepEqual(renderedIds, ['new-result']);
});

function createLyricToggleButton() {
  const classes = new Set();
  return {
    style: {},
    title: '',
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      }
    }
  };
}

async function loadModuleExports(entryPath, globals = {}) {
  const context = vm.createContext({
    console,
    fetch: globals.fetch,
    window: {},
    ...globals
  });
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

function response(payload) {
  return { ok: payload.ok !== false, payload };
}
