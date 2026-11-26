'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const { loadModuleExports, loadModuleScope } = require('../helpers/frontend-modules');
const { createParameterDocument } = require('../helpers/parameter-dom');

const ROOT_DIR = path.join(__dirname, '../..');
const QUEUE_STYLE_SETTINGS = path.join(ROOT_DIR, 'public/js/shared/queue-style-settings.js');

test('queue reconnect renders new requests and visible identity changes once', async () => {
  let renders = 0;
  const sandbox = { window: {}, location: { search: '' }, URLSearchParams,
    document: { addEventListener() {} }, recordRender: () => renders++ };
  const evaluate = await loadModuleScope(path.join(ROOT_DIR, 'public/js/overlays/queue.js'), sandbox);
  evaluate('render = recordRender;');
  const applyState = evaluate('applyState');
  const item = { id: 1, song_name: '相同歌曲', requester_name: '相同观众', requester_guard_level: 0,
    requester_medal_level: 0, requester_medal_name: '' };
  const apply = (current, style = 'identity') => applyState({ queue: { current, waiting: [] }, settings: { overlayQueueStyle: style } });
  apply(item); apply(structuredClone(item));
  assert.equal(renders, 1, 'identical snapshots preserve playback');
  apply({ ...item, id: 2, requester_guard_level: 3, requester_medal_level: 21, requester_medal_name: '粉丝牌' });
  assert.equal(renders, 2, 'a missed remove/add redraws the same names with their latest identity');
  apply(item, 'classic');
  const before = renders;
  apply({ ...item, requester_medal_level: 30 }, 'classic');
  assert.equal(renders, before, 'classic ignores identity fields it does not display');
  apply({ ...item, is_live: true }, 'classic');
  assert.equal(renders, before + 1, 'LIVE updates even when the queue order stays the same');
  apply(item, 'classic');
  assert.equal(renders, before + 2, 'removing LIVE also updates the overlay');
});

test('queue opacity percentages survive snapshot and preset refresh without changing the saved scale', async (t) => {
  const document = createParameterDocument();
  const root = document.body;
  root.getElementById = document.getElementById;
  const { bindQueueTheme } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/queue-theme-view.js'), {
    document, window: {}, queueMicrotask,
  });
  const { createComponentConfigController } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/component-config-controller.js'));
  const controller = createComponentConfigController({ initial: { overlayQueueStyle: 'classic', themeOpacity: '0.48' } });
  const binding = bindQueueTheme(root, controller);
  t.after(() => binding.dispose());
  for (const [stored, displayed] of [['0.57', 57], ['0', 0]]) {
    controller.receive({ overlayQueueStyle: 'classic', themeOpacity: stored });
    assert.equal(document.getElementById('themeOpacity').value, stored);
    assert.equal(Number(document.getElementById('themeOpacityNumber').value), displayed);
    assert.equal(controller.getState().dirty, false, 'display conversion cannot edit the saved draft');
  }
  controller.edit({ themeOpacity: 0.85 });
  assert.equal(document.getElementById('themeOpacityNumber').value, '85');
  controller.edit({ themeOpacity: 0 });
  assert.equal(document.getElementById('themeOpacityNumber').value, '0');
  assert.equal(controller.getState().draft.themeOpacity, 0);
  const number = document.getElementById('themeOpacityNumber');
  number.value = '29';
  number.events.change();
  assert.equal(document.getElementById('themeOpacity').value, '0.29');
  assert.equal(number.value, '29', 'Committing a percentage keeps the number field on its integer step.');
});

test('queue theme controls retain legacy font and scroll units without rewriting the draft', async () => {
  const { queueThemeControlValues } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/queue-theme-config.js'));
  const settings = Object.freeze({ overlayQueueStyle: 'storybook', themeFontScale: '1.25',
    queueScrollSpeed: '125', storybookQueueFontSize: '42', storybookQueueScrollSpeed: '200' });
  const controls = queueThemeControlValues(settings);
  assert.equal(Number(controls.queueSongFontSize), 35);
  assert.equal(Number(controls.queueTitleFontSize), 38);
  assert.equal(Number(controls.identityQueueFontSize), 42);
  assert.equal(controls.queueScrollSpeed, '51');
  assert.equal(controls.identityQueueScrollSpeed, '100');
});

test('queue theme controls collect persistable fields for the selected style', async () => {
  const { OVERLAY_THEME_KEYS } = require('../../src/storage/theme-store');
  const { collectQueueTheme } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/queue-theme-config.js'));

  const values = {
    overlayQueueStyle: 'neon-vinyl',
    identityQueueFontSize: '41',
    illustratedQueueFontFamily: 'KaiTi',
    illustratedQueueFontWeight: '700',
    illustratedQueueUseCustomTextColor: 'true',
    illustratedQueueTextColor: '#123456',
    identityQueueScrollMode: 'loop',
    identityQueueScrollSpeed: '64',
  };
  const payload = collectQueueTheme({ getElementById: (id) => ({ value: values[id] ?? '' }) });
  const styleKeys = Object.keys(payload).filter((key) => key !== 'overlayQueueStyle');
  assert.equal(payload.overlayQueueStyle, 'neon-vinyl');
  assert.equal(payload.neonVinylQueueFontFamily, 'KaiTi');
  assert.equal(payload.neonVinylQueueScrollSpeed, '64');
  assert.ok(styleKeys.every((key) => key.startsWith('neonVinylQueue')), styleKeys.join(', '));
  for (const key of styleKeys) assert.ok(OVERLAY_THEME_KEYS.includes(key), `${key} must be a persisted theme key`);

  for (const style of ['classic', 'identity']) {
    const font = '"Custom Local"';
    values.overlayQueueStyle = style;
    values.overlayFontFamily = font;
    const collected = collectQueueTheme({ getElementById: (id) => ({ value: values[id] ?? '' }) });
    const key = style === 'identity' ? 'identityQueueFontFamily' : 'overlayFontFamily';
    const otherKey = style === 'identity' ? 'overlayFontFamily' : 'identityQueueFontFamily';
    assert.equal(collected[key], font, `${style} saves its selected font`);
    assert.equal(collected[otherKey], undefined, 'editing one style must not change the other font');
    assert.ok(OVERLAY_THEME_KEYS.includes(key));
    assert.equal(collected.illustratedQueueFontFamily, undefined, 'illustrated fonts remain independent');
  }
});

test('illustrated queue styles resolve their own settings and only write supplied fields', async () => {
  const { resolveQueueStyleSettings, queueStyleSettingsPayload } = await loadModuleExports(QUEUE_STYLE_SETTINGS);
  const settings = {
    identityQueueFontSize: '26',
    neonVinylQueueFontSize: '41',
    neonVinylQueueFontFamily: 'KaiTi, serif',
    neonVinylQueueScrollMode: 'loop',
    neonVinylQueueScrollSpeed: '64',
    cherryRibbonQueueFontSize: '22',
  };
  const neon = resolveQueueStyleSettings(settings, 'neon-vinyl');
  assert.equal(neon.identityQueueFontSize, '41');
  assert.equal(neon.illustratedQueueFontFamily, 'KaiTi, serif');
  assert.equal(neon.queueScrollMode, 'loop');
  assert.equal(neon.identityQueueScrollSpeed, '64');
  assert.equal(resolveQueueStyleSettings(settings, 'cherry-ribbon').identityQueueFontSize, '22');
  const payload = queueStyleSettingsPayload('neon-vinyl', { fontSize: '44', fontFamily: 'YouYuan', scrollSpeed: '71' });
  assert.deepEqual({ ...payload }, {
    neonVinylQueueFontSize: '44', neonVinylQueueFontFamily: 'YouYuan', neonVinylQueueScrollSpeed: '71',
  });
});

test('classic and identity resolve independent fonts while preserving old snapshots', async () => {
  const { resolveQueueStyleSettings } = await loadModuleExports(QUEUE_STYLE_SETTINGS);
  const settings = { overlayFontFamily: '"Lira Maiyuan"', identityQueueFontFamily: '"STKaiti"' };
  assert.equal(resolveQueueStyleSettings(settings, 'classic').overlayFontFamily, '"Lira Maiyuan"');
  assert.equal(resolveQueueStyleSettings(settings, 'identity').overlayFontFamily, '"STKaiti"');
  assert.equal(resolveQueueStyleSettings({ overlayFontFamily: 'KaiTi' }, 'identity').overlayFontFamily, 'KaiTi');
});
