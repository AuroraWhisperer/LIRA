'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { CLIENT_THEMES, DEFAULT_CLIENT_THEME_ID } = require('../../src/shared/client-theme');

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

async function createFixture({ themeId = 'neutral', setClientTheme, themes = CLIENT_THEMES } = {}) {
  const choices = themes.map(({ id }) => element({ value: id, checked: false, defaultChecked: id === DEFAULT_CLIENT_THEME_ID }));
  const feedback = element();
  const panel = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    querySelectorAll() {
      return choices;
    },
    querySelector() {
      return feedback;
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

test('appearance choices save immediately and commit only after success, with one in-flight request', async () => {
  const requests = [];
  let complete;
  const fixture = await createFixture({
    setClientTheme(themeId) {
      requests.push(themeId);
      return new Promise((resolve) => { complete = resolve; });
    },
  });
  fixture.init();
  const applying = fixture.choose('terracotta');
  assert.deepEqual(requests, ['terracotta']);
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'neutral');
  await fixture.choose('classic');
  assert.deepEqual(requests, ['terracotta']);
  assert.equal(fixture.choices[2].checked, true);

  complete({ ok: true, themeId: 'terracotta' });
  await applying;
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'terracotta');
});

test('failed appearance writes restore the current selection and allow retry', async () => {
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
    assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'classic');
    assert.equal(fixture.choices[1].checked, true);
    await fixture.choose('terracotta');
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
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'future');
});

test('appearance controls without the desktop bridge cannot change the preference', async () => {
  const fixture = await createFixture({ themeId: 'classic' });
  await fixture.choose('terracotta');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'classic');
});

test('appearance accepts a catalog option without a separate frontend allowlist', async () => {
  const themes = [...CLIENT_THEMES, { id: 'catalog-addition' }];
  const fixture = await createFixture({ themes, setClientTheme: (themeId) => ({ ok: true, themeId }) });
  await fixture.choose('catalog-addition');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'catalog-addition');
  const restored = await createFixture({ themes, themeId: 'catalog-addition', setClientTheme: () => {} });
  assert.equal(restored.choices.find((choice) => choice.checked).value, 'catalog-addition');
  await fixture.choose('classic');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'classic');
});
