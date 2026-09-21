'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { readCssBundle } = require('./helpers/css-bundle');
const { loadModuleExports } = require('./helpers/frontend-modules');
const {
  readJsModuleBundle: readRawJsModuleBundle,
} = require('./helpers/js-module-bundle');

const ROOT_DIR = path.join(__dirname, '..');
const settingsStoreModule = require('../src/storage/settings-store');

test('queue opacity percentages survive form refresh and preset sync without changing the saved scale', async () => {
  const fields = new Map(
    ['themeOpacity', 'themeOpacityNumber'].map((id) => [
      id,
      {
        _value: '0.48',
        get value() { return this._value; },
        set value(next) { this._value = String(next); },
        dataset: {},
        closest() {
          return null;
        },
      },
    ]),
  );
  const document = {
    getElementById: (id) => fields.get(id) || null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const window = { AdminApp: {} };
  const { FormsService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/admin/forms.js'),
    { document, window },
  );
  const service = new FormsService();
  for (const [stored, displayed] of [
    ['0.48', 48], ['0.57', 57], ['0', 0], ['1', 100],
  ]) {
    service.fillForm({ themeOpacity: stored });
    assert.equal(fields.get('themeOpacity').value, stored);
    assert.equal(Number(fields.get('themeOpacityNumber').value), displayed);
  }

  const { theme } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/admin/theme.js'),
    { document, window },
  );
  window.AdminApp = {};
  fields.get('themeOpacity').value = '0.85';
  for (const [stored, displayed] of [[0, '0'], ['0.48', '48'], [1, '100']]) {
    theme.syncAllRangeInputs({ themeOpacity: stored });
    assert.equal(fields.get('themeOpacityNumber').value, displayed);
  }
  theme.syncAllRangeInputs();
  assert.equal(fields.get('themeOpacityNumber').value, '85');
  assert.equal(theme.collectTheme().themeOpacity, '0.85');
});

function readJsModuleBundle(...relativeSegments) {
  return readRawJsModuleBundle(...relativeSegments).replace(
    /^\s*(?:export\s+)?\{\s*applyTheme,\s*setIdentityRuleThemeVars\s*\}\s+from\s+['"]\.\/queue-theme\.js['"];\s*/gm,
    '',
  );
}

test('admin queue style cards keep styles 1 and 2 neutral while styles 3-6 use themed palettes', () => {
  const styles = readCssBundle('public', 'css', 'admin', 'workspace.css');
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
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'overlay-utils.js'),
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
    fs.readFileSync(path.join(ROOT_DIR, 'public/js/admin/theme-style-view.js'), 'utf8'),
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
    assert.match(defaultsSource, new RegExp(`${prefix}QueueFontSize:\\s*'28'`));
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
    window: {},
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
  const sandbox = { window: {} };
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
    /scrollSpeed:\s*formsService\.normalizeQueueScrollSpeedForDisplay\(\s*value\(\s*['"]identityQueueScrollSpeed['"]\s*,?\s*\)\s*,?\s*\)/,
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
    /id="identityQueueFontSize"[^>]*min="9"[^>]*max="78"[^>]*value="28"/,
  );
  assert.match(
    html,
    /id="identityQueueFontSizeNumber"[^>]*min="9"[^>]*max="78"[^>]*value="28"/,
  );
  assert.match(formSource, /fontSize:\s*value\('identityQueueFontSize'\)/);
  assert.match(formsSource, /readQueueStyleSettings\(values, overlayStyle\)/);
  assert.match(defaultsSource, /identityQueueFontSize: '28'/);
  assert.match(
    overlaySource,
    /--identity-queue-font-size[\s\S]*?identityQueueFontSize\(\s*settings\s*\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-row\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*28px\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-pin-content\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*28px\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-row\.identity-sc \.identity-sc-content\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*28px\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-pin-row\s*\{[\s\S]*?height:\s*var\(--identity-row-height,\s*42px\)/,
  );
  assert.match(
    overlayStyles,
    /\.identity-pin-label\s*\{[\s\S]*?height:\s*1\.6em[\s\S]*?border-radius:\s*0\.3em[\s\S]*?padding:\s*0\s+0\.4em[\s\S]*?font-size:\s*calc\(var\(--identity-queue-font-size,\s*28px\)\s*\*\s*0\.77\)/,
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
