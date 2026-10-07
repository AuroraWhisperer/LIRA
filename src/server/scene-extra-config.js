'use strict';

const { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { getBackgroundAppearance } = require('../../public/js/shared/background-appearance.js');
const { validateGiftDisplaySettings } = require('../bilibili/gift/display-settings');

function normalizeSceneExtraConfig(type, config) {
  const fields = SCENE_EXTRA_COMPONENTS[type].fields;
  const invalid = () => Object.assign(new Error('组件展示参数无效。'), { code: 'INVALID_SCENE_CONFIG', statusCode: 400 });
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(config))
    || Object.keys(config).some((key) => !Object.hasOwn(fields, key))) throw invalid();
  const result = createSceneExtraDefaults(type);
  for (const [key, raw] of Object.entries(config)) {
    const field = fields[key];
    let value = raw;
    if (field.type === 'number') {
      if (!['string', 'number'].includes(typeof raw) || String(raw).trim() === '') throw invalid();
      value = Number(raw);
      if (!Number.isFinite(value) || value < field.min || value > field.max
        || Math.abs((value - field.min) / field.step - Math.round((value - field.min) / field.step)) > 0.000001) throw invalid();
    } else if (field.type === 'checkbox') {
      if (![true, false, 'true', 'false'].includes(raw)) throw invalid();
      value = raw === true || raw === 'true';
    } else if (typeof raw !== 'string') throw invalid();
    if (field.type === 'color' && !/^#[\da-f]{6}$/i.test(value)) throw invalid();
    if (field.type === 'select' && !Object.hasOwn(field.options, value)) throw invalid();
    if (['text', 'textarea'].includes(field.type) && (Array.from(value).length > field.maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) throw invalid();
    result[key] = typeof field.default === 'string' ? String(value) : value;
  }
  if (type === 'background') {
    if (result.inputBlack >= result.inputWhite || result.outputBlack >= result.outputWhite) throw invalid();
    result.colorProcessing = getBackgroundAppearance(config).colorProcessing;
  }
  if (type === 'gift-feed') {
    try { validateGiftDisplaySettings({ ...result, palette: 'bilibili-four', thresholds: [result.threshold1, result.threshold2, result.threshold3] }); }
    catch { throw invalid(); }
  }
  return result;
}

module.exports = { normalizeSceneExtraConfig };
