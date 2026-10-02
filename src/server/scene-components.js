'use strict';

const { getClockConfig, normalizeClockSettingValue } = require('./clock-contract');
const { normalizeSettingsPatch } = require('./settings-contract');
const { projectOverlayState } = require('./overlay-projection');
const { validateBackground } = require('../overtime/overtime-contract');
const { DANMAKU_STYLE_OPTIONS, normalizeStyleOptions } = require('../shared/danmaku-style-options');
const { createLayout, normalizeLayout } = require('../shared/danmaku-layout');
const { DEFAULT_SETTINGS } = require('../storage/settings-store');
const { SceneError } = require('../scenes/scene-contract');
const { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { normalizeSceneExtraConfig } = require('./scene-extra-config');

const CLOCK_KEYS = { style: 'clockStyle', showDate: 'clockShowDate', showSeconds: 'clockShowSeconds',
  hourFormat: 'clockHourFormat', label: 'clockLabel', flipFrameColor: 'clockFlipFrameColor',
  flipFaceColor: 'clockFlipFaceColor', flipTextColor: 'clockFlipTextColor' };
const QUEUE_DEFAULTS = projectOverlayState('queue', { settings: DEFAULT_SETTINGS }).settings;

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

const COMPONENT_PORTS = Object.freeze({
  clock: Object.freeze({
    normalizeConfig(config) {
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
    },
    getDefault: (state) => getClockConfig(state.settings),
  }),
  queue: Object.freeze({
    normalizeConfig(config) {
      assertKeys(config, Object.keys(QUEUE_DEFAULTS));
      assertScalarValues(config);
      if (config.overlayQueueStyle !== undefined &&
        !['classic', 'identity', 'festival', 'storybook', 'neon-vinyl', 'cherry-ribbon', 'golden-lily'].includes(config.overlayQueueStyle)) throw invalidConfig();
      const normalized = normalizeSettingsPatch(config, QUEUE_DEFAULTS);
      if (normalized.error) throw invalidConfig();
      return { ...QUEUE_DEFAULTS, ...normalized.values };
    },
    getDefault: (state) => projectOverlayState('queue', state).settings,
    getDisplay(state) {
      const projected = projectOverlayState('queue', state);
      return { queue: projected.queue, superChats: projected.superChats };
    },
  }),
  overtime: Object.freeze({
    normalizeConfig(config) {
      assertKeys(config, ['path', 'fit']);
      if (typeof config.path !== 'string' || typeof config.fit !== 'string') throw invalidConfig();
      try { return validateBackground(config); } catch { throw invalidConfig(); }
    },
    getDefault: (state) => state.overtime?.background,
    getDisplay(state) {
      const projected = projectOverlayState('overtime', state).overtime;
      if (!projected) return undefined;
      const { background, ...display } = projected;
      return display;
    },
  }),
  danmaku: Object.freeze({
    normalizeConfig(config) {
      assertKeys(config, ['style', 'fullscreenDurationSeconds', 'styleOptions', 'layout']);
      if (!Object.hasOwn(DANMAKU_STYLE_OPTIONS, config.style)
        || !Number.isInteger(config.fullscreenDurationSeconds)
        || config.fullscreenDurationSeconds < 2 || config.fullscreenDurationSeconds > 30) throw invalidConfig();
      try {
        return { style: config.style, fullscreenDurationSeconds: config.fullscreenDurationSeconds,
          styleOptions: normalizeStyleOptions(config.styleOptions === undefined ? {} : config.styleOptions),
          layout: normalizeLayout(config.layout) || createLayout() };
      } catch { throw invalidConfig(); }
    },
    getDefault: (state, cloud) => cloud.getSettings(),
    getDisplay: (state, cloud, request) => cloud.getSnapshot(request),
  }),
  ...Object.fromEntries(Object.keys(SCENE_EXTRA_COMPONENTS).map((type) => [type, Object.freeze({
    normalizeConfig: (config) => normalizeSceneExtraConfig(type, config),
    getDefault: () => createSceneExtraDefaults(type),
    getDisplay: (_state, _cloud, _request, getExtraDisplay) => getExtraDisplay?.(type) ?? null,
  })])),
});

function normalizeSceneConfig(type, config) {
  if (typeof type !== 'string' || !Object.hasOwn(COMPONENT_PORTS, type)) throw invalidConfig();
  return COMPONENT_PORTS[type].normalizeConfig(config);
}

function createSceneComponentPorts({ getState, cloud, getExtraDisplay }) {
  function getDefaultConfig(type) {
    if (typeof type !== 'string' || !Object.hasOwn(COMPONENT_PORTS, type)) throw invalidConfig();
    const state = getState();
    const config = COMPONENT_PORTS[type].getDefault(state, cloud);
    if (!config) throw new SceneError('SCENE_DEFAULT_UNAVAILABLE', 503, '请等待组件默认配置读取完成后再发布。');
    return normalizeSceneConfig(type, config);
  }
  function getDisplayData(types, request) {
    const state = getState();
    const data = {};
    const pending = [];
    for (const [type, port] of Object.entries(COMPONENT_PORTS)) {
      if (!types.includes(type) || !port.getDisplay) continue;
      const display = port.getDisplay(state, cloud, request, getExtraDisplay);
      if (display?.then) pending.push(display.then((value) => { data[type] = value; }));
      else if (display !== undefined) data[type] = display;
    }
    return pending.length ? Promise.all(pending).then(() => data) : data;
  }
  return { normalizeConfig: normalizeSceneConfig, getDefaultConfig, getDisplayData };
}

module.exports = { COMPONENT_PORTS, normalizeSceneConfig, createSceneComponentPorts };
