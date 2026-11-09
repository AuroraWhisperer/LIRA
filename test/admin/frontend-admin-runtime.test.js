'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('early theme preset references receive asynchronously loaded data', async () => {
  const config = { presets: { classic: { sample: { accent: '#123456' } }, songBoard: { sample: { fontSize: 28 } } } };
  const browserWindow = { AdminApp: {} };
  const themeModule = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'shared', 'theme.js'), {
    window: browserWindow,
    fetch: async () => ({ ok: true, json: async () => config }),
  });
  const earlyClassicPresets = themeModule.getAllClassicPresets();
  const earlySongBoardPresets = themeModule.getAllSongBoardPresets();

  assert.deepEqual(Object.keys(earlyClassicPresets), []);
  await themeModule.loadThemeConfig();
  assert.equal(themeModule.getAllClassicPresets(), earlyClassicPresets);
  assert.equal(themeModule.getAllSongBoardPresets(), earlySongBoardPresets);
  assert.deepEqual(JSON.parse(JSON.stringify(earlyClassicPresets)), config.presets.classic);
  assert.deepEqual(JSON.parse(JSON.stringify(earlySongBoardPresets)), config.presets.songBoard);
});

test('admin form refresh preserves the active edit and updates inactive fields', async () => {
  const edited = { value: '正在输入', dataset: {}, closest: () => null };
  const inactive = { value: '旧值', dataset: {}, closest: () => null };
  const guardThanksAuroraTextMode = { value: 'en', dataset: {},
    closest: selector => selector.split(',').some(part => part.trim() === '#guardThanksPanel') ? {} : null };
  const desktopLyricFontSize = { value: '64', dataset: {},
    closest: selector => selector.split(',').some(part => part.trim() === '#desktopLyricForm') ? {} : null };
  const document = {
    activeElement: edited,
    getElementById: (id) => ({ edited, inactive, guardThanksAuroraTextMode, desktopLyricFontSize })[id] || null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const { FormsService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/forms.js'), {
    document,
    window: { AdminApp: {} },
  });
  new FormsService().fillForm({ edited: '服务端值', inactive: '新值', guardThanksAuroraTextMode: '', desktopLyricFontSize: '56' });
  assert.equal(edited.value, '正在输入');
  assert.equal(inactive.value, '新值');
  assert.equal(guardThanksAuroraTextMode.value, 'en', 'generic hydration cannot replace resolved legacy guard settings with empty storage values');
  assert.equal(desktopLyricFontSize.value, '64', 'generic hydration cannot overwrite the lyric owner draft after a settings broadcast');
});
