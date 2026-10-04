'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readAdminHtml } = require('../helpers/admin-html');
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
  const inputs = [...html.matchAll(/<input\b(?=[^>]*\sname="clientTheme")[^>]*>/g)].map(([tag]) => tag);
  assert.deepEqual(inputs.map((tag) => tag.match(/value="([^"]+)"/)[1]), CLIENT_THEMES.map(({ id }) => id));
  assert.deepEqual(inputs.filter((tag) => /\schecked(?:\s|>)/.test(tag)).map((tag) => tag.match(/value="([^"]+)"/)[1]), [DEFAULT_CLIENT_THEME_ID]);
  for (const { id, name } of CLIENT_THEMES) {
    assert.match(html, new RegExp(`<input\\b(?=[^>]*\\stype=["']radio["'])(?=[^>]*\\sname=["']clientTheme["'])(?=[^>]*\\svalue=["']${id}["'])[^>]*>`));
    assert.equal((html.match(new RegExp(`data-client-theme-preview="${id}"`, 'g')) || []).length, 1);
    assert.ok(html.includes(`<span>${name}</span>`));
  }
  assert.doesNotMatch(html, /\{\{client-theme-|<template data-client-theme-option>/);
  assert.match(html, /<[^>]+(?=[^>]*\sdata-client-theme-feedback(?:\s|>))(?=[^>]*\srole=["']status["'])(?=[^>]*\saria-live=["']polite["'])[^>]*>/);
});

test('appearance accepts a catalog option without a separate frontend allowlist', async () => {
  const themes = [...CLIENT_THEMES, { id: 'catalog-addition' }];
  const fixture = await createFixture({ themes, setClientTheme: (themeId) => ({ ok: true, themeId }) });
  await fixture.choose('catalog-addition');
  await fixture.applyButton.dispatch('click');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'catalog-addition');
  const restored = await createFixture({ themes, themeId: 'catalog-addition', setClientTheme: () => {} });
  assert.equal(restored.choices.find((choice) => choice.checked).value, 'catalog-addition');
});

test('new light and dark choices can be applied, restored and switched back to an existing theme', async () => {
  const fixture = await createFixture({ setClientTheme: (themeId) => ({ ok: true, themeId }) });
  for (const themeId of ['clear-jade', 'black-silver', 'rose-lustre', 'classic']) {
    await fixture.choose(themeId);
    await fixture.applyButton.dispatch('click');
    assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, themeId);
    assert.equal(fixture.labels.find((label) => !label.hidden).dataset.clientThemeCurrent, themeId);
    const restored = await createFixture({ themeId, setClientTheme: () => {} });
    assert.equal(restored.choices.find((choice) => choice.checked).value, themeId);
    assert.equal(restored.applyButton.disabled, true);
  }
});
