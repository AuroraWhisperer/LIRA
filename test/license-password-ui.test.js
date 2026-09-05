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
        className: '',
        hidden: false,
        disabled: false,
        dataset: {},
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
    dispatchPasswordEvent(type, event = {}) {
      const listener = getElementById('licensePassword').listeners.get(type);
      assert.ok(listener, `password input should listen for ${type}`);
      const dispatchedEvent = {
        isComposing: false,
        data: null,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...event,
      };
      listener(dispatchedEvent);
      return dispatchedEvent;
    },
  };
}

test('license page offers password visibility without the storage footnote', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/pages/license.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\/css\/styles-base\.css"\s*\/>/);
  assert.match(html, /<link rel="stylesheet" href="\/css\/components\/contextual-help\.css"\s*\/>/);
  assert.match(html, /<lira-help\s+label="密码规则"\s+tooltip-id="licensePasswordRules"[\s\S]*?>/);
  assert.match(html, /8[–-]64/);
  assert.match(html, /大写/);
  assert.match(html, /小写/);
  assert.match(html, /数字/);
  assert.match(html, /半角特殊符号/);
  assert.match(html, /中文[\u4e00-\u9fff、，\s]*空格/);
  assert.match(html, /<script type="module" src="\/js\/admin\/contextual-help\.js"><\/script>/);
  assert.match(html, /placeholder="8–64 个字符"/);
  assert.match(html, /id="licensePasswordToggle"[^>]*type="button"[^>]*aria-label="显示密码"[^>]*aria-pressed="false"/s);
  assert.match(html, /id="licensePasswordIcon"[^>]*href="\/img\/shared\/password-visibility\.svg#eye"/s);
  assert.doesNotMatch(html, /密码和激活密钥不会保存在本机。/);
});

const VALID_PASSWORD = 'Abc123!?';

for (const [error, message] of [
  ['PASSWORD_TOO_SHORT', '密码至少 8 个字符。'],
  ['PASSWORD_TOO_LONG', '密码不能超过 64 个字符。'],
  ['PASSWORD_CONTROL_CHARACTERS', '密码不能包含换行、控制字符或不可见格式字符。'],
  ['PASSWORD_COMPLEXITY', '密码不符合要求，请查看密码旁的说明。'],
  ['PASSWORD_BCRYPT_TRUNCATED', '密码的 UTF-8 编码不能超过 72 字节，请缩短密码。'],
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

for (const [password, message] of [
  ['Abc123!\n', '密码不能包含换行、控制字符或不可见格式字符。'],
  ['Abc123!\u200b', '密码不能包含换行、控制字符或不可见格式字符。'],
  ['Abc123! ', '密码不能包含空格。'],
  ['Abc123!中', '密码不能包含中文，请切换为英文输入。'],
  ['Abc123!é', '密码只能使用半角英文字母、数字和特殊符号。'],
  ['Abc123!', '密码至少 8 个字符。'],
  ['Abc123!?'.repeat(8) + 'A', '密码不能超过 64 个字符。'],
  ['abcdefgh', '密码缺少大写英文字母。'],
  ['ABCDEFGH', '密码缺少小写英文字母。'],
  ['Abcdefgh', '密码缺少数字。'],
  ['Abcdef12', '密码缺少特殊符号。'],
]) {
  test(`license form reports only the first password error: ${message}`, async () => {
    const page = createLicensePage();
    page.getElementById('licensePassword').value = password;
    await page.submit();
    assert.equal(page.submissions.length, 0);
    assert.equal(page.getElementById('licenseStatus').textContent, message);
  });
}

test('license form distinguishes an empty password from a short password', async () => {
  const page = createLicensePage();
  await page.submit();
  assert.equal(page.getElementById('licenseStatus').textContent, '请输入密码。');
  page.getElementById('licensePassword').value = 'Abc123!';
  await page.submit();
  assert.equal(page.getElementById('licenseStatus').textContent, '密码至少 8 个字符。');
  assert.equal(page.submissions.length, 0);
});

test('license form keeps existing account password checks on the server', async () => {
  const page = createLicensePage({ state: 'needs_activation', error: 'INVALID_CREDENTIALS' });
  page.getElementById('licensePassword').value = VALID_PASSWORD;
  await page.submit();
  assert.equal(page.submissions.length, 1);
  assert.equal(page.submissions[0].password, VALID_PASSWORD);
  assert.equal(page.getElementById('licenseStatus').textContent, '用户名或密码错误。');
});

test('valid passwords are passed to activation unchanged', async () => {
  const page = createLicensePage({ state: 'needs_activation', error: 'NETWORK_UNAVAILABLE' });
  page.getElementById('licensePassword').value = VALID_PASSWORD;
  await page.submit();
  assert.equal(page.submissions.length, 1);
  assert.equal(page.submissions[0].accountName, 'test-account');
  assert.equal(page.submissions[0].password, VALID_PASSWORD);
  assert.equal(page.submissions[0].activationCode, 'TEST-CODE');
});

test('a valid 64-character password is passed to activation unchanged', async () => {
  const page = createLicensePage({ state: 'needs_activation', error: 'NETWORK_UNAVAILABLE' });
  const password = `Aa1!${'a'.repeat(60)}`;
  page.getElementById('licensePassword').value = password;
  await page.submit();
  assert.equal(password.length, 64);
  assert.equal(page.submissions.length, 1);
  assert.equal(page.submissions[0].password, password);
});

test('every printable ASCII punctuation character can satisfy the special-symbol rule', async () => {
  const punctuation = Array.from({ length: 94 }, (_, index) =>
    String.fromCharCode(33 + index),
  ).filter((character) => !/[A-Za-z0-9]/.test(character));
  assert.equal(punctuation.length, 32);

  for (const character of punctuation) {
    const page = createLicensePage({
      state: 'needs_activation',
      error: 'NETWORK_UNAVAILABLE',
    });
    const password = `Aa1${character}bcdef`;
    page.getElementById('licensePassword').value = password;
    await page.submit();
    assert.equal(
      page.submissions.length,
      1,
      `ASCII punctuation ${JSON.stringify(character)} should be accepted`,
    );
    assert.equal(page.submissions[0].password, password);
  }
});

test('password input rejects invalid characters before insertion', () => {
  const page = createLicensePage();
  const event = page.dispatchPasswordEvent('beforeinput', { data: '中' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(page.getElementById('licenseStatus').textContent, '密码不能包含中文，请切换为英文输入。');

  const composingEvent = page.dispatchPasswordEvent('beforeinput', {
    data: '中',
    isComposing: true,
  });
  assert.equal(composingEvent.defaultPrevented, false);
});

test('password input restores the complete last accepted value after invalid edits', () => {
  const page = createLicensePage();
  const password = page.getElementById('licensePassword');
  password.value = VALID_PASSWORD;
  page.dispatchPasswordEvent('input');

  password.value = 'Abc123!中';
  page.dispatchPasswordEvent('input');
  assert.equal(password.value, VALID_PASSWORD);
  assert.equal(page.getElementById('licenseStatus').textContent, '密码不能包含中文，请切换为英文输入。');

  password.value = 'Abc123!中';
  page.dispatchPasswordEvent('input', { isComposing: true });
  assert.equal(password.value, 'Abc123!中');
  page.dispatchPasswordEvent('compositionend');
  assert.equal(password.value, VALID_PASSWORD);
});

test('password input saves each new valid value as the complete restore value', () => {
  const page = createLicensePage();
  const password = page.getElementById('licensePassword');
  password.value = VALID_PASSWORD;
  page.dispatchPasswordEvent('input');
  password.value = 'Xy9$abcd';
  page.dispatchPasswordEvent('input');

  password.value = 'Xy9$中cd';
  page.dispatchPasswordEvent('input');
  assert.equal(password.value, 'Xy9$abcd');
});

test('successful activation clears the last accepted password before clearing the field', async () => {
  const page = createLicensePage({ ok: true, state: 'authorized' });
  const password = page.getElementById('licensePassword');
  password.value = VALID_PASSWORD;
  page.dispatchPasswordEvent('input');
  await page.submit();
  password.value = 'Abc123!中';
  page.dispatchPasswordEvent('input');
  assert.equal(password.value, '');
});

test('password visibility toggles without changing or submitting the password', () => {
  const page = createLicensePage();
  const password = page.getElementById('licensePassword');
  const toggle = page.getElementById('licensePasswordToggle');
  const icon = page.getElementById('licensePasswordIcon');
  password.value = ` ${VALID_PASSWORD} `;
  for (const [type, label, pressed, iconName] of [
    ['text', '隐藏密码', 'true', 'eye-off'],
    ['password', '显示密码', 'false', 'eye'],
  ]) {
    toggle.listeners.get('click')();
    assert.equal(password.type, type);
    assert.equal(password.value, ` ${VALID_PASSWORD} `);
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
  password.value = VALID_PASSWORD;
  page.dispatchPasswordEvent('input');
  toggle.listeners.get('click')();
  await page.submit();
  assert.equal(password.value, '');
  assert.equal(page.getElementById('licenseActivationCode').value, '');
  assert.equal(password.type, 'password');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
});
