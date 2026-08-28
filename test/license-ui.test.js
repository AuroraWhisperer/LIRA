'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

test('license page is independent from existing onboarding and exposes only three inputs', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'license.html'), 'utf8');
  const inputs = [...html.matchAll(/<input\b/gi)];
  assert.equal(inputs.length, 3);
  assert.match(html, /id="licenseAccountName"/);
  assert.match(html, /id="licensePassword"/);
  assert.match(html, /id="licenseActivationCode"/);
  assert.match(html, /激活并进入 LIRA/);
  assert.doesNotMatch(html, /跳过/);
});

test('license renderer uses main-process bridge and clears secrets on success', () => {
  const script = fs.readFileSync(path.join(ROOT, 'public', 'js', 'license.js'), 'utf8');
  assert.match(script, /window\.liraLicense/);
  assert.match(script, /passwordInput\.value = ''/);
  assert.match(script, /codeInput\.value = ''/);
  assert.doesNotMatch(script, /api\.lir[a-z]+hub\.cn/);
  assert.doesNotMatch(script, /localStorage/);
});
