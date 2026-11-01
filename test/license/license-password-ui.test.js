'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createLicensePage } = require('../helpers/license-page');

const ROOT = path.join(__dirname, '../..');

test('license password input stays masked without client-side truncation', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/pages/license.html'), 'utf8');
  const password = html.match(/<input\b[^>]*\sid=["']licensePassword["'][^>]*>/)?.[0];
  assert.ok(password);
  assert.match(password, /\stype=["']password["']/);
  assert.doesNotMatch(password, /\s(?:maxlength|minlength|pattern)\s*=/);
});

const VALID_PASSWORD = 'Abc123!?';

test('switching account entry mode clears credentials without changing the username', () => {
  const page = createLicensePage();
  const get = page.getElementById;
  get('licensePassword').value = VALID_PASSWORD;
  get('licenseRegisterMode').listeners.get('click')();
  assert.equal(get('licensePassword').value, '');
  assert.equal(get('licenseActivationCode').value, '');
  assert.equal(get('licenseAccountName').value, 'test-account');
});

test('license form submits the password unchanged and shows the server password rejection', async () => {
  const page = createLicensePage({ state: 'needs_activation', error: 'PASSWORD_BCRYPT_TRUNCATED' });
  page.getElementById('licensePassword').value = VALID_PASSWORD;
  await page.submit();
  assert.equal(page.submissions.length, 1);
  assert.equal(page.submissions[0].password, VALID_PASSWORD);
  assert.match(page.getElementById('licenseStatus').textContent, /72/);
});

test('password visibility toggles without changing or submitting the password', () => {
  const page = createLicensePage();
  const password = page.getElementById('licensePassword');
  const toggle = page.getElementById('licensePasswordToggle');
  password.value = ` ${VALID_PASSWORD} `;
  for (const type of ['text', 'password']) {
    toggle.listeners.get('click')();
    assert.equal(password.type, type);
    assert.equal(password.value, ` ${VALID_PASSWORD} `);
  }
  assert.equal(page.submissions.length, 0);
});

test('successful activation clears secrets and restores password masking', async () => {
  const page = createLicensePage({ ok: true, state: 'authorized' });
  const password = page.getElementById('licensePassword');
  const toggle = page.getElementById('licensePasswordToggle');
  password.value = VALID_PASSWORD;
  page.dispatchPasswordEvent('input');
  toggle.listeners.get('click')();
  await page.submit();
  assert.equal(password.value, '');
  assert.equal(page.getElementById('licenseActivationCode').value, '');
  assert.equal(password.type, 'password');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
});
