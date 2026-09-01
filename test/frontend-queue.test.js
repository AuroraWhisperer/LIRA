'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { readCssBundle } = require('./helpers/css-bundle');
const {
  readJsModuleBundle: readRawJsModuleBundle,
} = require('./helpers/js-module-bundle');
const {
  createLyricToggleButton,
  loadModuleExports,
  response,
} = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');
const settingsStoreModule = require('../src/storage/settings-store');

function readJsModuleBundle(...relativeSegments) {
  return readRawJsModuleBundle(...relativeSegments).replace(
    /^\s*(?:export\s+)?\{\s*applyTheme,\s*setIdentityRuleThemeVars\s*\}\s+from\s+['"]\.\/queue-theme\.js['"];\s*/gm,
    '',
  );
}

function readOvertimeAdminSource() {
  return [
    'overtime-rule-model.js',
    'overtime-rule-effect-editor.js',
    'overtime-rule-editor.js',
    'overtime-time-view.js',
    'overtime-status-view.js',
    'overtime.js',
  ]
    .map((file) =>
      fs
        .readFileSync(
          path.join(ROOT_DIR, 'public', 'js', 'admin', file),
          'utf8',
        )
        .replace(/^import\s+[\s\S]*?;\s*$/gm, '')
        .replace(/^export\s+/gm, ''),
    )
    .join('\n');
}

test('admin queue style cards keep styles 1 and 2 neutral while styles 3-6 use themed palettes', () => {
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'toasts', 'gifts.css'),
    'utf8',
  );
  const neutralStyles = ['classic', 'identity'];
  neutralStyles.forEach((style) => {
    const rule = styles.match(
      new RegExp(
        `\\.style-option\\[data-overlay-style=['"]${style}['"]\\]\\s*\\{[\\s\\S]*?\\n\\}`,
      ),
    )?.[0];

    assert.ok(rule, `${style} should have a style card`);
    assert.match(rule, /--style-option-bg:\s*var\(--color-bg-primary\)/);
    assert.match(rule, /--style-option-border:\s*var\(--border\)/);
    assert.match(rule, /--style-option-title:\s*var\(--text\)/);
  });

  const illustratedStyles = [
    'storybook',
    'neon-vinyl',
    'cherry-ribbon',
    'golden-lily',
  ];
  const backgrounds = illustratedStyles.map((style) => {
    const rule = styles.match(
      new RegExp(
        `\\.style-option\\[data-overlay-style=['"]${style}['"]\\]\\s*\\{[\\s\\S]*?\\n\\}`,
      ),
    )?.[0];

    assert.ok(rule, `${style} should have a themed style card`);
    assert.match(rule, /--style-option-border:\s*#[0-9a-f]{6}/i);
    assert.match(rule, /--style-option-title:\s*#[0-9a-f]{6}/i);
    return rule.match(/--style-option-bg:\s*([^;]+);/)?.[1];
  });

  assert.equal(new Set(backgrounds).size, illustratedStyles.length);
  assert.match(
    styles,
    /\.style-option\.active\s*\{[\s\S]*?var\(--style-option-ring\)/,
  );
  assert.match(
    styles,
    /\.style-option:focus-visible\s*\{[\s\S]*?var\(--style-option-accent\)/,
  );
});

test('illustrated queue styles expose persisted typography controls', () => {
  const html = readAdminHtml();
  const formSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8',
  );
  const formsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'),
    'utf8',
  );
  const localFontSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'local-font-library.js'),
    'utf8',
  );
  const defaultsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'storage', 'settings-defaults.js'),
    'utf8',
  );
  const themeStoreSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'storage', 'theme-store.js'),
    'utf8',
  );
  const overlaySource = readJsModuleBundle(
    'public',
    'js',
    'overlays',
    'queue.js',
  );
  const overlayUtilsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue-utils.js'),
    'utf8',
  );
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');

  assert.match(html, /data-illustrated-only/);
  assert.doesNotMatch(html, /跟随每种风格默认字体|跟随每种风格默认字重/);
  assert.match(html, /<option value="default">幼圆<\/option>/);
  assert.match(html, /<option value="default">粗体<\/option>/);
  assert.match(html, /id="illustratedQueueFontFamily"/);
  assert.match(html, /id="illustratedQueueFontWeight"/);
  assert.match(html, /id="illustratedQueueUseCustomTextColor"/);
  assert.match(html, /id="illustratedQueueTextColor"[^>]*type="color"/);
  assert.match(
    formSource,
    /fontFamily:\s*value\('illustratedQueueFontFamily'\)/,
  );
  assert.match(
    formSource,
    /registerLocalFontSelect\(\s*document\.getElementById\(\s*['"]illustratedQueueFontFamily['"]\s*,?\s*\)\s*,?\s*\)/,
  );
  assert.match(
    formsSource,
    /ensureSavedFontOption\([\s\S]*?illustratedQueueFontFamily/,
  );
  assert.match(localFontSource, /group\.label = '本机字体'/);
  assert.match(localFontSource, /window\.queryLocalFonts\(\)/);
  assert.match(
    formSource,
    /fontWeight:\s*value\('illustratedQueueFontWeight'\)/,
  );
  assert.match(
    formSource,
    /ILLUSTRATED_DEFAULT_LABELS[\s\S]*'neon-vinyl'[\s\S]*fontFamily:\s*'微软雅黑'[\s\S]*fontWeight:\s*'较粗'/,
  );
  assert.match(
    formSource,
    /useCustomTextColor:\s*value\('illustratedQueueUseCustomTextColor'\)/,
  );
  assert.match(formSource, /textColor:\s*value\('illustratedQueueTextColor'\)/);
  assert.match(defaultsSource, /illustratedQueueFontFamily:\s*'default'/);
  assert.match(defaultsSource, /illustratedQueueFontWeight:\s*'default'/);
  assert.match(defaultsSource, /illustratedQueueUseCustomTextColor:\s*'false'/);
  assert.match(defaultsSource, /illustratedQueueTextColor:\s*'#315d7d'/);
  assert.match(
    themeStoreSource,
    /'illustratedQueueFontFamily',\s*'illustratedQueueFontWeight'/,
  );
  assert.match(
    themeStoreSource,
    /'illustratedQueueUseCustomTextColor',\s*'illustratedQueueTextColor'/,
  );
  assert.match(overlaySource, /--illustrated-queue-font-family/);
  assert.match(
    overlayUtilsSource,
    /const multilingualFontFallback\s*=\s*['"]"Microsoft YaHei"/,
  );
  assert.match(overlaySource, /--illustrated-queue-font-weight/);
  assert.match(overlaySource, /--illustrated-queue-text-color/);
  assert.match(overlayStyles, /\.illustrated-custom-font/);
  assert.match(overlayStyles, /\.illustrated-custom-weight/);
  assert.match(overlayStyles, /\.illustrated-custom-text-color/);
});

test('queue styles migrate shared typography and scrolling into independent persisted values', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const insert = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
  );
  const legacyValues = {
    identityQueueFontSize: '37',
    illustratedQueueFontFamily: 'KaiTi, serif',
    illustratedQueueFontWeight: '700',
    illustratedQueueUseCustomTextColor: 'true',
    illustratedQueueTextColor: '#123456',
    queueScrollMode: 'loop',
    identityQueueScrollSpeed: '63',
  };
  for (const [key, value] of Object.entries(legacyValues)) {
    insert.run(key, value, '2026-08-23 00:00:00');
  }

  try {
    const store = settingsStoreModule.createSettingsStore(db);
    settingsStoreModule.migrateQueueStyleSettings(db, '');
    const settings = store.getSettings();

    assert.equal(settings.identityQueueScrollMode, 'loop');
    for (const prefix of [
      'storybook',
      'neonVinyl',
      'cherryRibbon',
      'goldenLily',
    ]) {
      assert.equal(settings[`${prefix}QueueFontSize`], '37');
      assert.equal(settings[`${prefix}QueueFontFamily`], 'KaiTi, serif');
      assert.equal(settings[`${prefix}QueueFontWeight`], '700');
      assert.equal(settings[`${prefix}QueueUseCustomTextColor`], 'true');
      assert.equal(settings[`${prefix}QueueTextColor`], '#123456');
      assert.equal(settings[`${prefix}QueueScrollMode`], 'loop');
      assert.equal(settings[`${prefix}QueueScrollSpeed`], '63');
    }
    assert.equal(settings.queueStyleSettingsVersion, '1');
  } finally {
    db.close();
  }
});

test('admin queue form exposes and persists controls for only the selected style', () => {
  const html = readAdminHtml();
  const formSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8',
  );
  const formsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'),
    'utf8',
  );
  const defaultsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'storage', 'settings-defaults.js'),
    'utf8',
  );
  const themeStoreSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'storage', 'theme-store.js'),
    'utf8',
  );

  assert.match(html, /id="identityQueueScrollMode"/);
  assert.match(formSource, /queueStyleSettingsPayload\(/);
  assert.match(
    formSource,
    /normalizePersistedQueueStyle\(value\('overlayQueueStyle'\)\)\s*!==\s*styleAtEdit/,
  );
  assert.match(
    formSource,
    /if \(currentStyle !== nextStyle\) await saveTheme\(\);[\s\S]*setOverlayStyle\(nextStyle\)/,
  );
  assert.match(formsSource, /readQueueStyleSettings\(/);
  for (const prefix of [
    'storybook',
    'neonVinyl',
    'cherryRibbon',
    'goldenLily',
  ]) {
    assert.match(defaultsSource, new RegExp(`${prefix}QueueFontSize:\\s*'26'`));
    assert.match(
      defaultsSource,
      new RegExp(`${prefix}QueueScrollMode:\\s*'bounce'`),
    );
    assert.match(
      defaultsSource,
      new RegExp(`${prefix}QueueScrollSpeed:\\s*'80'`),
    );
    assert.match(themeStoreSource, new RegExp(`'${prefix}QueueFontSize'`));
  }
  assert.match(defaultsSource, /identityQueueScrollMode:\s*'bounce'/);
});

test('queue overlay applies rule sizing and scrolls only overflowing super chats', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) {
      callback();
    },
    document: {
      addEventListener() {},
      documentElement: {
        style: {
          setProperty(name, value) {
            styleValues.set(name, value);
          },
        },
      },
    },
  };
  vm.runInNewContext(source, sandbox);

  sandbox.setIdentityRuleThemeVars(sandbox.document.documentElement, {
    overlayRuleFontSize: 12,
  });
  assert.equal(styleValues.get('--identity-rule-font-size'), '24px');

  let longAnimation = null;
  const longText = {
    scrollWidth: 300,
    animate(keyframes, options) {
      longAnimation = { keyframes, options };
    },
  };
  const shortText = {
    scrollWidth: 90,
    animate() {
      assert.fail('short text must not animate');
    },
  };
  const containers = [
    { clientWidth: 100, querySelector: () => longText },
    { clientWidth: 100, querySelector: () => shortText },
  ];

  sandbox.scheduleIdentitySuperChatScroll({
    querySelectorAll: () => containers,
  });
  assert.ok(longAnimation);
  assert.equal(longAnimation.keyframes[1].transform, 'translateX(-200px)');
  const pauseMilliseconds =
    (longAnimation.keyframes[2].offset - longAnimation.keyframes[1].offset) *
    longAnimation.options.duration;
  assert.ok(Math.abs(pauseMilliseconds - 1500) < 0.001);

  const timing = sandbox.bounceScrollTiming(12);
  const verticalTopPauseSeconds =
    (timing.topPauseEndPercent / 100) * timing.totalSeconds;
  const verticalPauseSeconds =
    ((timing.pauseEndPercent - timing.downPercent) / 100) * timing.totalSeconds;
  assert.ok(Math.abs(verticalTopPauseSeconds - 1.5) < 0.000001);
  assert.ok(Math.abs(verticalPauseSeconds - 1.5) < 0.000001);
});

test('identity queue colors Super Chats by price tier', () => {
  const source = readJsModuleBundle(
    'public',
    'js',
    'overlays',
    'queue-render.js',
  );
  const sandbox = {};
  vm.runInNewContext(
    `${source}\nthis.renderIdentitySuperChatRow = renderIdentitySuperChatRow;`,
    sandbox,
  );

  assert.match(
    sandbox.renderIdentitySuperChatRow({ price: 99, message: '蓝色' }),
    /identity-sc-price identity-sc-price-blue/,
  );
  assert.match(
    sandbox.renderIdentitySuperChatRow({ price: 100, message: '黄色' }),
    /identity-sc-price identity-sc-price-yellow/,
  );
  assert.match(
    sandbox.renderIdentitySuperChatRow({ price: 999, message: '黄色' }),
    /identity-sc-price identity-sc-price-yellow/,
  );
  assert.match(
    sandbox.renderIdentitySuperChatRow({ price: 1000, message: '红色' }),
    /identity-sc-price identity-sc-price-red/,
  );

  const styles = readCssBundle('public', 'css', 'overlays', 'base.css');
  assert.match(styles, /\.identity-sc-price\s*\{[\s\S]*?background:\s*#2a60b2/);
  assert.match(
    styles,
    /\.identity-sc-price-yellow\s*\{[\s\S]*?background:\s*#e7a23a/,
  );
  assert.match(
    styles,
    /\.identity-sc-price-red\s*\{[\s\S]*?background:\s*#e62117/,
  );
});

test('identity queue has an independent scroll speed setting', () => {
  const html = readAdminHtml();
  const formSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8',
  );
  const defaultsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'storage', 'settings-defaults.js'),
    'utf8',
  );

  assert.match(html, /id="identityQueueScrollSpeedRange"/);
  assert.match(html, /id="identityQueueScrollSpeed"/);
  assert.match(
    formSource,
    /scrollSpeed:\s*window\.AdminApp\.forms\.normalizeQueueScrollSpeedForDisplay\(\s*value\(\s*['"]identityQueueScrollSpeed['"]\s*,?\s*\)\s*,?\s*\)/,
  );
  assert.match(defaultsSource, /identityQueueScrollSpeed: '80'/);
  assert.match(defaultsSource, /identityQueueScrollMode: 'bounce'/);
});

test('styles 2-6 hydrate the active style content font size setting', () => {
  const html = readAdminHtml();
  const formSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8',
  );
  const formsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'),
    'utf8',
  );
  const overlaySource = readJsModuleBundle(
    'public',
    'js',
    'overlays',
    'queue.js',
  );
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const defaultsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'storage', 'settings-defaults.js'),
    'utf8',
  );

  assert.match(
    html,
    /id="identityQueueFontSize"[^>]*min="9"[^>]*max="78"[^>]*value="26"/,
  );
  assert.match(
    html,
    /id="identityQueueFontSizeNumber"[^>]*min="9"[^>]*max="78"[^>]*value="26"/,
  );
  assert.match(formSource, /fontSize:\s*value\('identityQueueFontSize'\)/);
  assert.match(formsSource, /readQueueStyleSettings\(values, overlayStyle\)/);
  assert.match(defaultsSource, /identityQueueFontSize: '26'/);
  assert.match(
    overlaySource,
    /--identity-queue-font-size[\s\S]*?identityQueueFontSize\(\s*settings\s*\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-row\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*26px\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-pin-content\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*26px\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-row\.identity-sc \.identity-sc-content\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*26px\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-pin-row\s*\{[\s\S]*?height:\s*var\(--identity-row-height,\s*42px\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-pin-label\s*\{[\s\S]*?height:\s*1\.6em[\s\S]*?border-radius:\s*0\.3em[\s\S]*?padding:\s*0\s+0\.4em[\s\S]*?font-size:\s*calc\(var\(--identity-queue-font-size,\s*26px\)\s*\*\s*0\.77\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-rank\s*\{[\s\S]*?font-size:\s*inherit/,
  );
  assert.match(
    overlayStyles,
    /\.identity-requester\s*\{[\s\S]*?font-size:\s*inherit/,
  );
  const identityBlockRules = [
    ...overlayStyles.matchAll(
      /\.identity-badge,\s*\.identity-medal\s*\{[^}]*\}/g,
    ),
  ];
  const identityBlockRule = identityBlockRules.at(-1)?.[0];
  const medalRules = [
    ...overlayStyles.matchAll(/\.identity-medal\s*\{[^}]*\}/g),
  ];
  const medalRule = medalRules.at(-1)?.[0];
  assert.ok(identityBlockRule);
  assert.ok(medalRule);
  assert.match(identityBlockRule, /font-size:\s*75%/);
  assert.match(identityBlockRule, /height:\s*max\(17\.6px,\s*1\.265em\)/);
  assert.match(identityBlockRule, /padding:\s*0\s+0\.24em/);
  assert.match(identityBlockRule, /border-radius:\s*max\(3px,\s*0\.15em\)/);
  assert.doesNotMatch(identityBlockRule, /overlay-font-scale/);
  assert.match(medalRule, /min-width:\s*1\.45em/);
  assert.doesNotMatch(medalRule, /max-width/);
});

test('storybook queue scales complete illustrated rows while identity content stays inside the artwork viewport', () => {
  const html = readAdminHtml();
  const overlaySource = readJsModuleBundle(
    'public',
    'js',
    'overlays',
    'queue.js',
  );
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const entryCss = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'),
    'utf8',
  );
  const adminThemeSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8',
  );
  const adminStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'toasts', 'gifts.css'),
    'utf8',
  );
  const framePath = path.join(
    ROOT_DIR,
    'public',
    'img',
    'overlays',
    'song-board-style-3',
    'frame.webp',
  );
  const entryPath = path.join(
    ROOT_DIR,
    'public',
    'img',
    'overlays',
    'song-board-style-3',
    'entry.webp',
  );
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(overlaySource, sandbox);

  assert.match(html, /data-overlay-style="storybook"[\s\S]*点歌板风格 3/);
  assert.match(html, /data-identity-only/);
  assert.match(adminThemeSource, /ILLUSTRATED_QUEUE_STYLES[\s\S]*'storybook'/);
  assert.match(adminThemeSource, /if \(nextStyle !== 'classic'\)/);
  assert.match(
    adminStyles,
    /\.style-picker\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,/,
  );
  assert.equal(sandbox.normalizeQueueStyle('storybook'), 'storybook');
  assert.equal(sandbox.normalizeQueueStyle('festival'), 'identity');
  assert.equal(sandbox.normalizeQueueStyle('unknown'), 'classic');
  assert.ok(fs.statSync(framePath).size > 0);
  assert.ok(fs.statSync(entryPath).size > 0);
  assert.match(entryCss, /@import url\('\.\/base\/storybook\.css'\);/);
  assert.match(
    overlayStyles,
    /\.queue-storybook\s*\{[\s\S]*?aspect-ratio:\s*2\s*\/\s*3/,
  );
  assert.match(
    overlayStyles,
    /\.queue-storybook::before\s*\{[\s\S]*?background:\s*#fff/,
  );
  assert.match(overlayStyles, /song-board-style-3\/frame\.webp/);
  assert.match(overlayStyles, /song-board-style-3\/entry\.webp/);
  assert.match(
    overlayStyles,
    /\.queue-storybook \.overlay-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    overlayStyles,
    /\.queue-storybook \.overlay-title\s*\{[\s\S]*?width:\s*100%/,
  );

  const row = sandbox.renderStorybookRow(
    {
      song_name: '<img src=x onerror=alert(1)>超长歌名',
      requester_name: '<b>点歌人</b>',
      requester_guard_level: 2,
      requester_medal_name: '云朵团',
      requester_medal_level: 26,
    },
    0,
  );
  assert.match(row, /storybook-rank">1<\/span>/);
  assert.match(row, /storybook-info-viewport[\s\S]*storybook-info/);
  assert.match(
    row,
    /storybook-song[\s\S]*storybook-requester[\s\S]*storybook-badge[\s\S]*storybook-medal/,
  );
  assert.match(row, /&lt;img src=x onerror=alert\(1\)&gt;超长歌名/);
  assert.match(row, /&lt;b&gt;点歌人&lt;\/b&gt;/);
  assert.doesNotMatch(row, /<img src=x|<b>点歌人/);

  const viewportRule = overlayStyles.match(
    /\.storybook-info-viewport\s*\{[^}]*\}/,
  )?.[0];
  const rankRule = overlayStyles.match(/\.storybook-rank\s*\{[^}]*\}/)?.[0];
  const rowRule = overlayStyles.match(/\.storybook-row\s*\{[^}]*\}/)?.[0];
  const contentRule = overlayStyles.match(
    /\.queue-storybook \.overlay-content\s*\{[^}]*\}/,
  )?.[0];
  assert.ok(viewportRule);
  assert.ok(rankRule);
  assert.ok(rowRule);
  assert.ok(contentRule);
  assert.match(viewportRule, /overflow:\s*hidden/);
  assert.match(viewportRule, /min-width:\s*0/);
  assert.match(viewportRule, /right:\s*5\.5%/);
  assert.match(viewportRule, /left:\s*25%/);
  assert.match(viewportRule, /padding:\s*0/);
  assert.doesNotMatch(viewportRule, /background:/);
  assert.match(rankRule, /left:\s*2\.5%/);
  assert.match(contentRule, /--storybook-list-offset-y:\s*10px/);
  assert.match(
    contentRule,
    /inset:\s*calc\(24\.5% - var\(--storybook-list-offset-y\)\)\s+7\.5%\s+calc\(17% \+ var\(--storybook-list-offset-y\)\)\s+12\.5%/,
  );
  assert.match(
    rowRule,
    /background-image:\s*url\('\/img\/overlays\/song-board-style-3\/entry\.webp'\)/,
  );
  assert.match(rowRule, /left:\s*-2%/);
  assert.match(rowRule, /width:\s*88%/);
  assert.match(rowRule, /aspect-ratio:\s*1237\s*\/\s*304/);
  assert.match(rowRule, /background-position:\s*44\.482%\s+45\.972%/);
  assert.match(rowRule, /background-size:\s*124\.171%\s+336\.842%/);
  assert.match(rowRule, /min-height:\s*0/);
  assert.doesNotMatch(rowRule, /height:\s*clamp\(/);
  assert.match(
    rowRule,
    /font-size:\s*var\(--identity-queue-font-size,\s*26px\)/,
  );
  const entryBuffer = fs.readFileSync(entryPath);
  assert.equal(entryBuffer.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(
    entryBuffer.subarray(8, 16).toString('ascii'),
    'WEBPVP8L',
    'storybook entry asset should use lossless WebP',
  );
});

test('styles 4 and 5 use supplied art, omit queue ranks, and render all four requested fields', () => {
  const html = readAdminHtml();
  const overlaySource = readJsModuleBundle(
    'public',
    'js',
    'overlays',
    'queue.js',
  );
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const entryCss = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'),
    'utf8',
  );
  const adminThemeSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8',
  );
  const assetPaths = [
    ['song-board-style-4', 'frame.webp'],
    ['song-board-style-4', 'entry.webp'],
    ['song-board-style-5', 'frame.webp'],
    ['song-board-style-5', 'entry.webp'],
  ].map((parts) => path.join(ROOT_DIR, 'public', 'img', 'overlays', ...parts));
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(overlaySource, sandbox);

  assert.match(html, /data-overlay-style="neon-vinyl"[\s\S]*点歌板风格 4/);
  assert.match(html, /data-overlay-style="cherry-ribbon"[\s\S]*点歌板风格 5/);
  assert.match(adminThemeSource, /neon-vinyl/);
  assert.match(adminThemeSource, /cherry-ribbon/);
  assert.equal(sandbox.normalizeQueueStyle('neon-vinyl'), 'neon-vinyl');
  assert.equal(sandbox.normalizeQueueStyle('cherry-ribbon'), 'cherry-ribbon');
  assetPaths.forEach((assetPath) => assert.ok(fs.statSync(assetPath).size > 0));

  assert.match(entryCss, /@import url\('\.\/base\/neon-vinyl\.css'\);/);
  assert.match(entryCss, /@import url\('\.\/base\/cherry-ribbon\.css'\);/);
  assert.match(overlayStyles, /song-board-style-4\/frame\.webp/);
  assert.match(overlayStyles, /song-board-style-4\/entry\.webp/);
  assert.match(overlayStyles, /song-board-style-5\/frame\.webp/);
  assert.match(overlayStyles, /song-board-style-5\/entry\.webp/);
  assert.match(
    overlayStyles,
    /\.queue-neon-vinyl \.overlay-header,[\s\S]*\.queue-cherry-ribbon \.overlay-header,[\s\S]*\.queue-golden-lily \.overlay-header\s*\{[\s\S]*display:\s*none/,
  );
  assert.match(
    overlayStyles,
    /\.illustrated-info-viewport\s*\{[\s\S]*overflow:\s*hidden/,
  );

  const unsafeItem = {
    song_name: '<img src=x onerror=alert(1)>超长歌名',
    requester_name: '<b>点歌人</b>',
    requester_guard_level: 2,
    requester_medal_name: '<i>灯牌</i>',
    requester_medal_level: 26,
  };
  const neonRow = sandbox.renderNeonVinylRow(unsafeItem, 0);
  const ribbonRow = sandbox.renderCherryRibbonRow(unsafeItem, 1);

  [neonRow, ribbonRow].forEach((row) => {
    assert.doesNotMatch(row, /illustrated-rank/);
    assert.match(row, /提督/);
    assert.match(row, /&lt;img src=x onerror=alert\(1\)&gt;超长歌名/);
    assert.match(row, /&lt;b&gt;点歌人&lt;\/b&gt;/);
    assert.match(row, /&lt;i&gt;灯牌&lt;\/i&gt; · 26/);
    assert.doesNotMatch(row, /<img src=x|<b>点歌人|<i>灯牌/);
  });

  assert.doesNotMatch(neonRow, /illustrated-label/);
  assert.doesNotMatch(ribbonRow, /illustrated-label/);

  const neonContentRule = overlayStyles.match(
    /\.queue-neon-vinyl \.overlay-content\s*\{[^}]*\}/,
  )?.[0];
  const neonRowRule = overlayStyles.match(/\.neon-vinyl-row\s*\{[^}]*\}/)?.[0];
  const neonInfoRule = overlayStyles.match(
    /\.neon-vinyl-info\.identity-content\s*\{[^}]*\}/,
  )?.[0];
  const neonViewportRule = overlayStyles.match(
    /\.neon-vinyl-info-viewport\s*\{[^}]*\}/,
  )?.[0];
  const ribbonContentRule = overlayStyles.match(
    /\.queue-cherry-ribbon \.overlay-content\s*\{[^}]*\}/,
  )?.[0];
  const ribbonRowRule = overlayStyles.match(
    /\.cherry-ribbon-row\s*\{[^}]*\}/,
  )?.[0];
  const ribbonInfoRule = overlayStyles.match(
    /\.cherry-ribbon-info\.identity-content\s*\{[^}]*\}/,
  )?.[0];
  const ribbonViewportRule = overlayStyles.match(
    /\.cherry-ribbon-info-viewport\s*\{[^}]*\}/,
  )?.[0];
  assert.ok(neonContentRule);
  assert.ok(neonRowRule);
  assert.ok(neonInfoRule);
  assert.ok(neonViewportRule);
  assert.ok(ribbonContentRule);
  assert.ok(ribbonRowRule);
  assert.ok(ribbonInfoRule);
  assert.ok(ribbonViewportRule);
  assert.match(neonContentRule, /inset:\s*23\.5%\s+9\.5%\s+12%/);
  assert.match(neonRowRule, /width:\s*94%/);
  assert.match(neonRowRule, /aspect-ratio:\s*2172\s*\/\s*517\.5/);
  assert.match(neonRowRule, /min-height:\s*0/);
  assert.match(neonRowRule, /margin-inline:\s*auto/);
  assert.match(neonRowRule, /background-size:\s*100%\s+100%/);
  assert.match(
    neonRowRule,
    /font-size:\s*var\(--identity-queue-font-size,\s*26px\)/,
  );
  assert.match(neonInfoRule, /margin-inline:\s*0/);
  assert.match(neonViewportRule, /color:\s*#54152f/);
  assert.match(neonViewportRule, /top:\s*30%/);
  assert.match(neonViewportRule, /right:\s*15%/);
  assert.match(neonViewportRule, /bottom:\s*31%/);
  assert.match(neonViewportRule, /left:\s*25\.5%/);
  assert.match(neonViewportRule, /justify-content:\s*safe center/);
  assert.match(ribbonContentRule, /--cherry-ribbon-top-trim:\s*0px/);
  assert.match(ribbonContentRule, /--cherry-ribbon-bottom-trim:\s*30px/);
  assert.match(
    ribbonContentRule,
    /inset:\s*calc\(15% \+ var\(--cherry-ribbon-top-trim\)\)\s+10%\s+calc\(9\.5% \+ var\(--cherry-ribbon-bottom-trim\)\)/,
  );
  assert.match(ribbonRowRule, /width:\s*94%/);
  assert.match(ribbonRowRule, /aspect-ratio:\s*1623\s*\/\s*371\.2/);
  assert.match(ribbonRowRule, /min-height:\s*0/);
  assert.match(ribbonRowRule, /margin-inline:\s*auto/);
  assert.match(ribbonRowRule, /background-size:\s*100%\s+100%/);
  assert.match(
    ribbonRowRule,
    /font-size:\s*var\(--identity-queue-font-size,\s*26px\)/,
  );
  assert.match(ribbonInfoRule, /margin-inline:\s*auto/);
  assert.match(ribbonViewportRule, /top:\s*41%/);
  assert.match(ribbonViewportRule, /right:\s*14\.5%/);
  assert.match(ribbonViewportRule, /bottom:\s*33%/);
  assert.match(ribbonViewportRule, /left:\s*22%/);
});

test('style 4 scroll endpoint clears the foreground bottom frame', () => {
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const contentRule = overlayStyles.match(
    /\.queue-neon-vinyl \.overlay-content\s*\{[^}]*\}/,
  )?.[0];
  const frameRule = overlayStyles.match(
    /\.queue-neon-vinyl::after\s*\{[^}]*\}/,
  )?.[0];

  assert.ok(contentRule);
  assert.ok(frameRule);
  assert.match(contentRule, /inset:\s*23\.5%\s+9\.5%\s+12%/);
  assert.match(frameRule, /border-width:\s*168px\s+56px\s+84px/);
});

test('styles 4-6 give each guard tier one shared guard and medal color', () => {
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const guardColors = {
    1: '#f25f72',
    2: '#8d67e8',
    3: '#4b91e8',
  };

  for (const style of ['neon-vinyl', 'cherry-ribbon', 'golden-lily']) {
    for (const [level, color] of Object.entries(guardColors)) {
      const rule = overlayStyles.match(
        new RegExp(`\\.${style}-row\\.guard-${level}\\s*\\{[^}]*\\}`),
      )?.[0];
      assert.ok(rule, `${style} guard ${level} rule should exist`);
      assert.match(rule, new RegExp(`--identity-bg:\\s*${color}`));
      assert.match(rule, new RegExp(`--medal-bg:\\s*${color}`));
    }
  }
});

test('style 6 uses supplied golden lily art, shows queue ranks, and renders all four requested fields', () => {
  const html = readAdminHtml();
  const overlaySource = readJsModuleBundle(
    'public',
    'js',
    'overlays',
    'queue.js',
  );
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const entryCss = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'),
    'utf8',
  );
  const adminThemeSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8',
  );
  const adminStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'toasts', 'gifts.css'),
    'utf8',
  );
  const framePath = path.join(
    ROOT_DIR,
    'public',
    'img',
    'overlays',
    'song-board-style-6',
    'frame.webp',
  );
  const entryPath = path.join(
    ROOT_DIR,
    'public',
    'img',
    'overlays',
    'song-board-style-6',
    'entry.webp',
  );
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(overlaySource, sandbox);

  assert.match(html, /data-overlay-style="golden-lily"[\s\S]*点歌板风格 6/);
  assert.match(html, /点歌板风格 2 \/ 3 \/ 4 \/ 5 \/ 6/);
  assert.match(adminThemeSource, /golden-lily/);
  assert.match(
    adminStyles,
    /\.style-picker\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,/,
  );
  assert.equal(sandbox.normalizeQueueStyle('golden-lily'), 'golden-lily');
  assert.ok(fs.statSync(framePath).size > 0);
  assert.ok(fs.statSync(entryPath).size > 0);

  assert.match(entryCss, /@import url\('\.\/base\/golden-lily\.css'\);/);
  assert.match(overlayStyles, /song-board-style-6\/frame\.webp/);
  assert.match(overlayStyles, /song-board-style-6\/entry\.webp/);
  assert.match(
    overlayStyles,
    /\.golden-lily-rank\s*\{[\s\S]*place-items:\s*center/,
  );
  assert.match(
    overlayStyles,
    /\.golden-lily-info-viewport\s*\{[\s\S]*overflow:\s*hidden/,
  );
  assert.match(
    overlayStyles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.golden-lily-list\.scrolling[\s\S]*animation:\s*none/,
  );

  const row = sandbox.renderGoldenLilyRow(
    {
      song_name: '<img src=x onerror=alert(1)>超长歌名',
      requester_name: '<b>点歌人</b>',
      requester_guard_level: 2,
      requester_medal_name: '<i>灯牌</i>',
      requester_medal_level: 26,
    },
    5,
  );

  assert.match(row, /golden-lily-rank illustrated-rank">6<\/span>/);
  assert.doesNotMatch(row, /illustrated-label/);
  assert.match(row, /提督/);
  assert.match(row, /&lt;img src=x onerror=alert\(1\)&gt;超长歌名/);
  assert.match(row, /&lt;b&gt;点歌人&lt;\/b&gt;/);
  assert.match(row, /&lt;i&gt;灯牌&lt;\/i&gt; · 26/);
  assert.doesNotMatch(row, /<img src=x|<b>点歌人|<i>灯牌/);

  const goldenRowRule = overlayStyles.match(
    /\.golden-lily-row\s*\{[^}]*\}/,
  )?.[0];
  const goldenContentRule = overlayStyles.match(
    /\.queue-golden-lily \.overlay-content\s*\{(?=[^}]*inset:)[^}]*\}/,
  )?.[0];
  const goldenRankRule = overlayStyles.match(
    /\.golden-lily-rank\s*\{[^}]*\}/,
  )?.[0];
  const goldenViewportRule = overlayStyles.match(
    /\.golden-lily-info-viewport\s*\{[^}]*\}/,
  )?.[0];
  const goldenInfoRule = overlayStyles.match(
    /\.golden-lily-info\.identity-content\s*\{[^}]*\}/,
  )?.[0];
  assert.ok(goldenContentRule);
  assert.ok(goldenRowRule);
  assert.ok(goldenRankRule);
  assert.ok(goldenViewportRule);
  assert.ok(goldenInfoRule);
  assert.match(goldenContentRule, /inset:\s*16\.5%\s+8\.5%\s+13\.5%/);
  assert.match(
    overlaySource,
    /renderIllustratedAssetQueue\(\s*settings\s*,\s*current\s*,\s*waiting\s*,\s*content\s*,\s*['"]golden-lily['"]\s*,\s*4\s*,\s*renderGoldenLilyRow\s*,?\s*\)/,
  );
  assert.match(goldenRowRule, /width:\s*72%/);
  assert.match(goldenRowRule, /aspect-ratio:\s*2139\s*\/\s*539/);
  assert.match(goldenRowRule, /margin-inline:\s*auto/);
  assert.match(
    goldenRowRule,
    /font-size:\s*var\(--identity-queue-font-size,\s*26px\)/,
  );
  assert.match(goldenRankRule, /top:\s*25%/);
  assert.match(goldenRankRule, /bottom:\s*21%/);
  assert.match(goldenRankRule, /left:\s*5\.5%/);
  assert.match(goldenRankRule, /width:\s*18\.5%/);
  assert.match(goldenRankRule, /font-size:\s*1\.5em/);
  assert.match(goldenRankRule, /place-items:\s*center/);
  assert.match(goldenViewportRule, /top:\s*41%/);
  assert.match(goldenViewportRule, /right:\s*11%/);
  assert.match(goldenViewportRule, /bottom:\s*29%/);
  assert.match(goldenViewportRule, /left:\s*32%/);
  assert.match(
    overlayStyles,
    /\.golden-lily-list\.identity-list\s*\{[^}]*gap:\s*4px/,
  );
  assert.doesNotMatch(
    overlayStyles,
    /\.golden-lily-row:not\(:first-child\)\s*\{[^}]*margin-top:\s*-[\d.]+px/,
  );
  assert.match(goldenInfoRule, /margin-inline:\s*auto/);
});

test('styles 5 and 6 expand vertical visibility above their foreground frames', () => {
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const clipPaths = {
    'cherry-ribbon': /clip-path:\s*inset\(0%\s+0\s+-1%\)/,
    'golden-lily': /clip-path:\s*inset\(-5%\s+0\s+0\)/,
  };

  ['cherry-ribbon', 'golden-lily'].forEach((style) => {
    const contentRule = [
      ...overlayStyles.matchAll(
        new RegExp(`\\.queue-${style} \\.overlay-content\\s*\\{[^}]*\\}`, 'g'),
      ),
    ]
      .map((match) => match[0])
      .find((rule) => /inset:/.test(rule));
    const windowRule = [
      ...overlayStyles.matchAll(
        new RegExp(`\\.${style}-list-window\\s*\\{[^}]*\\}`, 'g'),
      ),
    ]
      .map((match) => match[0])
      .find((rule) => /overflow:\s*visible/.test(rule));

    assert.ok(contentRule);
    assert.ok(windowRule);
    assert.match(contentRule, /inset:/);
    assert.match(contentRule, /z-index:\s*4/);
    assert.match(contentRule, /overflow:\s*visible/);
    assert.match(contentRule, clipPaths[style]);
    assert.match(windowRule, /overflow:\s*visible/);
  });
});

test('identity content scrolls as one stream only when its rendered width overflows', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) {
      callback();
    },
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(source, sandbox);

  let longAnimation = null;
  const longClasses = new Set();
  const shortClasses = new Set(['has-horizontal-overflow']);
  const longText = {
    scrollWidth: 300,
    animate(keyframes, options) {
      longAnimation = { keyframes, options };
    },
  };
  const shortText = {
    scrollWidth: 90,
    animate() {
      assert.fail('fitting song text must not animate');
    },
  };
  const containers = [
    {
      clientWidth: 100,
      classList: {
        toggle(name, enabled) {
          if (enabled) longClasses.add(name);
          else longClasses.delete(name);
        },
      },
      querySelector: () => longText,
    },
    {
      clientWidth: 100,
      classList: {
        toggle(name, enabled) {
          if (enabled) shortClasses.add(name);
          else shortClasses.delete(name);
        },
      },
      querySelector: () => shortText,
    },
  ];

  sandbox.scheduleIdentityContentScroll({ querySelectorAll: () => containers });

  assert.ok(longAnimation);
  assert.deepEqual(
    Array.from(longAnimation.keyframes, (frame) => frame.transform),
    [
      'translateX(0)',
      'translateX(0)',
      'translateX(-200px)',
      'translateX(-200px)',
      'translateX(0)',
    ],
  );
  assert.equal(longClasses.has('has-horizontal-overflow'), true);
  assert.equal(shortClasses.has('has-horizontal-overflow'), false);
  assert.match(
    overlayStyles,
    /\.identity-content-wrapper\.has-horizontal-overflow\s*\{[^}]*justify-content:\s*flex-start/,
  );
  assert.match(
    overlayStyles,
    /\.identity-content-wrapper\.has-horizontal-overflow > \.identity-content\s*\{[^}]*margin-inline:\s*0/,
  );
  assert.equal(
    Math.round(
      (longAnimation.keyframes[1].offset - longAnimation.keyframes[0].offset) *
        longAnimation.options.duration,
    ),
    1000,
  );
  assert.equal(
    Math.round(
      (longAnimation.keyframes[3].offset - longAnimation.keyframes[2].offset) *
        longAnimation.options.duration,
    ),
    1000,
  );
  assert.doesNotMatch(sandbox.renderIdentityRow({ song_name: '1' }, 0), / • /);
  assert.match(source, /\.identity-content-wrapper, \.storybook-info-viewport/);
  assert.match(source, /\.identity-content, \.storybook-info/);
});

test('identity queue keeps song and requester fields in one continuous stream', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) {
      callback();
    },
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(source, sandbox);

  const row = sandbox.renderIdentityRow(
    {
      song_name: '米粒bb万岁万万岁',
      requester_name: '很长的点歌人',
      requester_guard_level: 2,
      requester_medal_name: '灯牌',
      requester_medal_level: 26,
    },
    0,
  );
  assert.match(
    row,
    /identity-content-wrapper[\s\S]*identity-content[\s\S]*identity-song[\s\S]*identity-requester[\s\S]*identity-badge[\s\S]*identity-medal/,
  );
  assert.doesNotMatch(
    row,
    /identity-song-wrapper|identity-details-wrapper|identity-details/,
  );
  assert.match(
    row,
    /identity-requester">[^<]*<\/span>\s*<span class="identity-badge[^"]*">[^<]*<\/span>\s*<span class="identity-medal">[^<]*<\/span>\s*<\/span>\s*<\/span>/,
    'badge and medal stay inside the same fading scroll wrapper as the song and requester',
  );
  const contentWrapperRule = overlayStyles.match(
    /\.identity-content-wrapper\s*\{[^}]*\}/,
  )?.[0];
  const contentRule = overlayStyles.match(
    /\.identity-content\s*\{[^}]*\}/,
  )?.[0];
  assert.ok(contentWrapperRule);
  assert.ok(contentRule);
  assert.match(contentWrapperRule, /flex:\s*1 1 auto/);
  assert.match(contentWrapperRule, /overflow:\s*hidden/);
  assert.doesNotMatch(contentWrapperRule, /mask-image/);
  assert.match(contentRule, /display:\s*inline-flex/);
  assert.match(contentRule, /min-width:\s*max-content/);
  assert.match(contentRule, /gap:\s*max\(4px,\s*0\.3em\)/);
  assert.doesNotMatch(
    overlayStyles,
    /\.identity-song-wrapper|\.identity-details-wrapper|\.identity-details/,
  );
  assert.doesNotMatch(overlayStyles, /transform:\s*translateX\(-52px\)/);

  let longAnimation = null;
  const longContent = {
    scrollWidth: 300,
    animate(keyframes, options) {
      longAnimation = { keyframes, options };
    },
  };
  const shortContent = {
    scrollWidth: 90,
    animate() {
      assert.fail('fitting identity content must not animate');
    },
  };
  const containers = [
    { clientWidth: 100, querySelector: () => longContent },
    { clientWidth: 100, querySelector: () => shortContent },
  ];

  sandbox.scheduleIdentityContentScroll({ querySelectorAll: () => containers });

  assert.ok(longAnimation);
  assert.deepEqual(
    Array.from(longAnimation.keyframes, (frame) => frame.transform),
    [
      'translateX(0)',
      'translateX(0)',
      'translateX(-200px)',
      'translateX(-200px)',
      'translateX(0)',
    ],
  );
  assert.equal(
    Math.round(
      (longAnimation.keyframes[1].offset - longAnimation.keyframes[0].offset) *
        longAnimation.options.duration,
    ),
    1000,
  );
  assert.equal(
    Math.round(
      (longAnimation.keyframes[3].offset - longAnimation.keyframes[2].offset) *
        longAnimation.options.duration,
    ),
    1000,
  );
});

test('overtime toolbox panel loads its isolated controller and renders untrusted labels safely', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'),
    'utf8',
  );
  const source = readOvertimeAdminSource();
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'),
    'utf8',
  );

  assert.match(html, /id="overtimePanel"/);
  assert.match(html, /id="overtimeClockValue"/);
  assert.match(html, /id="overtimeRules"/);
  assert.match(html, /id="overtimeGiftPicker"/);
  assert.match(html, /id="overtimeRefreshGiftsBtn"/);
  assert.match(
    html,
    /id="overtimeServerGiftSearchBtn"[^>]*>\s*搜索服务器礼物\s*<\/button\s*>/,
  );
  assert.match(html, /id="overtimeGiftCatalogStatus"[^>]+role="status"/);
  assert.match(html, /id="overtimePreview"/);
  assert.match(entrySource, /import '\.\/overtime\.js';/);
  assert.match(styles, /@import url\('\.\/admin\/overtime\.css'\);/);
  assert.match(source, /\.textContent\s*=/);
  assert.doesNotMatch(source, /fetch\('\/img\/bilibili-gifts\.json'/);
  assert.match(source, /fetch\('\/api\/overtime\/gifts'/);
  assert.match(source, /\/api\/overtime\/gifts\/refresh/);
  assert.match(source, /\/api\/overtime\/gifts\/server\/search/);
  assert.doesNotMatch(source, /\/api\/overtime\/gifts\/local\/search/);
  assert.match(
    source,
    /catalogRoomLabel\(giftCatalogSnapshot, catalogLiveStatus\)/,
  );
  assert.match(source, /liveStatus\?\.ownerName/);
  assert.doesNotMatch(html, /选择“文字展板”可让礼物只展示自定义文字/);
  assert.doesNotMatch(source, /· 房间 /);
  assert.match(source, /minute:\s*'2-digit'/);
  assert.match(source, /当前未在售/);
  assert.match(
    source,
    /left\.catalogGroup - right\.catalogGroup[\s\S]*left\.catalogOrder - right\.catalogOrder[\s\S]*left\.rmb - right\.rmb/,
  );
  assert.match(
    source,
    /meta\.textContent = `ID \$\{gift\.id\} · ¥\$\{gift\.rmb\.toFixed\(2\)\}/,
  );
  assert.match(source, /\/api\/overtime\/rules/);
  assert.match(
    source,
    /ruleEditor\?\.setLimits\(\s*(?:serverLimits|limits)\s*\)/,
  );
  assert.match(source, /该下播了/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('overtime screen controls expose save state, visible errors, and a plain address copy action', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const utilitySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'utils.js'),
    'utf8',
  );

  assert.match(
    html,
    /id="overtimeSaveBackgroundBtn"[^>]*>\s*保存画面\s*<\/button\s*>/,
  );
  assert.match(
    html,
    /id="overtimeCopyOverlayBtn"[^>]*>\s*复制地址\s*<\/button\s*>/,
  );
  assert.match(
    source,
    /overtimeBackgroundPath.*addEventListener\('change', markBackgroundDirty\)/s,
  );
  assert.match(
    source,
    /overtimeBackgroundFit.*addEventListener\('change', markBackgroundDirty\)/s,
  );
  assert.match(source, /showError\(error\)/);
  assert.match(source, /保存中…/);
  assert.match(source, /copyText\(overlayUrl\(\)\)/);
  assert.match(source, /地址已复制/);
  assert.match(utilitySource, /export async function copyText\(text\)/);
  assert.match(utilitySource, /navigator\.clipboard\?\.writeText/);
  assert.match(utilitySource, /execCommand\('copy'\)/);
});

test('overtime controller delegates rule editing through a narrow module boundary', () => {
  const controller = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime.js'),
    'utf8',
  );
  const editor = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-rule-editor.js'),
    'utf8',
  );
  const statusView = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-status-view.js'),
    'utf8',
  );

  assert.match(
    controller,
    /import \{ createOvertimeRuleEditor \} from ["']\.\/overtime-rule-editor\.js["'];/,
  );
  assert.match(controller, /ruleEditor\.readRules\(\)/);
  assert.match(
    statusView,
    /getRuleEditor\(\)\?\.renderRules\(nextState\.rules\)/,
  );
  assert.doesNotMatch(controller, /function createRuleRow/);
  assert.match(
    editor,
    /readRules:\s*\(\)\s*=>\s*readRules\(root,\s*getLimits\(\)\)/,
  );
});

test('overtime gift rule actions keep adding obvious and saving stateful', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const overtimeStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'overtime.css'),
    'utf8',
  );

  assert.match(
    html,
    /id="overtimeAddGiftBtn"[\s\S]*?class="overtime-add-gift-action"/,
  );
  assert.match(
    html,
    /id="overtimeSaveRulesBtn"[^>]+disabled\s*>\s*✓ 已保存\s*<\/button\s*>/,
  );
  assert.match(html, /<h3\s*>\s*添加礼物\s*<\/h3\s*>/);
  assert.match(html, /placeholder="输入礼物名称或 ID"/);
  assert.match(html, /id="overtimeGiftSearch"[^>]+maxlength="100"/);
  assert.doesNotMatch(html, /按名称或礼物 ID 搜索本地目录/);
  assert.match(
    source,
    /createOvertimeRuleEditor\(byId\('overtimeRules'\), markRulesDirty\)/,
  );
  assert.match(source, /row\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(source, /toast\(`已添加 \$\{gift\.name\}`\)/);
  assert.match(overtimeStyles, /\.overtime-add-gift-action/);
  assert.match(overtimeStyles, /\.overtime-gift-search-row/);
  assert.match(overtimeStyles, /\.overtime-save-rules-action\.is-dirty/);
  assert.match(overtimeStyles, /--ot-action-add:\s*#6657c7/);
  assert.match(overtimeStyles, /--ot-action-save:\s*#147d73/);

  const stateStart = source.indexOf('function getRulesSaveButtonState');
  const stateEnd = source.indexOf('\nfunction syncRulesSaveButton', stateStart);
  const sandbox = {};
  vm.runInNewContext(
    `${source.slice(stateStart, stateEnd)}\nthis.getState = getRulesSaveButtonState;`,
    sandbox,
  );
  assert.equal(sandbox.getState(false, false).label, '✓ 已保存');
  assert.equal(sandbox.getState(false, false).disabled, true);
  assert.equal(sandbox.getState(true, false).label, '保存修改');
  assert.equal(sandbox.getState(true, false).disabled, false);
  assert.equal(sandbox.getState(true, true).label, '保存中…');
  assert.equal(sandbox.getState(true, true).disabled, true);
});

test('overtime initial duration is minute-based, selectable, and readable', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const overtimeStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'overtime.css'),
    'utf8',
  );

  assert.match(html, /id="overtimeInitialTime"[^>]+value="00:00"/);
  assert.match(html, /id="overtimeInitialHours"/);
  assert.match(html, /id="overtimeInitialMinutes"/);
  assert.doesNotMatch(html, /id="overtimeRemainingTime"/);
  assert.match(source, /remainingSeconds:\s*initialSeconds/);
  assert.match(source, /function parseInitialDuration/);
  assert.match(
    overtimeStyles,
    /\.overtime-actions button:disabled[\s\S]*?opacity:\s*1/,
  );
  assert.match(overtimeStyles, /\.overtime-manual-duration\s*>\s*span\s*\{/);
  assert.doesNotMatch(overtimeStyles, /\.overtime-manual-duration\s+span\s*\{/);

  const helperStart = source.indexOf('function parseInitialDuration');
  const helperEnd = source.indexOf('\n  function formatClock', helperStart);
  const sandbox = {};
  vm.runInNewContext(
    `const serverLimits = { maxSeconds: 315328464000, maxEffectFactor: 1000, maxRandomWeight: 100000, maxEnabledRules: 8 };\n` +
      'const getServerLimits = () => serverLimits;\n' +
      `${source.slice(helperStart, helperEnd)}\n` +
      'this.helpers = { parseInitialDuration, formatInitialDuration };',
    sandbox,
  );
  assert.equal(sandbox.helpers.parseInitialDuration('2:05'), 7500);
  assert.equal(sandbox.helpers.formatInitialDuration(7500), '02:05');
  assert.throws(
    () => sandbox.helpers.parseInitialDuration('02:05:30'),
    /HHH:MM/,
  );
  assert.throws(
    () => sandbox.helpers.parseInitialDuration('02:60'),
    /分钟必须小于 60/,
  );
});

test('overtime gift rules use novice-friendly structured controls', async () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const overtimeStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'overtime.css'),
    'utf8',
  );

  assert.doesNotMatch(
    html,
    /添加礼物后，选择[“"]直接改时间[”"]或[“"]随机抽结果[”"]/,
  );
  assert.match(source, /className = 'secondary overtime-rule-toggle'/);
  assert.match(source, /dataset\.ruleSummary/);
  assert.match(source, /body\.hidden = !expanded/);
  assert.match(source, /toggle\.setAttribute\('aria-expanded'/);
  assert.doesNotMatch(source, /这个礼物如何改变时间/);
  assert.doesNotMatch(source, /选择一种时间操作/);
  assert.match(source, /dataset\.ruleOperation/);
  for (const operation of ['add', 'subtract', 'multiply', 'divide', 'clear']) {
    assert.match(
      source,
      new RegExp(
        `createOperationOption\\(\\s*name\\s*,\\s*['"]${operation}['"]`,
      ),
    );
  }
  assert.match(
    source,
    /dataset\[`duration\$\{part\[0\]\.toUpperCase\(\)\}\$\{part\.slice\(1\)\}`\]/,
  );
  assert.match(source, /data-duration-\$\{part\}/);
  assert.match(source, /dataset\.randomOutcome/);
  assert.match(source, /dataset\.addOutcome/);
  assert.match(source, /系统会自动换算百分比/);
  assert.match(source, /function updateOutcomeProbabilities/);
  assert.doesNotMatch(source, /createElement\('textarea'\)/);
  assert.doesNotMatch(source, /应写成“\+00:05:00 \| 40”/);
  assert.match(overtimeStyles, /\.overtime-rule-mode-options/);
  assert.match(overtimeStyles, /\.overtime-rule-body/);
  assert.match(overtimeStyles, /\.overtime-rule-toggle/);
  assert.match(
    overtimeStyles,
    /\.overtime-rule-effect\s*\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/,
  );
  assert.match(overtimeStyles, /\.overtime-outcome-card/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-add/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-subtract/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-multiply/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-divide/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-clear/);

  const { readRules } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-rule-model.js'),
  );
  const durationRoot = (operation, hours, minutes, seconds, factor = 2) => {
    const root = {
      dataset: {
        giftId: 'gift-1',
        giftName: '测试礼物',
        imagePath: '',
      },
      querySelector(selector) {
        if (selector === '[data-rule-mode]:checked') return { value: 'fixed' };
        if (selector === '[data-rule-quantity-mode]:checked')
          return { value: 'group' };
        if (selector === '[data-rule-enabled]') return { checked: true };
        if (selector === '[data-effect-mode="fixed"]') return root;
        if (selector === '[data-rule-operation]:checked')
          return { value: operation };
        if (selector === '[data-effect-factor]') return { value: factor };
        if (selector === '[data-duration-hours]') return { value: hours };
        if (selector === '[data-duration-minutes]') return { value: minutes };
        if (selector === '[data-duration-seconds]') return { value: seconds };
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    return { querySelectorAll: () => [root] };
  };
  const readFixedEffect = (...args) =>
    readRules(durationRoot(...args), {
      maxEnabledRules: 8,
      minRandomOutcomes: 2,
      maxRandomOutcomes: 10,
      maxDisplayTextLength: 100,
    })[0].fixedEffect;
  assert.equal(
    JSON.stringify(readFixedEffect('add', '1', '2', '3')),
    JSON.stringify({ operation: 'add', value: 3723 }),
  );
  assert.equal(
    JSON.stringify(readFixedEffect('multiply', '', '', '', '8')),
    JSON.stringify({ operation: 'multiply', value: 8 }),
  );
  assert.equal(
    JSON.stringify(readFixedEffect('clear', '', '', '')),
    JSON.stringify({ operation: 'clear', value: 0 }),
  );
  assert.throws(() => readFixedEffect('divide', '', '', '', '1'), /倍数/);
  assert.equal(
    JSON.stringify(readFixedEffect('add', '999', '0', '0')),
    JSON.stringify({ operation: 'add', value: 999 * 3600 }),
  );

  const effectEditorSource = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'admin',
      'overtime-rule-effect-editor.js',
    ),
    'utf8',
  );
  const probabilityStart = effectEditorSource.indexOf(
    'function updateOutcomeProbabilities',
  );
  const probabilityEnd = effectEditorSource.indexOf(
    '\n  function setEffectMode',
    probabilityStart,
  );
  const probabilitySandbox = {};
  vm.runInNewContext(
    effectEditorSource.slice(probabilityStart, probabilityEnd) +
      '\nthis.updateOutcomeProbabilities = updateOutcomeProbabilities;',
    probabilitySandbox,
  );
  const badges = [{}, {}];
  const cards = ['40', '60'].map((weight, index) => ({
    querySelector(selector) {
      return selector === '[data-outcome-weight]'
        ? { value: weight }
        : badges[index];
    },
  }));
  probabilitySandbox.updateOutcomeProbabilities({
    querySelectorAll: () => cards,
  });
  assert.equal(badges[0].textContent, '约 40%');
  assert.equal(badges[1].textContent, '约 60%');
});

test('identity queue shows the actual room medal name for a requester without guard status', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(source, sandbox);

  const imillyRow = sandbox.renderIdentityRow(
    {
      song_name: '测试歌曲',
      requester_name: '点歌人',
      requester_guard_level: 0,
      requester_medal_name: 'imilly',
      requester_medal_level: 26,
    },
    0,
  );
  const otherRoomRow = sandbox.renderIdentityRow(
    {
      song_name: '测试歌曲',
      requester_name: '点歌人',
      requester_guard_level: 0,
      requester_medal_name: '其他灯牌',
      requester_medal_level: 12,
    },
    0,
  );

  assert.match(imillyRow, /identity-badge identity-fan">imilly</);
  assert.doesNotMatch(imillyRow, /舰长/);
  assert.match(otherRoomRow, /identity-badge identity-fan">其他灯牌</);
  assert.doesNotMatch(otherRoomRow, /imilly/);
});

test('overlay utility helpers preserve shared formatting behavior', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'overlay-utils.js'),
    'utf8',
  );
  const sandbox = {
    URLSearchParams,
    location: { search: '?quality=low' },
    window: {},
  };

  vm.runInNewContext(source, sandbox);
  const utils = sandbox.window.OverlayUtils;

  assert.equal(
    utils.escapeHtml('"quoted" & <tag>'),
    '&quot;quoted&quot; &amp; &lt;tag&gt;',
  );
  const rgb = utils.hexToRgb('#abc');
  assert.equal(rgb.r, 170);
  assert.equal(rgb.g, 187);
  assert.equal(rgb.b, 204);
  assert.equal(utils.hexToRgba('#123456', 2), 'rgba(18, 52, 86, 1)');
  assert.equal(
    utils.withMultilingualFallback('Noto Sans'),
    'Noto Sans, "Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif',
  );
  assert.equal(utils.scrollTravelSeconds(12, 800, 300), 32);
  assert.equal(
    utils.overlayLowPowerEnabled({ overlayLowPowerMode: 'false' }),
    true,
  );
});

test('identity rule text scrolls independently only when it overflows', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) {
      callback();
    },
    document: { addEventListener() {} },
  };
  vm.runInNewContext(source, sandbox);

  let longAnimation = null;
  const longClasses = new Set();
  const longText = {
    scrollWidth: 220,
    animate(keyframes, options) {
      longAnimation = { keyframes, options };
    },
  };
  const shortText = {
    scrollWidth: 90,
    animate() {
      assert.fail('short rule text must not animate');
    },
  };
  const longContainer = {
    clientWidth: 100,
    querySelector: () => longText,
    classList: {
      add(name) {
        longClasses.add(name);
      },
    },
  };
  const shortContainer = {
    clientWidth: 100,
    querySelector: () => shortText,
    classList: { add() {} },
  };

  sandbox.scheduleIdentityRuleScroll({
    querySelectorAll: () => [longContainer, shortContainer],
  });

  assert.ok(longAnimation);
  assert.equal(longAnimation.keyframes[1].transform, 'translateX(-120px)');
  assert.ok(longClasses.has('is-scrolling'));
  const pauseMilliseconds =
    (longAnimation.keyframes[2].offset - longAnimation.keyframes[1].offset) *
    longAnimation.options.duration;
  assert.ok(Math.abs(pauseMilliseconds - 1500) < 0.001);
});

test('classic queue uses calculated row height and sizes indexes with song text', () => {
  const overlaySource = readJsModuleBundle(
    'public',
    'js',
    'overlays',
    'queue.js',
  );
  const styles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const waitingRule = styles.match(/\.overlay-waiting\s*\{[\s\S]*?\n\}/)?.[0];
  const windowRule = styles.match(
    /\.classic-list-window\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const indexRule = styles.match(
    /\.overlay-waiting-row \.index\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(waitingRule, 'classic queue list styles should remain defined');
  assert.ok(windowRule, 'classic queue viewport styles should remain defined');
  assert.ok(indexRule, 'classic queue index styles should remain defined');
  assert.doesNotMatch(waitingRule, /--classic-row-height/);
  assert.doesNotMatch(windowRule, /--classic-row-height/);
  assert.match(
    indexRule,
    /font-size:\s*var\(--overlay-waiting-font-size,\s*13px\)/,
  );
  assert.match(overlaySource, /setTimeout\(relayoutQueue, 100\)/);
  assert.doesNotMatch(
    overlaySource,
    /overlayResizeTimer = setTimeout\(render, 100\)/,
  );
  assert.match(overlaySource, /data-loop-clone/);
  assert.match(styles, /--overlay-edge:\s*clamp\(0px,\s*2vmin,\s*16px\)/);
  assert.match(styles, /\.queue-classic\s*\{[\s\S]*?width:\s*405px/);
  assert.match(styles, /\.queue-identity\s*\{[\s\S]*?width:\s*430px/);
  assert.match(
    styles,
    /\.queue-classic\s*\{[\s\S]*?transform:\s*scale\(var\(--queue-panel-scale,\s*1\)\)/,
  );
  assert.match(
    styles,
    /\.queue-identity\s*\{[\s\S]*?transform:\s*scale\(min\(var\(--queue-panel-scale,\s*1\),\s*1\)\)/,
  );
  assert.doesNotMatch(styles, /queue-viewport-resized/);
});

test('queue resize helpers preserve real rows while rebuilding loop copies', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(source, sandbox);

  const removed = [];
  const realRow = {
    remove() {
      assert.fail('real queue rows must remain mounted');
    },
  };
  const cloneRows = [
    {
      remove() {
        removed.push('first');
      },
    },
    {
      remove() {
        removed.push('second');
      },
    },
  ];
  const list = {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-loop-clone="true"]');
      return cloneRows;
    },
    children: [realRow, ...cloneRows],
  };

  sandbox.removeQueueLoopClones(list);
  assert.deepEqual(removed, ['first', 'second']);
});

test('identity queue scrolls from actual overflow', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: {
      addEventListener() {},
      getElementById() {
        return { textContent: '' };
      },
      documentElement: {
        style: {
          setProperty(name, value) {
            styleValues.set(name, value);
          },
        },
      },
    },
  };
  vm.runInNewContext(source, sandbox);

  const classes = new Set(['identity-list', 'paused']);
  let duplicatedHtml = '';
  const list = {
    scrollHeight: 500,
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
    },
    insertAdjacentHTML(_position, html) {
      duplicatedHtml += html;
    },
  };

  assert.equal(
    sandbox.configureIdentityVerticalScroll(
      { clientHeight: 300 },
      list,
      {
        queueScrollMode: 'loop',
        queueScrollSpeed: '10',
        identityQueueScrollSpeed: '42',
      },
      '<div>rows</div>',
      4,
    ),
    true,
  );
  assert.equal(styleValues.get('--identity-loop-distance'), '504px');
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds({ identityQueueScrollSpeed: '42' }, 'identityQueueScrollSpeed'), 504, 300)}s`,
  );
  assert.equal(duplicatedHtml, '<div>rows</div>');
  assert.equal(classes.has('paused'), false);
  assert.equal(classes.has('scrolling'), true);

  const bounceClasses = new Set(['identity-list', 'paused']);
  const bounceList = {
    scrollHeight: 500,
    classList: {
      add(name) {
        bounceClasses.add(name);
      },
      remove(name) {
        bounceClasses.delete(name);
      },
    },
    insertAdjacentHTML() {
      assert.fail('bounce content must not be duplicated');
    },
  };
  assert.equal(
    sandbox.configureIdentityVerticalScroll(
      { clientHeight: 300 },
      bounceList,
      {
        queueScrollMode: 'bounce',
        queueScrollSpeed: '10',
        identityQueueScrollSpeed: '42',
      },
      '<div>rows</div>',
      4,
    ),
    true,
  );
  assert.equal(styleValues.get('--identity-bounce-distance'), '200px');
  const bounceTiming = sandbox.bounceScrollTiming(
    sandbox.scrollTravelSeconds(
      sandbox.queueScrollSeconds(
        { identityQueueScrollSpeed: '42' },
        'identityQueueScrollSpeed',
      ),
      200,
      300,
    ),
    sandbox.scrollTravelSeconds(3, 200, 300),
  );
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${bounceTiming.totalSeconds}s`,
  );
  assert.equal(bounceClasses.has('paused'), false);
  assert.equal(bounceClasses.has('scrolling-bounce'), true);

  const fittingList = {
    scrollHeight: 280,
    classList: { add() {}, remove() {} },
    insertAdjacentHTML() {
      assert.fail('fitting content must not be duplicated');
    },
  };
  assert.equal(
    sandbox.configureIdentityVerticalScroll(
      { clientHeight: 300 },
      fittingList,
      {},
      '',
      4,
    ),
    false,
  );

  const shortDistance = 200;
  const longDistance = 800;
  const shortSeconds = sandbox.scrollTravelSeconds(12, shortDistance, 300);
  const longSeconds = sandbox.scrollTravelSeconds(12, longDistance, 300);
  assert.ok(
    Math.abs(shortDistance / shortSeconds - longDistance / longSeconds) < 0.001,
  );
});
