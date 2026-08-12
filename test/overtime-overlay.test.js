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
  const serverSource = read('src/server/http-utils.js');

  assert.match(serverSource, /\['\/overtime', 'pages\/overlays\/overtime\.html'\]/);
  assert.match(html, /id="overtimeMachine"/);
  assert.match(html, /id="overtimeBackground"/);
  assert.match(html, /id="overtimeClock"/);
  assert.match(html, /id="overtimeTickets"/);
  assert.match(html, /id="overtimeAdjustmentStage"/);
  assert.match(css, /container-type:\s*size/);
  assert.match(css, /cqmin/);
  assert.match(css, /@container[^\{]*\(max-height:\s*239px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /\.overtime-gift-guide/);
  assert.match(css, /\.overtime-ticket-effect/);
  assert.match(css, /\.overtime-ticket\.is-positive/);
  assert.match(css, /\.overtime-ticket\.is-negative/);
  assert.match(css, /\.overtime-ticket\.is-random/);
  assert.match(css, /\.overtime-machine\s*\{[\s\S]*?font-size:\s*2cqmin/);
  assert.match(css, /\.overtime-live-label\s*\{[\s\S]*?font-size:\s*1\.43em/);
  assert.match(css, /\.overtime-ticket-name\s*\{[\s\S]*?font-size:\s*1\.55em/);
  assert.match(css, /font:\s*800 1\.9em\/1/);
  assert.match(css, /repeat\(var\(--ticket-wide-columns/);
  assert.match(css, /repeat\(var\(--ticket-narrow-columns/);
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
  assert.equal(sandbox.describeRuleEffect({ mode: 'fixed', fixedSeconds: 300 }).verb, '加时');
  assert.equal(sandbox.describeRuleEffect({ mode: 'fixed', fixedSeconds: -90 }).value, '1分30秒');
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}
