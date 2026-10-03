'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readAdminHtml } = require('../helpers/admin-html');

const MODULE_PATH = path.resolve(__dirname, '../../public/js/admin/client-appearance.js');

function element(properties = {}) {
  const listeners = new Map();
  return {
    disabled: false,
    hidden: false,
    textContent: '',
    ...properties,
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    async dispatch(type) {
      await Promise.all((listeners.get(type) || []).map((listener) => listener()));
    },
  };
}

async function createFixture({ themeId = 'neutral', setClientTheme } = {}) {
  const choices = ['neutral', 'classic', 'terracotta'].map((value) => element({ value, checked: false }));
  const labels = choices.map(({ value }) => element({ dataset: { clientThemeCurrent: value } }));
  const applyButton = element();
  const feedback = element();
  const panel = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    querySelectorAll(selector) {
      return selector === 'input[name="clientTheme"]' ? choices : labels;
    },
    querySelector(selector) {
      return selector === '[data-client-theme-apply]' ? applyButton : feedback;
    },
  };
  const documentRef = {
    documentElement: { dataset: { clientTheme: themeId } },
    getElementById: (id) => (id === 'clientAppearance' ? panel : null),
  };
  const { initClientAppearance } = await loadModuleExports(MODULE_PATH);
  const init = () => initClientAppearance({ documentRef, desktopBridge: { setClientTheme } });
  init();
  return {
    choices,
    labels,
    applyButton,
    feedback,
    panel,
    documentRef,
    init,
    async choose(theme) {
      const choice = choices.find(({ value }) => value === theme);
      choice.checked = true;
      await choice.dispatch('change');
    },
  };
}

test('appearance choices only commit after explicit apply succeeds, with one in-flight request', async () => {
  const requests = [];
  let complete;
  const fixture = await createFixture({
    setClientTheme(themeId) {
      requests.push(themeId);
      return new Promise((resolve) => { complete = resolve; });
    },
  });
  fixture.init();
  assert.equal(fixture.labels[0].hidden, false);
  assert.equal(fixture.applyButton.disabled, true);
  await fixture.choose('terracotta');
  assert.deepEqual(requests, []);
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'neutral');
  const applying = fixture.applyButton.dispatch('click');
  assert.deepEqual(requests, ['terracotta']);
  assert.equal(fixture.applyButton.disabled, true);
  assert.ok(fixture.choices.every(({ disabled }) => disabled));
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'neutral');
  await fixture.applyButton.dispatch('click');
  await fixture.choose('classic');
  assert.deepEqual(requests, ['terracotta']);
  assert.equal(fixture.choices[2].checked, true);

  complete({ ok: true, themeId: 'terracotta' });
  await applying;
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'terracotta');
  assert.equal(fixture.labels[0].hidden, true);
  assert.equal(fixture.labels[2].hidden, false);
  assert.equal(fixture.feedback.textContent, '配色已应用');
  assert.ok(fixture.choices.every(({ disabled }) => !disabled));
  assert.equal(fixture.applyButton.disabled, true);
});

test('failed appearance writes preserve the current theme and candidate and allow retry', async () => {
  for (const failure of [() => ({ ok: false }), () => Promise.reject(new Error('disk full'))]) {
    let attempt = 0;
    const fixture = await createFixture({
      themeId: 'classic',
      setClientTheme(themeId) {
        attempt += 1;
        return attempt === 1 ? failure() : { ok: true, themeId };
      },
    });
    await fixture.choose('terracotta');
    await fixture.applyButton.dispatch('click');
    assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'classic');
    assert.equal(fixture.labels[1].hidden, false);
    assert.equal(fixture.choices[2].checked, true);
    assert.equal(fixture.applyButton.disabled, false);
    assert.equal(fixture.feedback.textContent, '配色未保存，请重试');
    await fixture.applyButton.dispatch('click');
    assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'terracotta');
  }
});

test('unknown initial themes select the terracotta fallback and invalid responses do not apply', async () => {
  const fixture = await createFixture({
    themeId: 'future',
    setClientTheme: () => ({ ok: true, themeId: 'invalid' }),
  });
  assert.equal(fixture.choices[2].checked, true);
  await fixture.choose('classic');
  await fixture.applyButton.dispatch('click');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'future');
  assert.equal(fixture.feedback.textContent, '配色未保存，请重试');
});

test('appearance controls without the desktop bridge explain where to change the preference', async () => {
  const fixture = await createFixture({ themeId: 'classic' });
  assert.ok(fixture.choices.every(({ disabled }) => disabled));
  assert.equal(fixture.applyButton.disabled, true);
  assert.equal(fixture.labels[1].hidden, false);
  assert.equal(fixture.feedback.textContent, '请在桌面客户端设置配色。');
  await fixture.applyButton.dispatch('click');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'classic');
});

test('appearance markup provides the same previews, native radio controls and live feedback', () => {
  const html = readAdminHtml();
  for (const themeId of ['neutral', 'classic', 'terracotta']) {
    assert.match(html, new RegExp(`type="radio" name="clientTheme" value="${themeId}"`));
    assert.match(html, new RegExp(`data-client-theme-preview="${themeId}"`));
  }
  assert.match(html, /data-client-theme-feedback role="status" aria-live="polite"/);
  assert.match(html, /客户端立即生效，网页工具下次打开时跟随；直播画面保持原设置。/);
});
