'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}
