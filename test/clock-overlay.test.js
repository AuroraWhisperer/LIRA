'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { handleApi } = require('../src/server/api-routes');
const {
  CLOCK_STYLE_VALUES,
  DEFAULT_LABELS,
  cleanClockLabel,
  getClockConfig,
} = require('../src/server/clock-contract');
const { addFrameProtectionHeaders } = require('../src/server/http-utils');
const clockRoutes = require('../src/server/routes/clock-routes');
const settingsRoutes = require('../src/server/routes/settings-routes');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');
const CLOCK_ENTRY = path.join(ROOT_DIR, 'public', 'js', 'overlays', 'clock.js');
const CLOCK_CARD_ENTRY = path.join(
  ROOT_DIR,
  'public',
  'js',
  'admin',
  'clock-card.js',
);
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');

test('cute clock overlay owns a fixed frameable route and complete assets', () => {
  const server = read('src', 'server', 'http-utils.js');
  assert.match(server, /\['\/clock',\s*'pages\/overlays\/clock\.html'\]/);

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
  assert.equal(headers.has('Content-Security-Policy'), false);
  assert.equal(headers.has('X-Frame-Options'), false);
});

test('cute clock overlay exposes six distinct styles and safe time parameters', () => {
  const html = read('public', 'pages', 'overlays', 'clock.html');
  const css = read('public', 'css', 'overlays', 'clock.css');
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
  assert.match(css, /\[data-clock-style='peach'\]/);
  assert.match(css, /\[data-clock-style='starlight'\]/);
  assert.match(css, /\[data-clock-style='soda'\]/);
  assert.match(css, /\[data-clock-style='timeline-horizontal'\]/);
  assert.match(css, /\[data-clock-style='timeline-vertical'\]/);
  assert.match(css, /\[data-clock-style='digital'\]/);
  assert.match(css, /width:\s*560px/);
  assert.match(css, /height:\s*190px/);
  assert.match(css, /width:\s*220px/);
  assert.match(css, /height:\s*380px/);
  assert.match(css, /background:\s*transparent/);
  assert.match(css, /transform:\s*scale\(var\(--clock-scale,\s*1\)\)/);
  assert.match(
    css,
    /\.clock-seconds\s*\{[\s\S]*?display:\s*inline-grid[\s\S]*?text-shadow:\s*none/,
  );
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /background:\s*transparent/);
  assert.doesNotMatch(
    css,
    /timeline-vertical'\]\s*#clockDate\s*\{\s*display:\s*none/,
  );
  assert.match(script, /new URLSearchParams\(location\.search\)/);
  assert.match(
    script,
    /new Set\(\[\s*'peach',\s*'starlight',\s*'soda',\s*'timeline-horizontal',\s*'timeline-vertical',\s*'digital',?\s*\]\)/,
  );
  assert.match(script, /booleanParameter\(params,\s*'date'/);
  assert.match(script, /booleanParameter\(params,\s*'seconds'/);
  assert.match(script, /params\.get\('format'\)/);
  assert.match(script, /params\.get\('label'\)/);
  assert.match(script, /fetch\('\/api\/clock\/config'/);
  assert.match(script, /mergeClockConfig/);
  assert.match(script, /Intl\.DateTimeFormat/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(script, /visibilitychange/);
});

test('clock overlay scales its complete design canvas without moving style artwork', async () => {
  const module = await loadModuleExports(CLOCK_ENTRY, { URLSearchParams });

  assert.deepEqual([...module.CLOCK_STYLE_VALUES], [...CLOCK_STYLE_VALUES]);
  assert.equal(module.clockScaleForViewport(580, 210), 1);
  assert.equal(module.clockScaleForViewport(300, 115), 0.5);
  assert.equal(module.clockScaleForViewport(1140, 400), 2);
  assert.equal(module.clockLayoutForStyle('timeline-horizontal').width, 560);
  assert.equal(module.clockLayoutForStyle('timeline-horizontal').height, 190);
  assert.equal(module.clockLayoutForStyle('timeline-vertical').width, 220);
  assert.equal(module.clockLayoutForStyle('timeline-vertical').height, 380);
  assert.equal(module.clockLayoutForStyle('digital').width, 560);
  assert.equal(module.clockLayoutForStyle('digital').height, 190);
  assert.equal(
    module.clockScaleForViewport(580, 210, 'timeline-horizontal'),
    1,
  );
  assert.equal(module.clockScaleForViewport(240, 400, 'timeline-vertical'), 1);
});

test('toolbox composes the named clock card with fixed URL and custom controls', () => {
  const shell = read('public', 'pages', 'admin', 'toolbox', 'shell-start.html');
  const panel = read('public', 'pages', 'admin', 'toolbox', 'clock.html');
  const styles = read('public', 'css', 'admin', 'other-features', 'clock.css');
  const styleEntry = read('public', 'css', 'admin', 'other-features.css');
  const script = read('public', 'js', 'admin', 'clock-card.js');
  const app = read('public', 'js', 'admin', 'app.js');
  const composition = read('src', 'server', 'admin-page.js');

  assert.match(shell, /data-other-feature="otherClockFeature"/);
  assert.match(shell, /<strong>萌时钟<\/strong>/);
  assert.match(shell, /<small>日期、星期和当前时间<\/small>/);
  assert.match(composition, /pages\/admin\/toolbox\/clock\.html/);
  assert.match(styleEntry, /other-features\/clock\.css/);
  assert.match(app, /import \{ initClockCard \} from '\.\/clock-card\.js'/);
  assert.match(app, /initClockCard\(\)/);

  assert.doesNotMatch(
    panel,
    /ui-page-(?:title|subtitle)|other-feature-page-header/,
  );
  for (const id of [
    'clockPreview',
    'clockRecommendedSize',
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
  assert.match(panel, /设置变化，网址不变/);
  assert.match(panel, /data-clock-style-option="peach"/);
  assert.match(panel, /data-clock-style-option="starlight"/);
  assert.match(panel, /data-clock-style-option="soda"/);
  assert.match(panel, /data-clock-style-option="timeline-horizontal"/);
  assert.match(panel, /data-clock-style-option="timeline-vertical"/);
  assert.match(panel, /data-clock-style-option="digital"/);
  assert.match(panel, />桃桃便签</);
  assert.match(panel, />星夜软糖</);
  assert.match(panel, />汽水小鸭</);
  assert.match(panel, />横向刻度</);
  assert.match(panel, />竖向刻度</);
  assert.match(panel, />白字数显</);
  assert.equal(
    panel.match(/data-clock-style-option="[^"]+"/g)?.length,
    CLOCK_STYLE_VALUES.size,
  );
  assert.match(panel, /is-timeline-horizontal/);
  assert.match(panel, /is-timeline-vertical/);
  assert.match(panel, /clockCustomLabelHelp/);
  assert.match(
    styles,
    /grid-template-columns:\s*minmax\(360px,\s*1\.15fr\)\s+minmax\(320px,\s*0?\.85fr\)/,
  );
  assert.match(styles, /@media \(max-width:\s*980px\)/);
  assert.match(script, /params\.set\('style'/);
  assert.match(script, /params\.set\('date'/);
  assert.match(script, /params\.set\('seconds'/);
  assert.match(script, /params\.set\('format'/);
  assert.match(script, /params\.set\('label'/);
  assert.match(
    script,
    /new Set\(\[\s*'peach',\s*'starlight',\s*'soda',\s*'timeline-horizontal',\s*'timeline-vertical',\s*'digital',?\s*\]\)/,
  );
  assert.match(script, /clockSettingsPayload/);
  assert.match(script, /fetch\(SETTINGS_ENDPOINT/);
  assert.match(script, /fetch\(CLOCK_CONFIG_ENDPOINT/);
  assert.match(script, /fixedUrlNode\.textContent\s*=\s*fixedUrl/);
  assert.match(script, /window\.open\(fixedUrl/);
  assert.doesNotMatch(script, /clockCustomUrl|clockCopyCustom/);
  assert.match(script, /copyText/);
  assert.match(script, /window\.open/);
  assert.match(script, /let hydrating = true/);
  assert.match(script, /button\.disabled = hydrating/);
  assert.match(
    script,
    /customLabel\.disabled\s*=\s*hydrating\s*\|\|\s*transparent/,
  );
  assert.match(script, /label:\s*customLabel\.value/);
  assert.doesNotMatch(script, /customLabel\.value\s*=\s*''/);
  assert.match(script, /此样式不显示/);
  assert.match(styles, /aspect-ratio:\s*240\s*\/\s*400/);
  assert.match(styles, /is-timeline-horizontal/);
  assert.match(styles, /is-timeline-vertical/);
});

test('clock settings are persisted through validated keys and exposed by a public read-only route', async () => {
  assert.deepEqual([...CLOCK_STYLE_VALUES], [
    'peach',
    'starlight',
    'soda',
    'timeline-horizontal',
    'timeline-vertical',
    'digital',
  ]);
  assert.deepEqual(
    Object.fromEntries(
      [...CLOCK_STYLE_VALUES].map((style) => [style, DEFAULT_LABELS[style]]),
    ),
    {
      peach: '今天也要闪闪发光',
      starlight: '今晚与星星一起值班',
      soda: '今天也要元气满满',
      'timeline-horizontal': '',
      'timeline-vertical': '',
      digital: '',
    },
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
      label: '今天也要闪闪发光',
    },
  );
  assert.deepEqual(getClockConfig({ clockStyle: 'soda' }), {
    style: 'soda',
    showDate: true,
    showSeconds: true,
    hourFormat: '24',
    label: '今天也要元气满满',
  });
  assert.deepEqual(getClockConfig({ clockStyle: 'timeline-vertical' }), {
    style: 'timeline-vertical',
    showDate: true,
    showSeconds: true,
    hourFormat: '24',
    label: '',
  });
  assert.deepEqual(getClockConfig({ clockStyle: 'digital' }), {
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
    {
      async body() {
        return {
          clockStyle: ' starlight ',
          clockShowDate: 0,
          clockShowSeconds: '1',
          clockHourFormat: 12,
          clockLabel: '\u0000  今晚   一起值班  ',
        };
      },
    },
    response,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(writes, [
    ['clockStyle', 'starlight'],
    ['clockShowDate', 'false'],
    ['clockShowSeconds', 'true'],
    ['clockHourFormat', '12'],
    ['clockLabel', '今晚 一起值班'],
  ]);
  assert.equal(configureCalls, 1);
  assert.deepEqual(getClockConfig(Object.fromEntries(writes)), {
    style: 'starlight',
    showDate: false,
    showSeconds: true,
    hourFormat: '12',
    label: '今晚 一起值班',
  });

  await clockRoutes.routes['GET /api/clock/config'](context, {}, response);
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.payload.data,
    getClockConfig(Object.fromEntries(writes)),
  );

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
    { method: 'GET', headers: {} },
    publicResponse,
    new URL('http://127.0.0.1:3000/api/clock/config'),
  );
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.payload.ok, true);
});

test('digital clock config round-trips through admin payload and fixed URL query overrides', async () => {
  const overlay = await loadModuleExports(CLOCK_ENTRY, { URLSearchParams });
  const admin = await loadModuleExports(CLOCK_CARD_ENTRY, { URL });
  const config = {
    style: 'digital',
    showDate: false,
    showSeconds: true,
    hourFormat: '12',
    label: '',
  };

  const payload = { ...admin.clockSettingsPayload(config) };
  assert.deepEqual(payload, {
    clockStyle: 'digital',
    clockShowDate: 'false',
    clockShowSeconds: 'true',
    clockHourFormat: '12',
    clockLabel: '',
  });
  assert.deepEqual(getClockConfig(payload), config);

  const fixedUrl = admin.buildClockUrl('http://127.0.0.1:3000/clock', config);
  const params = new URL(fixedUrl).searchParams;
  const queryConfig = overlay.readClockConfig(params);
  assert.deepEqual({ ...queryConfig }, {
    style: 'digital',
    showDate: false,
    showSeconds: true,
    hour12: true,
    label: '',
  });
  assert.deepEqual(
    {
      ...overlay.mergeClockConfig(config, queryConfig, params),
    },
    {
      style: 'digital',
      showDate: false,
      showSeconds: true,
      hour12: true,
      label: '',
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
  let merged = module.mergeClockConfig(
    saved,
    module.readClockConfig(params),
    params,
  );
  assert.deepEqual(
    { ...merged },
    {
      style: 'starlight',
      showDate: false,
      showSeconds: false,
      hour12: true,
      label: '自定义夜班',
    },
  );

  params = new URLSearchParams('style=peach&seconds=1');
  merged = module.mergeClockConfig(
    saved,
    module.readClockConfig(params),
    params,
  );
  assert.deepEqual(
    { ...merged },
    {
      style: 'peach',
      showDate: false,
      showSeconds: true,
      hour12: true,
      label: '今天也要闪闪发光',
    },
  );

  params = new URLSearchParams('label=');
  merged = module.mergeClockConfig(
    saved,
    module.readClockConfig(params),
    params,
  );
  assert.equal(merged.style, 'starlight');
  assert.equal(merged.label, '今晚与星星一起值班');
});

test('clock card keeps custom text that matches another style default', async () => {
  const module = await loadModuleExports(CLOCK_CARD_ENTRY);
  assert.equal(module.usesDefaultClockLabel('peach', '今天也要闪闪发光'), true);
  assert.equal(
    module.usesDefaultClockLabel('peach', '今晚与星星一起值班'),
    false,
  );
  assert.equal(
    module.usesDefaultClockLabel('starlight', '今晚与星星一起值班'),
    true,
  );
  assert.equal(module.usesDefaultClockLabel('timeline-horizontal', ''), true);
  assert.equal(module.usesDefaultClockLabel('digital', ''), true);
});
