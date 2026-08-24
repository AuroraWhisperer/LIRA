'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { addFrameProtectionHeaders } = require('../src/server/http-utils');

const ROOT_DIR = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');

test('cute clock overlay owns a fixed frameable route and complete assets', () => {
  const server = read('src', 'server', 'http-utils.js');
  assert.match(server, /\['\/clock',\s*'pages\/overlays\/clock\.html'\]/);

  for (const parts of [
    ['public', 'pages', 'overlays', 'clock.html'],
    ['public', 'css', 'overlays', 'clock.css'],
    ['public', 'js', 'overlays', 'clock.js']
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT_DIR, ...parts)));
  }

  const headers = new Map();
  addFrameProtectionHeaders({ setHeader(name, value) { headers.set(name, value); } }, '/clock');
  assert.equal(headers.has('Content-Security-Policy'), false);
  assert.equal(headers.has('X-Frame-Options'), false);
});

test('cute clock overlay exposes two distinct styles and safe time parameters', () => {
  const html = read('public', 'pages', 'overlays', 'clock.html');
  const css = read('public', 'css', 'overlays', 'clock.css');
  const script = read('public', 'js', 'overlays', 'clock.js');

  for (const id of ['clockCard', 'clockLabel', 'clockHours', 'clockMinutes', 'clockSeconds', 'clockDate', 'clockWeekday']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-clock-style="peach"/);
  assert.match(css, /\[data-clock-style='peach'\]/);
  assert.match(css, /\[data-clock-style='starlight'\]/);
  assert.match(css, /font-size:\s*clamp\(48px,\s*14vw,\s*78px\)/);
  assert.match(css, /font-size:\s*clamp\(11px,\s*2\.6vw,\s*15px\)/);
  assert.match(css, /font-size:\s*clamp\(13px,\s*3\.2vw,\s*18px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /background:\s*transparent/);
  assert.match(script, /new URLSearchParams\(location\.search\)/);
  assert.match(script, /new Set\(\['peach',\s*'starlight'\]\)/);
  assert.match(script, /booleanParameter\(params,\s*'date'/);
  assert.match(script, /booleanParameter\(params,\s*'seconds'/);
  assert.match(script, /params\.get\('format'\)/);
  assert.match(script, /params\.get\('label'\)/);
  assert.match(script, /Intl\.DateTimeFormat/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(script, /visibilitychange/);
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

  assert.match(panel, /<h2 class="ui-page-title">萌时钟<\/h2>/);
  assert.match(panel, /给直播画面添一块会呼吸的日期与时间小卡片/);
  for (const id of ['clockPreview', 'clockFixedUrl', 'clockCustomUrl', 'clockShowDate', 'clockShowSeconds', 'clockHourFormat', 'clockCustomLabel', 'clockCopyFixed', 'clockCopyCustom', 'clockOpenPreview']) {
    assert.match(panel, new RegExp(`id="${id}"`));
  }
  assert.match(panel, /data-clock-style-option="peach"/);
  assert.match(panel, /data-clock-style-option="starlight"/);
  assert.match(panel, />桃桃便签</);
  assert.match(panel, />星夜软糖</);
  assert.match(styles, /grid-template-columns:\s*minmax\(360px,\s*1\.15fr\)\s+minmax\(320px,\s*\.85fr\)/);
  assert.match(styles, /@media \(max-width:\s*980px\)/);
  assert.match(script, /params\.set\('style'/);
  assert.match(script, /params\.set\('date'/);
  assert.match(script, /params\.set\('seconds'/);
  assert.match(script, /params\.set\('format'/);
  assert.match(script, /params\.set\('label'/);
  assert.match(script, /copyText/);
  assert.match(script, /window\.open/);
});
