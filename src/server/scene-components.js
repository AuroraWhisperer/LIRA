'use strict';

const { getClockConfig, normalizeClockSettingValue } = require('./clock-contract');
const { normalizeSettingsPatch } = require('./settings-contract');
const { projectOverlayState } = require('./overlay-projection');
const { validateBackground } = require('../overtime/overtime-contract');
const { DANMAKU_STYLE_OPTIONS, normalizeStyleOptions } = require('../shared/danmaku-style-options');
const { createLayout, normalizeLayout } = require('../shared/danmaku-layout');
const { DEFAULT_SETTINGS } = require('../storage/settings-store');
const { SceneError } = require('../scenes/scene-contract');

const CLOCK_KEYS = { style: 'clockStyle', showDate: 'clockShowDate', showSeconds: 'clockShowSeconds',
  hourFormat: 'clockHourFormat', label: 'clockLabel', flipFrameColor: 'clockFlipFrameColor',
  flipFaceColor: 'clockFlipFaceColor', flipTextColor: 'clockFlipTextColor' };
const QUEUE_DEFAULTS = projectOverlayState('queue', { settings: DEFAULT_SETTINGS }).settings;
const COMPONENT_TYPES = ['clock', 'queue', 'overtime', 'danmaku'];

function invalidConfig() {
  return Object.assign(new Error('场景外观参数无效。'), { code: 'INVALID_SCENE_CONFIG', statusCode: 400 });
}

function assertKeys(config, keys) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(config))
    || Object.keys(config).some((key) => !keys.includes(key))) throw invalidConfig();
}

function assertScalarValues(config) {
  if (Object.values(config).some((value) => !['string', 'number', 'boolean'].includes(typeof value)
    || typeof value === 'number' && !Number.isFinite(value))) throw invalidConfig();
}

function normalizeSceneConfig(type, config) {
  if (type === 'clock') {
    assertKeys(config, Object.keys(CLOCK_KEYS));
    assertScalarValues(config);
    const settings = {};
    for (const [field, key] of Object.entries(CLOCK_KEYS)) {
      if (!Object.hasOwn(config, field)) throw invalidConfig();
      const value = normalizeClockSettingValue(key, config[field]);
      if (value === null) throw invalidConfig();
      settings[key] = value;
    }
    return getClockConfig(settings);
  }
  if (type === 'queue') {
    assertKeys(config, Object.keys(QUEUE_DEFAULTS));
    assertScalarValues(config);
    if (config.overlayQueueStyle !== undefined &&
      !['classic', 'identity', 'festival', 'storybook', 'neon-vinyl', 'cherry-ribbon', 'golden-lily'].includes(config.overlayQueueStyle)) throw invalidConfig();
    const normalized = normalizeSettingsPatch(config, QUEUE_DEFAULTS);
    if (normalized.error) throw invalidConfig();
    return { ...QUEUE_DEFAULTS, ...normalized.values };
  }
  if (type === 'overtime') {
    assertKeys(config, ['path', 'fit']);
    if (typeof config.path !== 'string' || typeof config.fit !== 'string') throw invalidConfig();
    try { return validateBackground(config); } catch { throw invalidConfig(); }
  }
  if (type === 'danmaku') {
    assertKeys(config, ['style', 'fullscreenDurationSeconds', 'styleOptions', 'layout']);
    if (!Object.hasOwn(DANMAKU_STYLE_OPTIONS, config.style)
      || !Number.isInteger(config.fullscreenDurationSeconds)
      || config.fullscreenDurationSeconds < 2 || config.fullscreenDurationSeconds > 30) throw invalidConfig();
    try {
      return { style: config.style, fullscreenDurationSeconds: config.fullscreenDurationSeconds,
        styleOptions: normalizeStyleOptions(config.styleOptions === undefined ? {} : config.styleOptions),
        layout: normalizeLayout(config.layout) || createLayout() };
    } catch { throw invalidConfig(); }
  }
  throw invalidConfig();
}

function createSceneComponentPorts({ getState, cloud }) {
  function getDefaultConfig(type) {
    if (!COMPONENT_TYPES.includes(type)) throw invalidConfig();
    const state = getState();
    const config = type === 'clock' ? getClockConfig(state.settings) : type === 'queue'
      ? projectOverlayState('queue', state).settings : type === 'overtime' ? state.overtime?.background : cloud.getSettings();
    if (!config) throw new SceneError('SCENE_DEFAULT_UNAVAILABLE', 503, '请等待组件默认配置读取完成后再发布。');
    return normalizeSceneConfig(type, config);
  }
  function getDisplayData(types, request) {
    const state = getState();
    const data = {};
    if (types.includes('queue')) {
      const projected = projectOverlayState('queue', state);
      data.queue = { queue: projected.queue, superChats: projected.superChats };
    }
    if (types.includes('overtime')) {
      const projected = projectOverlayState('overtime', state).overtime;
      if (projected) {
        const { background, ...display } = projected;
        data.overtime = display;
      }
    }
    if (types.includes('danmaku')) data.danmaku = cloud.getSnapshot(request);
    return data;
  }
  return { normalizeConfig: normalizeSceneConfig, getDefaultConfig, getDisplayData };
}

module.exports = { normalizeSceneConfig, createSceneComponentPorts };
