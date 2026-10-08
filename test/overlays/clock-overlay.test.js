'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { handleApi } = require('../../src/server/api-routes');
const {
  CLOCK_STYLE_VALUES,
  DEFAULT_LABELS,
  cleanClockLabel,
  getClockConfig,
  normalizeClockSettingValue,
} = require('../../src/server/clock-contract');
const { addFrameProtectionHeaders } = require('../../src/server/http-utils');
const clockRoutes = require('../../src/server/routes/clock-routes');
const settingsRoutes = require('../../src/server/routes/settings-routes');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { readCssBundle } = require('../helpers/css-bundle');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { assertClockRoundTrip } = require('../helpers/clock-round-trip');

const ROOT_DIR = path.join(__dirname, '../..');
const CLOCK_ENTRY = path.join(ROOT_DIR, 'public', 'js', 'overlays', 'clock.js');
const CLOCK_CARD_ENTRY = path.join(ROOT_DIR, 'public', 'js', 'admin', 'clock-card.js');
const FLIP_COLORS = { flipFrameColor: '#e4e4e4', flipFaceColor: '#ffffff', flipTextColor: '#303030' };
const MOON_DEFAULTS = { moonMode: 'light', moonIntervalSeconds: 30 };
const read = (...parts) => fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');

test('cute clock overlay owns a fixed frameable route and complete assets', () => {
  assert.equal(require('../../src/server/access-policy').getOverlayScope('/clock'), 'clock');

  for (const parts of [
    ['public', 'pages', 'overlays', 'clock.html'],
    ['public', 'css', 'overlays', 'clock.css'],
    ['public', 'js', 'overlays', 'clock.js'],
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT_DIR, ...parts)));
  }

  const headers = new Map();
  addFrameProtectionHeaders(
    {
      setHeader(name, value) {
        headers.set(name, value);
      },
    },
    '/clock',
  );
  assert.equal(headers.get('Content-Security-Policy'), 'sandbox allow-scripts');
  assert.equal(headers.has('X-Frame-Options'), false);
});

test('clock styles keep fixed base, named theme, and animation ownership', () => {
  const styleRoot = path.join(ROOT_DIR, 'public', 'css', 'overlays');
  const entry = fs.readFileSync(path.join(styleRoot, 'clock.css'), 'utf8');
  const expectedImports = [
    "@import url('./clock/base.css');",
    "@import url('./clock/peach.css');",
    "@import url('./clock/starlight.css');",
    "@import url('./clock/soda.css');",
    "@import url('./clock/timeline.css');",
    "@import url('./clock/digital.css');",
    "@import url('./clock/orbit.css');",
    "@import url('./clock/flip.css');",
    "@import url('./clock/moonlit-fan.css');",
    "@import url('./clock/animations.css');",
  ];
  assert.deepEqual(entry.match(/@import url\('[^']+'\);/g), expectedImports);

  const owners = Object.fromEntries(
    ['base', 'peach', 'starlight', 'soda', 'timeline', 'digital', 'orbit', 'flip', 'moonlit-fan', 'animations'].map((name) => [
      name,
      fs.readFileSync(path.join(styleRoot, 'clock', `${name}.css`), 'utf8'),
    ]),
  );

  assert.match(owners.base, /\.clock-card\s*\{/);
  assert.doesNotMatch(owners.base, /data-clock-style/);
  assert.match(owners.peach, /data-clock-style='peach'/);
  assert.doesNotMatch(owners.peach, /data-clock-style='starlight'/);
  assert.match(owners.starlight, /data-clock-style='starlight'/);
  assert.doesNotMatch(owners.starlight, /data-clock-style='soda'/);
  assert.match(owners.soda, /data-clock-style='soda'/);
  assert.doesNotMatch(owners.soda, /data-clock-style='timeline-horizontal'/);
  assert.match(owners.timeline, /data-clock-style='timeline-horizontal'/);
  assert.match(owners.timeline, /data-clock-style='timeline-vertical'/);
  assert.doesNotMatch(owners.timeline, /data-clock-style='digital'/);
  assert.match(owners.digital, /data-clock-style='digital'/);
  assert.match(owners.orbit, /data-clock-style='orbit'/);
  assert.match(owners.flip, /data-clock-style='flip'/);
  assert.match(owners['moonlit-fan'], /data-clock-style='moonlit-fan'/);
  assert.doesNotMatch(owners.digital, /@keyframes/);
  assert.match(owners.animations, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(owners.animations, /data-clock-style/);
});

test('cute clock overlay exposes nine distinct styles and safe time parameters', () => {
  const html = read('public', 'pages', 'overlays', 'clock.html');
  const css = readCssBundle('public', 'css', 'overlays', 'clock.css');
  const script = read('public', 'js', 'overlays', 'clock.js');

  for (const id of [
    'clockCard',
    'clockLabel',
    'clockYear',
    'clockHours',
    'clockTimeSeparator',
    'clockMinutes',
    'clockSeconds',
    'clockDate',
    'clockDateSeparator',
    'clockWeekday',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-clock-style="peach"/);
  assert.match(html, /id="clockCard"[^>]*\bhidden/);
  assert.match(css, /width:\s*560px/);
  assert.match(css, /height:\s*190px/);
  assert.match(css, /width:\s*220px/);
  assert.match(css, /height:\s*380px/);
  assert.match(css, /background:\s*transparent/);
  assert.match(css, /transform:\s*scale\(var\(--clock-scale,\s*1\)\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /timeline-vertical'\]\s*#clockDate\s*\{\s*display:\s*none/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
});

test('clock overlay scales content bounds with a narrow frame gutter', async () => {
  const module = await loadModuleExports(CLOCK_ENTRY, { URLSearchParams });

  assert.deepEqual([...module.CLOCK_STYLE_VALUES], [...CLOCK_STYLE_VALUES]);
  assert.equal(module.clockScaleForViewport(568, 198), 1);
  assert.equal(module.clockScaleForViewport(288, 103), 0.5);
  assert.equal(module.clockScaleForViewport(1128, 388), 2);
  assert.equal(module.clockScaleForViewport(916, 264, 'flip', { width: 454, height: 128 }), 2);
  assert.equal(module.clockLayoutForStyle('timeline-horizontal').width, 560);
  assert.equal(module.clockLayoutForStyle('timeline-horizontal').height, 190);
  assert.equal(module.clockLayoutForStyle('timeline-vertical').width, 220);
  assert.equal(module.clockLayoutForStyle('timeline-vertical').height, 380);
  assert.equal(module.clockLayoutForStyle('digital').width, 560);
  assert.equal(module.clockLayoutForStyle('digital').height, 190);
  assert.equal(module.clockLayoutForStyle('moonlit-fan').width, 560);
  assert.equal(module.clockLayoutForStyle('moonlit-fan').height, 360);
  assert.equal(module.clockScaleForViewport(288, 188, 'moonlit-fan'), 0.5);
  assert.equal(module.clockScaleForViewport(568, 198, 'timeline-horizontal'), 1);
  assert.equal(module.clockScaleForViewport(228, 388, 'timeline-vertical'), 1);
});

test('toolbox composes the named clock card with fixed URL and custom controls', () => {
  const shell = read('public', 'pages', 'admin', 'toolbox', 'shell-start.html');
  const panel = read('public', 'pages', 'admin', 'toolbox', 'clock.html');
  const styles = read('public', 'css', 'admin', 'toolbox', 'clock.css');
  const styleEntry = read('public', 'css', 'admin', 'toolbox.css');
  const script = read('public', 'js', 'admin', 'clock-card.js')
    + read('public', 'js', 'admin', 'clock-preview.js');
  const app = read('public', 'js', 'admin', 'app.js');
  const composition = read('src', 'server', 'admin-page.js');

  assert.match(shell, /data-other-feature="otherClockFeature"/);
  assert.match(composition, /pages\/admin\/toolbox\/clock\.html/);
  assert.match(styleEntry, /toolbox\/clock\.css/);
  assert.match(app, /import\('\.\/clock-card\.js'\)/);
  assert.match(app, /module\.initClockCard/);

  for (const id of [
    'clockPreview',
    'clockFixedUrl',
    'clockShowDate',
    'clockShowSeconds',
    'clockHourFormat',
    'clockCustomLabel',
    'clockCustomLabelHelp',
    'clockCopyFixed',
    'clockOpenPreview',
  ]) {
    assert.match(panel, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(panel, /clockCustomUrl|clockCopyCustom|带参数网址/);
  assert.doesNotMatch(panel + script, /clockRecommendedSize|推荐浏览器源/);
  const stylesAvailable = [...panel.matchAll(/\sdata-clock-style-option="([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual(stylesAvailable.sort(), [...CLOCK_STYLE_VALUES].filter(style => style !== 'moonlit-fan').sort());
  assert.match(panel, /clockCustomLabelHelp/);
  assert.match(script, /openComponentPreview/);
  assert.doesNotMatch(script, /clockCustomUrl|clockCopyCustom/);
  assert.match(script, /copyText/);
  assert.match(script, /button\.disabled = !loaded/);
  assert.match(script, /control\.disabled = !loaded/);
  assert.match(panel, /<label\b(?=[^>]*\sid="clockCustomLabelField")(?=[^>]*\sfor="clockCustomLabel")[^>]*>/);
  assert.match(styles, /aspect-ratio:\s*240\s*\/\s*400/);
});

test('clock settings are persisted through validated keys and exposed by the clock page read-only capability', async () => {
  assert.deepEqual(
    [...CLOCK_STYLE_VALUES],
    ['peach', 'starlight', 'soda', 'timeline-horizontal', 'timeline-vertical', 'digital', 'orbit', 'flip', 'moonlit-fan'],
  );
  assert.equal(DEFAULT_SETTINGS.clockStyle, 'peach');
  assert.equal(DEFAULT_SETTINGS.clockShowDate, 'true');
  assert.equal(DEFAULT_SETTINGS.clockShowSeconds, 'true');
  assert.equal(DEFAULT_SETTINGS.clockHourFormat, '24');
  assert.equal(cleanClockLabel('\u0000  今晚   一起值班  '), '今晚 一起值班');
  assert.equal(cleanClockLabel('abcdefghijklmnopq'), 'abcdefghijklmnop');
  assert.deepEqual(
    getClockConfig({
      clockStyle: 'space',
      clockShowDate: 'maybe',
      clockShowSeconds: 'maybe',
      clockHourFormat: '48',
      clockLabel: '',
    }),
    {
      style: 'peach',
      showDate: true,
      showSeconds: true,
      hourFormat: '24',
      label: DEFAULT_LABELS.peach,
      ...FLIP_COLORS, ...MOON_DEFAULTS,
    },
  );
  assert.deepEqual(getClockConfig({ clockStyle: 'soda' }), {
    ...FLIP_COLORS, ...MOON_DEFAULTS,
    style: 'soda',
    showDate: true,
    showSeconds: true,
    hourFormat: '24',
    label: DEFAULT_LABELS.soda,
  });
  assert.deepEqual(getClockConfig({ clockStyle: 'timeline-vertical' }), {
    ...FLIP_COLORS, ...MOON_DEFAULTS,
    style: 'timeline-vertical',
    showDate: true,
    showSeconds: true,
    hourFormat: '24',
    label: '',
  });
  assert.deepEqual(getClockConfig({ clockStyle: 'digital' }), {
    ...FLIP_COLORS, ...MOON_DEFAULTS,
    style: 'digital',
    showDate: true,
    showSeconds: true,
    hourFormat: '24',
    label: '',
  });

  const writes = [];
  let configureCalls = 0;
  const context = {
    settings: {
      defaults: DEFAULT_SETTINGS,
      get() {
        return Object.fromEntries(writes);
      },
      setMany(values) {
        writes.push(...Object.entries(values));
        return Object.keys(values);
      },
    },
    bilibili: {
      configure() {
        configureCalls += 1;
      },
    },
    broadcastSnapshot() {},
    system: {
      getState() {
        return { settings: {} };
      },
    },
  };
  const response = {
    writeHead(status) {
      this.status = status;
    },
    end(value) {
      this.payload = JSON.parse(value);
    },
  };

  await settingsRoutes.routes['POST /api/settings'](
    context,
    {
      async body() {
        return { clockStyle: 'space' };
      },
    },
    response,
  );
  assert.equal(response.status, 400);
  assert.deepEqual(writes, []);
  assert.equal(configureCalls, 0);

  await settingsRoutes.routes['POST /api/settings'](
    context,
    { async body() { return { clockStyle: 'flip', clockFlipFaceColor: 'url(invalid)' }; } },
    response,
  );
  assert.equal(response.status, 400);
  assert.deepEqual(writes, [], 'an invalid color rejects the whole settings patch');

  await settingsRoutes.routes['POST /api/settings'](
    context,
    {
      async body() {
        return {
          clockStyle: ' starlight ',
          clockShowDate: 0,
          clockShowSeconds: '1',
          clockHourFormat: 12,
          clockLabel: '\u0000  今晚   一起值班  ',
          clockFlipFrameColor: '#e4e4e4',
          clockFlipFaceColor: '#ffffff',
          clockFlipTextColor: '#123ABC',
        };
      },
    },
    response,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(writes.filter(([key]) => key !== 'clockStyleOptions'), [
    ['clockStyle', 'starlight'],
    ['clockShowDate', 'false'],
    ['clockShowSeconds', 'true'],
    ['clockHourFormat', '12'],
    ['clockLabel', '今晚 一起值班'],
    ['clockFlipFrameColor', '#e4e4e4'],
    ['clockFlipFaceColor', '#ffffff'],
    ['clockFlipTextColor', '#123abc'],
  ]);
  assert.equal(configureCalls, 1);
  const { styleOptions, ...activeClock } = getClockConfig(Object.fromEntries(writes));
  assert.equal(styleOptions.starlight.label, '今晚 一起值班');
  assert.equal(styleOptions.peach.label, DEFAULT_LABELS.peach);
  assert.deepEqual(activeClock, {
    ...FLIP_COLORS, ...MOON_DEFAULTS,
    style: 'starlight',
    showDate: false,
    showSeconds: true,
    hourFormat: '12',
    label: '今晚 一起值班',
    flipTextColor: '#123abc',
  });

  await clockRoutes.routes['GET /api/clock/config'](context, {}, response);
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.data, getClockConfig(Object.fromEntries(writes)));

  const publicResponse = {
    writeHead(status) {
      this.status = status;
    },
    end(value) {
      this.payload = JSON.parse(value);
    },
  };
  await handleApi(
    { ...context, sessionToken: 'required-token' },
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${require('../../src/server/access-policy').createOverlayToken('required-token', 'clock')}`,
      },
    },
    publicResponse,
    new URL('http://127.0.0.1:3000/api/clock/config'),
  );
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.payload.ok, true);
});

for (const style of ['digital', 'moonlit-fan']) test(`${style} clock config round-trips through admin payload and fixed URL query overrides`, async () => {
  const overlay = await loadModuleExports(CLOCK_ENTRY, { URLSearchParams });
  const admin = await loadModuleExports(CLOCK_CARD_ENTRY, { URL });
  const config = {
    ...FLIP_COLORS, ...MOON_DEFAULTS,
    style,
    showDate: false,
    showSeconds: true,
    hourFormat: '12',
    label: '',
  };

  const payload = { ...admin.clockSettingsPayload(config) };
  assert.deepEqual(payload, {
    clockStyle: style,
    clockShowDate: 'false',
    clockShowSeconds: 'true',
    clockHourFormat: '12',
    clockLabel: '',
    clockFlipFrameColor: '#e4e4e4',
    clockFlipFaceColor: '#ffffff',
    clockFlipTextColor: '#303030',
    clockMoonMode: 'light',
    clockMoonIntervalSeconds: '30',
  });
  assert.deepEqual(getClockConfig(payload), config);

  const { normalizeSceneConfig } = require('../../src/server/scene-components');
  assert.deepEqual(normalizeSceneConfig('clock', config), config);

  const fixedUrl = admin.buildClockUrl('http://127.0.0.1:3000/clock', config);
  const params = new URL(fixedUrl).searchParams;
  const queryConfig = overlay.readClockConfig(params);
  assert.deepEqual(
    { ...queryConfig },
    {
      style,
      showDate: false,
      showSeconds: true,
      hour12: true,
      label: '',
      ...FLIP_COLORS, ...MOON_DEFAULTS,
    },
  );
  assert.deepEqual(
    {
      ...overlay.mergeClockConfig(config, queryConfig, params),
    },
    {
      style,
      showDate: false,
      showSeconds: true,
      hour12: true,
      label: '',
      ...FLIP_COLORS, ...MOON_DEFAULTS,
    },
  );
});

test('clock overlay loads saved settings while explicit legacy parameters still override each field', async () => {
  const module = await loadModuleExports(CLOCK_ENTRY, { URLSearchParams });
  const saved = {
    style: 'starlight',
    showDate: false,
    showSeconds: false,
    hourFormat: '12',
    label: '自定义夜班',
  };

  let params = new URLSearchParams('');
  let merged = module.mergeClockConfig(saved, module.readClockConfig(params), params);
  assert.deepEqual(
    { ...merged },
    {
      style: 'starlight',
      showDate: false,
      showSeconds: false,
      hour12: true,
      label: '自定义夜班',
      ...FLIP_COLORS, ...MOON_DEFAULTS,
    },
  );

  params = new URLSearchParams('style=peach&seconds=1');
  merged = module.mergeClockConfig(saved, module.readClockConfig(params), params);
  assert.deepEqual(
    { ...merged },
    {
      style: 'peach',
      showDate: false,
      showSeconds: true,
      hour12: true,
      label: '今天也要闪闪发光',
      ...FLIP_COLORS, ...MOON_DEFAULTS,
    },
  );

  params = new URLSearchParams('label=');
  merged = module.mergeClockConfig(saved, module.readClockConfig(params), params);
  assert.equal(merged.style, 'starlight');
  assert.equal(merged.label, '今晚与星星一起值班');
});

test('clock URLs select their saved style profile before applying explicit overrides', async () => {
  const overlay = await loadModuleExports(CLOCK_ENTRY, { URLSearchParams });
  const saved = {
    style: 'starlight', showDate: true, showSeconds: true, label: '当前客户端样式',
    styleOptions: { peach: { showDate: false, showSeconds: false, hourFormat: '12', label: '', flipFaceColor: '#123456' } },
  };
  const params = new URLSearchParams('style=peach&seconds=1');
  const merged = overlay.mergeClockConfig(saved, overlay.readClockConfig(params), params);
  assert.equal(merged.style, 'peach');
  assert.equal(merged.showDate, false);
  assert.equal(merged.showSeconds, true);
  assert.equal(merged.hour12, true);
  assert.equal(merged.flipFaceColor, '#123456');
  assert.equal(merged.label, DEFAULT_LABELS.peach);
  saved.styleOptions.peach.label = '该样式的自定义文案';
  assert.equal(overlay.mergeClockConfig(saved, overlay.readClockConfig(params), params).label, '该样式的自定义文案');
});

test('clock card keeps custom text that matches another style default', async () => {
  const module = await loadModuleExports(CLOCK_CARD_ENTRY);
  assert.equal(module.usesDefaultClockLabel('peach', '今天也要闪闪发光'), true);
  assert.equal(module.usesDefaultClockLabel('peach', '今晚与星星一起值班'), false);
  assert.equal(module.usesDefaultClockLabel('starlight', '今晚与星星一起值班'), true);
  assert.equal(module.usesDefaultClockLabel('timeline-horizontal', ''), true);
  assert.equal(module.usesDefaultClockLabel('digital', ''), true);
});

test('flip colors are validated, persisted and exposed only through the clock projection', async () => {
  const admin = await loadModuleExports(CLOCK_CARD_ENTRY, { URL });
  const overlay = await loadModuleExports(CLOCK_ENTRY, { URLSearchParams });
  const config = { ...MOON_DEFAULTS, style: 'flip', showDate: true, showSeconds: true, hourFormat: '24', label: '',
    flipFrameColor: '#cb69e3', flipFaceColor: '#ffffff', flipTextColor: '#bc59d6' };
  assertClockRoundTrip(config);
  assert.equal(normalizeClockSettingValue('clockFlipTextColor', ' #ABCDEF '), '#abcdef');
  for (const bad of ['red', '#fff', '#abcdzz', 'url(https://example.test)', '', null]) {
    assert.equal(normalizeClockSettingValue('clockFlipFaceColor', bad), null);
  }
  const params = new URL(admin.buildClockUrl('http://127.0.0.1:3000/clock', config)).searchParams;
  assert.equal(overlay.readClockConfig(params).flipFrameColor, config.flipFrameColor);
  params.delete('flipFaceColor');
  params.set('flipTextColor', 'bad');
  const merged = overlay.mergeClockConfig({ ...config, flipFaceColor: '#123456' }, overlay.readClockConfig(params), params);
  assert.equal(merged.flipFrameColor, '#cb69e3');
  assert.equal(merged.flipFaceColor, '#123456');
  assert.equal(merged.flipTextColor, FLIP_COLORS.flipTextColor);
  assert.equal(getClockConfig({ clockStyle: 'orbit' }).style, 'orbit');
  assert.equal(getClockConfig({ clockStyle: 'flip', clockFlipFaceColor: 'invalid' }).flipFaceColor, '#ffffff');
});

test('moon palettes round-trip through settings, scene appearances and scoped overlay responses', async () => {
  const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
  const { normalizeSceneConfig } = require('../../src/server/scene-components');
  const admin = await loadModuleExports(CLOCK_CARD_ENTRY, { URL });
  const overlay = await loadModuleExports(CLOCK_ENTRY, { URLSearchParams });
  for (const mode of ['light', 'dark', 'auto']) {
    const config = { ...getClockConfig({ clockStyle: 'moonlit-fan' }), moonMode: mode, moonIntervalSeconds: 7 };
    assertClockRoundTrip(config);
    const params = new URL(admin.buildClockUrl('http://127.0.0.1:3000/clock', config)).searchParams;
    assert.equal(overlay.readClockConfig(params).moonMode, mode);
    assert.equal(overlay.readClockConfig(params).moonIntervalSeconds, 7);
  }
  for (const value of ['', 'night', true, null]) {
    assert.ok(normalizeSettingsPatch({ clockMoonMode: value }, DEFAULT_SETTINGS).error);
  }
  for (const value of ['', 0, -1, 1.5, 86401, 'NaN', true, null]) {
    assert.ok(normalizeSettingsPatch({ clockMoonIntervalSeconds: value }, DEFAULT_SETTINGS).error);
  }
  assert.equal(getClockConfig({ clockMoonMode: 'bad', clockMoonIntervalSeconds: 0 }).moonMode, 'light');
  assert.equal(getClockConfig({ clockMoonIntervalSeconds: 0 }).moonIntervalSeconds, 30);
  const legacy = { style: 'moonlit-fan', showDate: true, showSeconds: true, hourFormat: '24', label: '', ...FLIP_COLORS };
  assert.deepEqual(normalizeSceneConfig('clock', legacy), { ...legacy, ...MOON_DEFAULTS });
  assert.throws(() => normalizeSceneConfig('clock', { ...legacy, moonMode: 'bad' }), { code: 'INVALID_SCENE_CONFIG' });
  const params = new URLSearchParams('moonMode=dark');
  const merged = overlay.mergeClockConfig({ ...legacy, moonMode: 'auto', moonIntervalSeconds: 7 },
    overlay.readClockConfig(params), params);
  assert.equal(merged.moonMode, 'dark');
  assert.equal(merged.moonIntervalSeconds, 7);
});
