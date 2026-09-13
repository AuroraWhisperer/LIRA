'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('song board defaults to a clear frosted glass theme', () => {
  const themeSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8',
  );
  const defaultsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'storage', 'settings-defaults.js'),
    'utf8',
  );

  assert.match(defaultsSource, /themeOpacity: '0\.48'/);
  assert.match(defaultsSource, /backdropBlur: '14'/);
  assert.match(defaultsSource, /glowIntensity: '2'/);
  assert.match(themeSource, /if \(!Object\.keys\(defaultThemeLook\)\.length\)/);
  assert.match(
    themeSource,
    /const resetValues = \{\s*\.\.\.defaultThemeLook\s*\};/,
  );
  assert.match(
    themeSource,
    /bindRangePair\(\s*'backdropBlur',\s*'backdropBlurNumber',\s*0,\s*30,\s*14\s*\)/,
  );
  assert.match(
    themeSource,
    /bindRangePair\(\s*'glowIntensity',\s*'glowIntensityNumber',\s*0,\s*20,\s*2\s*\)/,
  );
});

test('gift workspace rows keep their content height inside the scroll container', () => {
  const source = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const giftWorkspaceRule = source.match(
    /\.gift-workspace\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(giftWorkspaceRule, 'gift workspace styles should remain defined');
  assert.match(
    giftWorkspaceRule,
    /grid-template-rows:\s*repeat\(7, max-content\)/,
  );
});

test('song workspace scrolls within the viewport above the player dock', () => {
  const source = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const songWorkspaceRule = source.match(
    /\.song-workspace\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const expandedRule = source.match(
    /body\.player-dock-expanded \.song-workspace\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(songWorkspaceRule, 'song workspace styles should remain defined');
  assert.ok(expandedRule, 'expanded player sizing should remain defined');
  assert.match(
    songWorkspaceRule,
    /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/,
  );
  assert.match(songWorkspaceRule, /overflow-y:\s*auto/);
  assert.match(
    expandedRule,
    /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 218px\)\)/,
  );
});

test('player dock exposes a collapse handle and shares its height with route workspaces', () => {
  const html = readAdminHtml();
  const playerStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'playback', 'player.css'),
    'utf8',
  );
  const playbackLayout = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'playback', 'layout.css'),
    'utf8',
  );
  const adminWorkspace = readCssBundle(
    'public',
    'css',
    'admin',
    'workspace.css',
  );
  const otherWorkspace = readCssBundle(
    'public',
    'css',
    'admin',
    'other-features.css',
  );

  assert.match(
    html,
    /id="playerDockToggle"[^>]*aria-expanded="true"[^>]*aria-controls="playbackPlayerBody"/,
  );
  assert.match(
    html,
    /id="playbackPlayerBody" class="panel-body playback-player"/,
  );
  assert.match(playerStyles, /--player-dock-collapsed-height:\s*0px/);
  assert.match(playerStyles, /body\.player-dock-collapsed\s*\{/);
  assert.match(
    playerStyles,
    /\.playback-player-panel\.is-collapsed \.playback-player\s*\{/,
  );
  assert.match(
    playbackLayout,
    /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/,
  );
  assert.match(
    adminWorkspace,
    /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/,
  );
  assert.match(
    otherWorkspace,
    /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/,
  );
});

test('player dock starts collapsed and toggles open without opening fullscreen', async () => {
  const makeClassList = () => {
    const names = new Set();
    return {
      add(...values) {
        values.forEach((value) => names.add(value));
      },
      remove(...values) {
        values.forEach((value) => names.delete(value));
      },
      toggle(value, force) {
        const next = force === undefined ? !names.has(value) : force;
        if (next) names.add(value);
        else names.delete(value);
        return next;
      },
      contains(value) {
        return names.has(value);
      },
    };
  };
  const makeElement = () => {
    const listeners = new Map();
    const attributes = new Map();
    return {
      classList: makeClassList(),
      listeners,
      attributes,
      title: '',
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      getAttribute(name) {
        return attributes.get(name);
      },
      closest() {
        return null;
      },
    };
  };

  const playerPanel = makeElement();
  const fullscreen = makeElement();
  const dockToggle = makeElement();
  const playerBody = makeElement();
  const elements = {
    playerFullscreen: fullscreen,
    playerDockToggle: dockToggle,
    playbackPlayerBody: playerBody,
    playbackVolumePanel: makeElement(),
    playbackVolumeIcon: makeElement(),
    queuePopup: makeElement(),
    queuePopupBackdrop: makeElement(),
    playbackQueueBtn: makeElement(),
  };
  const body = { classList: makeClassList() };
  const document = {
    body,
    addEventListener() {},
    querySelector(selector) {
      return selector === '.playback-player-panel' ? playerPanel : null;
    },
    getElementById(id) {
      return elements[id] || null;
    },
  };
  const window = { AdminApp: {} };

  const { FormsService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'),
    { document, window },
  );
  const service = new FormsService();
  let fullscreenOpened = false;
  service.openFullscreenPlayer = () => {
    fullscreenOpened = true;
  };

  service.initWorkspaceControls();
  assert.equal(body.classList.contains('player-dock-collapsed'), true);
  assert.equal(playerPanel.classList.contains('is-collapsed'), true);
  assert.equal(playerBody.getAttribute('aria-hidden'), 'true');
  assert.equal(dockToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(dockToggle.getAttribute('aria-label'), '展开播放器');

  const panelClick = playerPanel.listeners.get('click');
  panelClick({
    target: {
      closest(selector) {
        return selector.includes('button') ? dockToggle : null;
      },
    },
  });
  assert.equal(fullscreenOpened, false);

  const dockClick = dockToggle.listeners.get('click');
  dockClick({ stopPropagation() {} });
  assert.equal(body.classList.contains('player-dock-collapsed'), false);
  assert.equal(playerPanel.classList.contains('is-collapsed'), false);
  assert.equal(playerBody.getAttribute('aria-hidden'), 'false');
  assert.equal(dockToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(dockToggle.getAttribute('aria-label'), '收起播放器');
});

test('queue panels remain the same height on desktop', () => {
  const workspaceSource = readCssBundle(
    'public',
    'css',
    'admin',
    'workspace.css',
  );
  const responsiveSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'responsive.css'),
    'utf8',
  );
  const queueRowRule = workspaceSource.match(
    /\.queues-row\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const responsiveQueueRule = responsiveSource.match(
    /@media \(max-width: 900px\) \{[\s\S]*?(\.queues-row\s*\{[\s\S]*?\n\s*\})/,
  )?.[1];
  const responsivePanelRule = responsiveSource.match(
    /\.queues-row \.sc-queue-panel,[\s\S]*?\n\s*\}/,
  )?.[0];

  assert.ok(queueRowRule, 'desktop queue row styles should remain defined');
  assert.ok(
    responsiveQueueRule,
    'responsive queue row styles should remain defined',
  );
  assert.ok(
    responsivePanelRule,
    'narrow-layout queue panel sizing should remain defined',
  );
  assert.match(queueRowRule, /flex:\s*0 0 450px/);
  assert.match(queueRowRule, /height:\s*450px/);
  assert.match(responsiveQueueRule, /flex:\s*0 0 auto/);
  assert.match(responsiveQueueRule, /height:\s*auto/);
  assert.match(responsivePanelRule, /height:\s*auto/);
});

test('admin queue cards have enough height for their text and metadata', () => {
  const source = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const collapsibleSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'collapsible.css'),
    'utf8',
  );
  const queueListRule = source.match(
    /\.queues-row \.queue-panel \.queue-list\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const scListRule = source.match(
    /\.queues-row \.queue-panel \.sc-list\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const queueItemRule = source.match(
    /\.queues-row \.queue-panel \.queue-row\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const scRowRule = collapsibleSource.match(/\.sc-row\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(queueListRule, 'queue list styles should remain defined');
  assert.ok(scListRule, 'SC queue list styles should remain defined');
  assert.ok(queueItemRule, 'queue item styles should remain defined');
  assert.ok(scRowRule, 'SC queue item styles should remain defined');
  assert.match(queueListRule, /grid-auto-rows:\s*76px/);
  assert.match(scListRule, /grid-auto-rows:\s*82px/);
  assert.match(queueListRule, /align-content:\s*start/);
  assert.match(queueItemRule, /min-height:\s*0/);
  assert.match(queueItemRule, /overflow:\s*hidden/);
  assert.match(scRowRule, /align-items:\s*center/);
});

test('assisted super chat cards keep a single status color on hover', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'collapsible.css'),
    'utf8',
  );
  const assistedHoverRule = source.match(
    /\.sc-row\.assisted:hover::before\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(
    assistedHoverRule,
    'assisted SC hover override should remain defined',
  );
  assert.match(assistedHoverRule, /opacity:\s*0/);
});

test('admin queue wheel scrolls overflowing lists and releases the page at their edges', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'queue.js'),
    'utf8',
  );
  const makeTarget = () => ({
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
  });
  const superChatPanel = makeTarget();
  const queuePanel = makeTarget();
  const superChatList = {
    clientHeight: 100,
    scrollHeight: 100,
    scrollTop: 0,
    closest: () => superChatPanel,
  };
  const queueList = {
    clientHeight: 100,
    scrollHeight: 100,
    scrollTop: 0,
    closest: () => queuePanel,
  };
  const elements = {
    nextBtn: makeTarget(),
    clearBtn: makeTarget(),
    superChatList,
    queueList,
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
          api: async () => ({}),
        },
      },
    },
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.queue.initQueueForm();
  const wheel = superChatPanel.listeners.get('wheel');
  const dispatchWheel = (deltaY) => {
    let prevented = false;
    wheel({
      deltaY,
      deltaMode: 0,
      preventDefault() {
        prevented = true;
      },
    });
    return prevented;
  };

  assert.equal(
    dispatchWheel(120),
    false,
    'a non-overflowing queue should leave page scrolling alone',
  );
  superChatList.scrollHeight = 300;
  assert.equal(
    dispatchWheel(120),
    true,
    'an overflowing queue should consume downward wheel input',
  );
  assert.equal(superChatList.scrollTop, 36);
  superChatList.scrollTop = 200;
  assert.equal(
    dispatchWheel(120),
    false,
    'the bottom edge should release downward input to the page',
  );
  assert.equal(
    dispatchWheel(-120),
    true,
    'the list should still consume input away from the bottom edge',
  );
  superChatList.scrollTop = 0;
  assert.equal(
    dispatchWheel(-120),
    false,
    'the top edge should release upward input to the page',
  );
});

test('desktop admin keeps scrolling on the workspace instead of nesting it in tabs', () => {
  const workspaceSource = readCssBundle(
    'public',
    'css',
    'admin',
    'workspace.css',
  );
  const responsiveSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'responsive.css'),
    'utf8',
  );
  const activeTabRule = workspaceSource.match(
    /\.song-management-panel > \.tab-page\.active\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const desktopBodyRule = responsiveSource.match(
    /@media \(min-width: 901px\)[\s\S]*?body\s*\{[\s\S]*?\n\s*\}/,
  )?.[0];
  const mobileBodyRule = responsiveSource.match(
    /@media \(max-width: 900px\)[\s\S]*?body\s*\{[\s\S]*?\n\s*\}/,
  )?.[0];

  assert.ok(
    activeTabRule,
    'active management tab styles should remain defined',
  );
  assert.ok(
    desktopBodyRule,
    'desktop body overflow rule should remain defined',
  );
  assert.ok(mobileBodyRule, 'mobile body overflow rule should remain defined');
  assert.match(activeTabRule, /overflow:\s*visible/);
  assert.match(desktopBodyRule, /overflow:\s*hidden/);
  assert.match(mobileBodyRule, /overflow:\s*auto/);
});

test('hidden switches and the narrow player do not widen the page', () => {
  const adminSource = readCssBundle(
    'public',
    'css',
    'components',
    'switch-control.css',
  );
  const playbackSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'playback', 'responsive.css'),
    'utf8',
  );
  const switchInputRule = adminSource.match(
    /\.switch-control input\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const narrowPlayerRule = playbackSource.match(
    /@media \(max-width: 900px\)[\s\S]*?\.playback-progress-row\s*\{[\s\S]*?\n\s*\}/,
  )?.[0];

  assert.ok(switchInputRule, 'switch input styles should remain defined');
  assert.ok(
    narrowPlayerRule,
    'narrow player progress styles should remain defined',
  );
  assert.match(switchInputRule, /width:\s*1px/);
  assert.match(switchInputRule, /height:\s*1px/);
  assert.match(narrowPlayerRule, /width:\s*auto/);
  assert.match(narrowPlayerRule, /padding-left:\s*0/);
});

test('playback labels scroll independently without resizing the progress slot', async () => {
  const html = readAdminHtml();
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'playback', 'player.css'),
    'utf8',
  );
  const nowPlayingRule = styles.match(/\.playback-now\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(nowPlayingRule, 'now-playing layout styles should remain defined');
  assert.match(
    nowPlayingRule,
    /grid-template-columns:\s*minmax\(0, 180px\) minmax\(520px, 1fr\)/,
  );
  assert.match(html, /id="playbackTrackTitle" class="playback-marquee"/);
  assert.match(html, /id="playbackTrackArtist" class="playback-marquee"/);

  const { PlaybackBar } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'playback-bar.js'),
  );
  const player = new PlaybackBar();
  const classes = new Set();
  let animationKeyframes = null;
  let animationOptions = null;
  let cancelled = false;
  const animation = {
    cancel() {
      cancelled = true;
    },
  };
  const textElement = {
    scrollWidth: 260,
    animate(keyframes, options) {
      animationKeyframes = keyframes;
      animationOptions = options;
      return animation;
    },
  };
  const element = {
    clientWidth: 100,
    querySelector() {
      return textElement;
    },
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
    },
  };

  player.updateMarquee(element);

  assert.equal(classes.has('is-scrolling'), true);
  assert.equal(animationKeyframes[0].transform, 'translateX(0)');
  assert.equal(animationKeyframes[2].transform, 'translateX(-160px)');
  assert.equal(animationKeyframes[3].transform, 'translateX(-160px)');
  assert.equal(animationKeyframes[4].transform, 'translateX(0)');
  assert.equal(
    Math.round(
      (animationKeyframes[1].offset - animationKeyframes[0].offset) *
        animationOptions.duration,
    ),
    1000,
  );
  assert.equal(
    Math.round(
      (animationKeyframes[3].offset - animationKeyframes[2].offset) *
        animationOptions.duration,
    ),
    1000,
  );

  element.clientWidth = 300;
  player.updateMarquee(element);
  assert.equal(cancelled, true);
  assert.equal(classes.has('is-scrolling'), false);
});
