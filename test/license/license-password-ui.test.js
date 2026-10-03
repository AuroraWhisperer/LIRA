'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createLicensePage } = require('../helpers/license-page');

const ROOT = path.join(__dirname, '../..');

test('license page explains password rules and offers visibility without client-side truncation', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/pages/license.html'), 'utf8');
  const rules = html.match(/<lira-help\b[^>]*\stooltip-id=["']licensePasswordRules["'][^>]*>[\s\S]*?<\/lira-help>/)?.[0];
  assert.ok(rules);
  for (const rule of [/8[–-]64/, /大写/, /小写/, /数字/, /至少三类/]) assert.match(rules, rule);
  const password = html.match(/<input\b[^>]*\sid=["']licensePassword["'][^>]*>/)?.[0];
  assert.ok(password);
  assert.match(password, /\stype=["']password["']/);
  assert.match(password, /\saria-describedby=["']licensePasswordRules["']/);
  assert.doesNotMatch(password, /\s(?:maxlength|minlength|pattern)\s*=/);
  const toggle = html.match(/<button\b[^>]*\sid=["']licensePasswordToggle["'][^>]*>/)?.[0];
  assert.ok(toggle);
  assert.match(toggle, /\stype=["']button["']/);
  assert.match(toggle, /\saria-label=["'][^"']+["']/);
  assert.match(toggle, /\saria-pressed=["']false["']/);
  assert.match(toggle, /\saria-controls=["']licensePassword["']/);
  assert.match(html, /<[^>]+\sid=["']licensePasswordIcon["'][^>]*>/);
  const helpScript = html.match(/<script\b[^>]*\ssrc=["']\/js\/admin\/contextual-help\.js["'][^>]*>/)?.[0];
  assert.ok(helpScript);
  assert.match(helpScript, /\stype=["']module["']/);
});

const VALID_PASSWORD = 'Abc123!?';

for (const [name, value, submitted, message] of [
  ['empty password', '', false, '请输入密码。'],
  ['spaces and Unicode', '  歌手Aa1!😀  ', true, '用户名或密码错误。'],
]) {
  test(`license form preserves ${name} through input and failed submission`, async () => {
    const page = createLicensePage({ state: 'needs_activation', error: 'INVALID_CREDENTIALS' });
    const password = page.getElementById('licensePassword');
    assert.equal(page.dispatchPasswordEvent('beforeinput', { data: value }).defaultPrevented, false);
    password.value = value;
    page.dispatchPasswordEvent('input');
    page.dispatchPasswordEvent('compositionend');
    await page.submit();
    assert.equal(page.submissions.length, submitted ? 1 : 0);
    if (submitted) assert.equal(page.submissions[0].password, value);
    assert.equal(password.value, value);
    assert.equal(page.getElementById('licenseStatus').textContent, message);
  });
}

test('account entry switches labels and clears credentials without changing the username', () => {
  const page = createLicensePage();
  const get = page.getElementById;
  get('licensePassword').value = VALID_PASSWORD;
  get('licenseRegisterMode').listeners.get('click')();
  assert.equal(get('licenseHeading').textContent, '注册 LIRA');
  assert.equal(get('licenseCodeLabel').textContent, '注册激活码');
  assert.equal(get('licensePassword').getAttribute('autocomplete'), 'new-password');
  assert.equal(get('licensePassword').value, '');
  assert.equal(get('licenseActivationCode').value, '');
  assert.equal(get('licenseAccountName').value, 'test-account');
  get('licenseLoginMode').listeners.get('click')();
  assert.equal(get('licenseHeading').textContent, '登录 LIRA');
  assert.equal(get('licenseCodeLabel').textContent, '短效登录码');
  assert.equal(get('licensePassword').getAttribute('autocomplete'), 'current-password');
  assert.equal(get('licenseLoginMode').getAttribute('aria-pressed'), 'true');
});

for (const [error, message] of [
  ['PASSWORD_TOO_SHORT', '密码至少 8 个字符。'],
  ['PASSWORD_TOO_LONG', '密码不能超过 64 个字符。'],
  ['PASSWORD_CONTROL_CHARACTERS', '密码不能包含换行、控制字符或不可见格式字符。'],
  ['PASSWORD_COMPLEXITY', '密码不符合要求，请查看密码旁的说明。'],
  ['PASSWORD_BCRYPT_TRUNCATED', '密码的 UTF-8 编码不能超过 72 字节，请缩短密码。'],
  ['PASSWORD_WEAK', '密码过于常见或接近用户名，请更换。'],
]) {
  test(`license form preserves the server ${error} response`, async () => {
    const page = createLicensePage({ state: 'needs_activation', error });
    page.getElementById('licensePassword').value = VALID_PASSWORD;
    await page.submit();
    assert.equal(page.submissions.length, 1);
    assert.equal(page.submissions[0].password, VALID_PASSWORD);
    assert.equal(page.getElementById('licenseStatus').textContent, message);
  });
}

test('license form keeps existing account password checks on the server', async () => {
  const page = createLicensePage({
    state: 'needs_activation',
    error: 'INVALID_CREDENTIALS',
  });
  page.getElementById('licensePassword').value = VALID_PASSWORD;
  await page.submit();
  assert.equal(page.submissions.length, 1);
  assert.equal(page.submissions[0].password, VALID_PASSWORD);
  assert.equal(page.getElementById('licenseStatus').textContent, '用户名或密码错误。');
});

test('valid passwords are passed to activation unchanged', async () => {
  const page = createLicensePage({
    state: 'needs_activation',
    error: 'NETWORK_UNAVAILABLE',
  });
  page.getElementById('licensePassword').value = VALID_PASSWORD;
  await page.submit();
  assert.equal(page.submissions.length, 1);
  assert.equal(page.submissions[0].accountName, 'test-account');
  assert.equal(page.submissions[0].password, VALID_PASSWORD);
  assert.equal(page.submissions[0].activationCode, 'TEST-CODE');
});

test('a valid 64-character password is passed to activation unchanged', async () => {
  const page = createLicensePage({
    state: 'needs_activation',
    error: 'NETWORK_UNAVAILABLE',
  });
  const password = `Aa1!${'a'.repeat(60)}`;
  page.getElementById('licensePassword').value = password;
  await page.submit();
  assert.equal(password.length, 64);
  assert.equal(page.submissions.length, 1);
  assert.equal(page.submissions[0].password, password);
});

test('every printable ASCII punctuation character can satisfy the special-symbol rule', async () => {
  const punctuation = Array.from({ length: 94 }, (_, index) => String.fromCharCode(33 + index)).filter(
    (character) => !/[A-Za-z0-9]/.test(character),
  );
  assert.equal(punctuation.length, 32);

  for (const character of punctuation) {
    const page = createLicensePage({
      state: 'needs_activation',
      error: 'NETWORK_UNAVAILABLE',
    });
    const password = `Aa1${character}bcdef`;
    page.getElementById('licensePassword').value = password;
    await page.submit();
    assert.equal(page.submissions.length, 1, `ASCII punctuation ${JSON.stringify(character)} should be accepted`);
    assert.equal(page.submissions[0].password, password);
  }
});

test('password visibility toggles without changing or submitting the password', () => {
  const page = createLicensePage();
  const password = page.getElementById('licensePassword');
  const toggle = page.getElementById('licensePasswordToggle');
  password.value = ` ${VALID_PASSWORD} `;
  for (const [type, label, pressed] of [
    ['text', '隐藏密码', 'true'],
    ['password', '显示密码', 'false'],
  ]) {
    toggle.listeners.get('click')();
    assert.equal(password.type, type);
    assert.equal(password.value, ` ${VALID_PASSWORD} `);
    assert.equal(toggle.getAttribute('aria-label'), label);
    assert.equal(toggle.getAttribute('aria-pressed'), pressed);
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
