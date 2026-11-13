'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('sentence spacing accepts zero independently of wrapped line height and rejects invalid saved values', async () => {
  const { normalizeDesktopLyricSettings } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-settings.js'),
  );
  const patch = normalizeSettingsPatch({ desktopLyricLineGap: 0, desktopLyricLineHeight: '1.8' }, DEFAULT_SETTINGS);
  assert.equal(patch.values.desktopLyricLineGap, '0');
  const settings = normalizeDesktopLyricSettings(patch.values, DEFAULT_SETTINGS);
  assert.equal(settings.lineGap, 0);
  assert.equal(settings.lineHeight, 1.8);
  for (const desktopLyricLineGap of [121, 'wide']) {
    assert.ok(normalizeSettingsPatch({ desktopLyricLineGap }, DEFAULT_SETTINGS).error);
  }
});

test('desktop lyric relative controls display percentages without changing stored values', async () => {
  const listeners = new Map();
  const range = {
    value: '0.15',
    addEventListener(type, handler) {
      listeners.set(`range:${type}`, handler);
    },
  };
  const number = {
    value: '15',
    addEventListener(type, handler) {
      listeners.set(`number:${type}`, handler);
    },
  };
  const document = {
    getElementById(id) {
      return id === 'range' ? range : id === 'number' ? number : null;
    },
  };
  const { FormsService } = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'), {
    document,
    window: { AdminApp: {} },
  });
  const service = new FormsService();
  service.refreshParameterRanges = () => {};
  service.bindRangePair('range', 'number', 0, 1, 0.15, 100);

  range.value = '0.35';
  listeners.get('range:input')();
  assert.equal(number.value, '35');

  number.value = '80';
  listeners.get('number:input')();
  assert.equal(range.value, '0.8');

});

test('karaoke colors preserve explicit alpha and reuse the saved text color for unsung lyrics', async () => {
  const { normalizeDesktopLyricSettings } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-settings.js'),
  );
  const { applyDesktopLyricStyles } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-styles.js'),
  );
  const properties = new Map();
  const card = { style: { setProperty: (key, value) => properties.set(key, value) }, classList: { toggle() {} } };
  applyDesktopLyricStyles(card, normalizeDesktopLyricSettings({
    desktopLyricSungColor: '#12345680', desktopLyricTextColor: '#abcdef80',
  }, DEFAULT_SETTINGS));
  assert.equal(properties.get('--preview-sung-color'), '#12345680');
  assert.equal(properties.get('--preview-color'), '#abcdef80');
  assert.equal(properties.get('--preview-opacity'), '0.95', 'Global opacity stays independent of either color alpha.');
  applyDesktopLyricStyles(card, normalizeDesktopLyricSettings({
    desktopLyricSungColor: 'invalid',
  }, DEFAULT_SETTINGS));
  assert.equal(properties.get('--preview-sung-color'), '');
});
