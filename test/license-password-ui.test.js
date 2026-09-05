'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'public/js/license.js'), 'utf8');

function createLicensePage(result = { state: 'needs_activation' }) {
  const elements = new Map();
  const submissions = [];
  function getElementById(id) {
    if (!elements.has(id)) {
      const attributes = new Map();
      elements.set(id, {
        value: '',
        type: id === 'licensePassword' ? 'password' : '',
        textContent: '',
        listeners: new Map(),
        addEventListener(event, listener) {
          this.listeners.set(event, listener);
        },
        setAttribute(name, value) {
          attributes.set(name, value);
        },
        getAttribute(name) {
          return attributes.get(name);
        },
      });
    }
    return elements.get(id);
  }
  vm.runInNewContext(SCRIPT, {
    document: { getElementById },
    window: {
      liraLicense: {
        async activate(input) {
          submissions.push(input);
          return result;
        },
      },
      addEventListener() {},
    },
  });
  getElementById('licenseAccountName').value = 'test-account';
  getElementById('licenseActivationCode').value = 'TEST-CODE';
  return {
    getElementById,
    submissions,
    submit: () => getElementById('licenseForm').listeners.get('submit')({
      preventDefault() {},
    }),
  };
}

test('license page offers password visibility without the storage footnote', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/pages/license.html'), 'utf8');
  assert.match(html, /placeholder="8–64 个字符"/);
  assert.match(html, /id="licensePasswordToggle"[^>]*type="button"[^>]*aria-label="显示密码"[^>]*aria-pressed="false"/s);
  assert.match(html, /id="licensePasswordIcon"[^>]*href="\/img\/shared\/password-visibility\.svg#eye"/s);
  assert.doesNotMatch(html, /密码和激活密钥不会保存在本机。/);
});

for (const [password, error, message] of [
  ['123123', 'PASSWORD_TOO_SHORT', '密码至少 8 个字符。'],
  ['A'.repeat(65), 'PASSWORD_TOO_LONG', '密码不能超过 64 个字符。'],
  ['123123123', 'PASSWORD_COMPLEXITY', '密码需包含大写字母、小写字母、数字、特殊符号、中文等无大小写字母中的至少三类。'],
  ['Abc123!\n中', 'PASSWORD_CONTROL_CHARACTERS', '密码不能包含换行、控制字符或不可见格式字符。'],
  [`Ab1!${'中'.repeat(23)}`, 'PASSWORD_BCRYPT_TRUNCATED', '密码的 UTF-8 编码不能超过 72 字节，请缩短密码。'],
]) {
  test(`license form displays the specific ${error} response`, async () => {
    const page = createLicensePage({ state: 'needs_activation', error });
    page.getElementById('licensePassword').value = password;
    await page.submit();
    assert.equal(page.submissions.length, 1);
    assert.equal(page.submissions[0].password, password);
    assert.equal(page.getElementById('licenseStatus').textContent, message);
  });
}

test('license form distinguishes an empty password from a short password', async () => {
  const page = createLicensePage();
  await page.submit();
  assert.equal(page.getElementById('licenseStatus').textContent, '请输入密码。');
  page.getElementById('licensePassword').value = '123';
  await page.submit();
  assert.equal(page.getElementById('licenseStatus').textContent, '密码至少 8 个字符。');
  assert.equal(page.submissions.length, 0);
});

test('license form keeps existing account password checks on the server', async () => {
  const page = createLicensePage({ state: 'needs_activation', error: 'INVALID_CREDENTIALS' });
  page.getElementById('licensePassword').value = 'abc123';
  await page.submit();
  assert.equal(page.submissions.length, 1);
  assert.equal(page.getElementById('licenseStatus').textContent, '用户名或密码错误。');
});

test('password visibility toggles without changing or submitting the password', () => {
  const page = createLicensePage();
  const password = page.getElementById('licensePassword');
  const toggle = page.getElementById('licensePasswordToggle');
  const icon = page.getElementById('licensePasswordIcon');
  password.value = ' Abc123! ';
  for (const [type, label, pressed, iconName] of [
    ['text', '隐藏密码', 'true', 'eye-off'],
    ['password', '显示密码', 'false', 'eye'],
  ]) {
    toggle.listeners.get('click')();
    assert.equal(password.type, type);
    assert.equal(password.value, ' Abc123! ');
    assert.equal(toggle.getAttribute('aria-label'), label);
    assert.equal(toggle.title, label);
    assert.equal(toggle.getAttribute('aria-pressed'), pressed);
    assert.equal(icon.getAttribute('href'), `/img/shared/password-visibility.svg#${iconName}`);
  }
  assert.equal(page.submissions.length, 0);
});

test('successful activation clears secrets and restores password masking', async () => {
  const page = createLicensePage({ ok: true, state: 'authorized' });
  const password = page.getElementById('licensePassword');
  const toggle = page.getElementById('licensePasswordToggle');
  password.value = 'R7m!q2Za';
  toggle.listeners.get('click')();
  await page.submit();
  assert.equal(password.value, '');
  assert.equal(page.getElementById('licenseActivationCode').value, '');
  assert.equal(password.type, 'password');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
});
