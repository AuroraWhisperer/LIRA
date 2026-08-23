'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT_DIR = path.join(__dirname, '..');

test('overtime overlay has independent layers and responsive container scaling', () => {
  const html = read('public/pages/overlays/overtime.html');
  const css = read('public/css/overlays/overtime.css');
  const adminCss = read('public/css/admin/overtime.css');
  const serverSource = read('src/server/http-utils.js');

  assert.match(serverSource, /\['\/overtime', 'pages\/overlays\/overtime\.html'\]/);
  assert.match(html, /id="overtimeMachine"/);
  assert.match(html, /id="overtimeBackground"/);
  assert.match(html, /id="overtimeClock"/);
  assert.match(html, /id="overtimeTickets"/);
  assert.match(html, /id="overtimeAdjustmentStage"/);
  assert.match(css, /container-type:\s*size/);
  assert.match(css, /cqmin/);
  assert.match(css, /\.overtime-machine\s*\{[^}]*height:\s*100vh;\s*height:\s*100dvh;/);
  assert.match(css, /@container[^\{]*\(max-height:\s*239px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /\.overtime-gift-guide/);
  assert.match(css, /\.overtime-ticket-effect/);
  assert.match(css, /\.overtime-ticket\.is-positive/);
  assert.match(css, /\.overtime-ticket\.is-negative/);
  assert.match(css, /\.overtime-ticket\.is-random/);
  assert.match(css, /\.overtime-ticket\.is-display/);
  assert.match(css, /\.overtime-machine\s*\{[\s\S]*?font-size:\s*2cqmin/);
  assert.match(css, /\.overtime-live-label\s*\{[\s\S]*?font-size:\s*1\.43em/);
  assert.match(css, /\.overtime-ticket-name\s*\{[\s\S]*?font-size:\s*1\.55em/);
  assert.match(css, /font:\s*800 1\.9em\/1/);
  assert.match(css, /repeat\(var\(--ticket-wide-columns/);
  assert.match(css, /repeat\(var\(--ticket-narrow-columns/);
  assert.match(css, /\.overtime-clock\s*\{[\s\S]*?font:\s*700 8\.5em\/0\.9/);
  assert.doesNotMatch(css, /\.overtime-clock\.is-calendar\s*\{[^}]*font-size/);
  assert.doesNotMatch(css, /\.overtime-clock\.is-years/);
  assert.doesNotMatch(adminCss, /\.overtime-clock-value\.is-calendar\s*\{[^}]*font-size/);
  assert.doesNotMatch(adminCss, /\.overtime-clock-value\.is-years/);
  assert.doesNotMatch(css, /font-size:\s*clamp/);
});

test('overtime overlay anchors server time and only animates fresh revisioned adjustments', () => {
  const source = read('public/js/overlays/overtime.js');

  assert.match(source, /performance\.now\(\)/);
  assert.match(source, /serverNowMs/);
  assert.match(source, /payload\.type === 'snapshot'/);
  assert.match(source, /payload\.type === 'overtime:update'/);
  assert.match(source, /revision\s*<=\s*currentRevision/);
  assert.match(source, /MAX_ANIMATION_QUEUE\s*=\s*5/);
  assert.match(source, /按数量结算/);
  assert.match(source, /applicationCount/);
  assert.match(source, /quality.*low/);
  assert.doesNotMatch(source, /setInterval\([^,]+,\s*1000\s*\)/);
});

test('overtime overlay explains configured gift effects to viewers', () => {
  const html = read('public/pages/overlays/overtime.html');
  const source = read('public/js/overlays/overtime.js');

  assert.match(html, /id="overtimeGiftGuide"/);
  assert.match(html, /送礼加班表/);
  assert.match(html, /class="overtime-live-label">LIVE<\/strong>/);
  assert.match(html, /id="overtimeStatusText"/);
  assert.match(source, /time\.textContent = presentation\.value/);
  assert.match(source, /rule\?\.mode === 'display'/);
  assert.match(source, /adjustment\?\.mode === 'display'/);
  assert.match(source, /running:\s*''/);
  assert.match(source, /labels\[currentState\?\.status\]\s*\?\?\s*'连接中'/);
  assert.match(source, /Math\.min\(3, ticketCount\)/);
  assert.match(source, /Math\.min\(2, ticketCount\)/);
  assert.doesNotMatch(source, /rule\.mode === 'random' \? '随机'/);

  const helperStart = source.indexOf('function describeRuleEffect');
  const helperEnd = source.indexOf('\nfunction formatSignedSeconds', helperStart);
  const sandbox = {};
  vm.runInNewContext(
    `${source.slice(helperStart, helperEnd)}\nthis.describeRuleEffect = describeRuleEffect;`,
    sandbox
  );
  assert.equal(sandbox.describeRuleEffect({ mode: 'random' }).value, '盲盒');
  assert.equal(sandbox.describeRuleEffect({ mode: 'display', displayText: '谢谢支持' }).value, '谢谢支持');
  assert.equal(sandbox.describeRuleEffect({ mode: 'fixed', fixedSeconds: 300 }).verb, '加时');
  assert.equal(sandbox.describeRuleEffect({ mode: 'fixed', fixedSeconds: -90 }).value, '1分30秒');
  assert.equal(
    JSON.stringify(sandbox.describeRuleEffect({
      mode: 'fixed', fixedEffect: { operation: 'multiply', value: 8 }
    })),
    JSON.stringify({ modifier: 'is-multiply', verb: '时间', value: '×8' })
  );
  assert.equal(
    sandbox.describeRuleEffect({ mode: 'fixed', fixedEffect: { operation: 'clear', value: 0 } }).value,
    '清零'
  );
});

test('overtime clock uses bounded calendar tiers for large durations', () => {
  const source = read('public/js/overlays/overtime.js');
  const helperStart = source.indexOf('function formatClockDisplay(milliseconds, status)');
  const helperEnd = source.indexOf('\nfunction describeRuleEffect', helperStart);
  const sandbox = {};
  vm.runInNewContext(
    `${source.slice(helperStart, helperEnd)}\n` +
      'this.helpers = { formatClockDisplay, formatClock };',
    sandbox
  );

  assert.equal(sandbox.helpers.formatClock(23 * 60 * 60 * 1000 + 59_000), '23:00:59');
  assert.equal(sandbox.helpers.formatClock(24 * 60 * 60 * 1000), '1天 00:00');
  assert.equal(sandbox.helpers.formatClock(365 * 24 * 60 * 60 * 1000), '1年 0天 0小时');
  assert.equal(sandbox.helpers.formatClock(9_999 * 365 * 24 * 60 * 60 * 1000), '9999年 0天 0小时');
  assert.equal(sandbox.helpers.formatClockDisplay(0, 'paused'), '00:00:00');
  assert.equal(sandbox.helpers.formatClockDisplay(0, 'running'), '该下播了');
  assert.equal(sandbox.helpers.formatClockDisplay(0, 'finished'), '该下播了');
});

test('overtime clock updates on display boundaries only while active and visible', () => {
  const source = read('public/js/overlays/overtime.js');

  assert.doesNotMatch(source, /requestAnimationFrame\(renderClockFrame\)/);
  assert.match(source, /clockTimer = setTimeout\(renderClock, nextClockDelay\(remainingMs\)\)/);
  assert.match(source, /currentState\.status !== 'running' \|\| remainingMs <= 0 \|\| document\.hidden/);
  assert.match(source, /if \(value !== lastClockValue\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange', syncClock\)/);

  const helperStart = source.indexOf('function nextClockDelay(remainingMs)');
  const helperEnd = source.indexOf('\nfunction formatClockDisplay', helperStart);
  const sandbox = {};
  vm.runInNewContext(
    `${source.slice(helperStart, helperEnd)}\nthis.nextClockDelay = nextClockDelay;`,
    sandbox
  );
  assert.equal(sandbox.nextClockDelay(5_001), 25);
  assert.equal(sandbox.nextClockDelay(5_500), 500);
  assert.equal(sandbox.nextClockDelay(24 * 60 * 60 * 1000), 1000);
  assert.equal(sandbox.nextClockDelay(24 * 60 * 60 * 1000 + 30_000), 30_000);
  assert.equal(sandbox.nextClockDelay(365 * 24 * 60 * 60 * 1000), 1000);
  assert.equal(sandbox.nextClockDelay(365 * 24 * 60 * 60 * 1000 + 90_000), 90_000);
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}
