'use strict';

const { normalizeSceneConfig } = require('./scene-components');
const { createComponentStyleLibrary } = require('./component-style-library');
const { createComponentStyleStore } = require('../storage/component-style-store');
const { getClockConfig } = require('./clock-contract');
const { projectOverlayState } = require('./overlay-projection');
const { normalizeSettingsPatch } = require('./settings-contract');
const { DEFAULT_SETTINGS } = require('../storage/settings-store');
const { getOpeningConfig } = require('./opening-service');
const { GIFT_DISPLAY_SETTING, readGiftDisplaySettings, validateGiftDisplaySettings } = require('../bilibili/gift/display-settings');
const { SCENE_EXTRA_COMPONENTS } = require('../../public/js/shared/scene-extra-components.js');
const { GUARD_THANKS_EFFECTS, readGuardThanksEffect } = require('../../public/js/shared/guard-thanks-settings.js');
const { openingStyleSettingsPatch } = require('../../public/js/shared/opening-settings.js');
const { hasInstalledAppearance, sharedControllerAppearance, sceneAppearanceKey } = require('../../public/js/shared/scene-shared-appearance.js');
const { SONG_BOARD_THEME_FIELDS } = require('../../public/js/shared/song-board-theme-fields.js');

const LOCAL_TYPES = ['songlist', 'lyrics', 'interactions', 'blindbox'];
const BLINDBOX_KEYS = { top: 'blindboxOverlayTop', winnersOnly: 'blindboxWinnersOnly', heartBoxOnly: 'blindboxHeartBoxOnly' };
const invalid = () => Object.assign(new Error('只能调整此样式的公共显示参数。'), { statusCode: 400 });

function settingsKeys(type) {
  return LOCAL_TYPES.includes(type) ? Object.keys(SCENE_EXTRA_COMPONENTS[type].fields)
    .filter(key => Object.hasOwn(DEFAULT_SETTINGS, key)) : [];
}

function createSceneSharedAppearance(context) {
  const settings = { ...DEFAULT_SETTINGS, ...context.settings.get() };
  let styles;
  let opening;
  function resource(config, type) {
    if (!config.resourceStyle || !context.system.dataDir) return null;
    // Removed packages keep their saved appearance and assets for existing scenes.
    styles ??= createComponentStyleStore(context.system.dataDir).read().packages.flatMap(pack => pack.styles);
    return styles.find(style => style.id === config.resourceStyle.id && style.type === type);
  }
  function read(type, config, defaults) {
    if (config.resourceStyle) return resource(config, type)?.config || {};
    if (hasInstalledAppearance(config)) return {};
    if (type === 'clock') defaults ??= getClockConfig(settings);
    if (type === 'queue') defaults ??= projectOverlayState('queue', { settings }).settings;
    if (type === 'overtime') defaults ??= context.system.getState?.().overtime?.background;
    if (type === 'danmaku') defaults ??= context.readDanmakuDisplay?.({})?.config;
    if (defaults) return sharedControllerAppearance(type, config, defaults);
    if (LOCAL_TYPES.includes(type)) {
      const result = Object.fromEntries(settingsKeys(type).map(key => [key, settings[key]]));
      if (type === 'songlist' && settings.songBoardSyncTheme !== 'false') {
        for (const [field, key] of Object.entries(SONG_BOARD_THEME_FIELDS)) result[field] = settings[key];
      }
      if (type === 'blindbox') {
        for (const [field, key] of Object.entries(BLINDBOX_KEYS)) result[field] = field === 'top' ? Number(settings[key]) : settings[key] === 'true';
      }
      return result;
    }
    if (type === 'gift-feed') {
      const { thresholds, palette: _palette, ...config } = readGiftDisplaySettings(settings);
      return { ...config, ...Object.fromEntries(thresholds.map((value, index) => [`threshold${index + 1}`, value])) };
    }
    if (type === 'guard-thanks') {
      const effect = GUARD_THANKS_EFFECTS.find(effect => effect.style === config.style);
      return effect ? { textMode: readGuardThanksEffect(settings, effect).textMode } : {};
    }
    if (type === 'opening') {
      opening ??= getOpeningConfig(context);
      const style = config.style === 'original' ? opening.style : config.style;
      const value = opening.styles[style];
      return value ? Object.fromEntries(Object.keys(SCENE_EXTRA_COMPONENTS.opening.fields)
        .filter(key => key !== 'style' && Object.hasOwn(value, key)).map(key => [key, value[key]])) : {};
    }
    return {};
  }
  function patch(type, config, patch) {
    const current = read(type, config);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
      || !Object.keys(patch).length || Object.keys(patch).some(key => !Object.hasOwn(current, key)
        || ['resourceStyle', 'cssStyle', 'mediaStyle', 'backgroundDefaults'].includes(key))) throw invalid();
    if (config.resourceStyle) {
      return createComponentStyleLibrary(context.system.dataDir).config({ id: config.resourceStyle.id, patch }).config;
    }
    // The desktop relay remains the only writer of clock/queue/overtime drafts
    // and remote danmaku settings. This capability never acquires their authority.
    if (!LOCAL_TYPES.includes(type) && !['gift-feed', 'guard-thanks', 'opening'].includes(type)) throw invalid();
    const next = normalizeSceneConfig(type, { ...config, ...current, ...patch });
    let values;
    if (type === 'gift-feed') {
      const value = validateGiftDisplaySettings({ ...next, palette: 'bilibili-four', thresholds: [next.threshold1, next.threshold2, next.threshold3] });
      context.settings.setMany({ [GIFT_DISPLAY_SETTING]: JSON.stringify(value) });
      return createSceneSharedAppearance(context).read(type, config);
    } else if (type === 'opening') {
      values = openingStyleSettingsPatch(config.style === 'original' ? opening.style : config.style, patch);
    } else if (type === 'guard-thanks') {
      const effect = GUARD_THANKS_EFFECTS.find(effect => effect.style === config.style);
      values = { [`${effect.prefix}TextMode`]: next.textMode };
    } else {
      values = Object.fromEntries(Object.keys(patch).map(key => [type === 'blindbox' ? BLINDBOX_KEYS[key] || key : key, String(next[key])]));
      if (type === 'lyrics' && Object.hasOwn(patch, 'desktopLyricKaraokeMode')) values.desktopLyricKaraokeEnabled = String(next.desktopLyricKaraokeMode !== 'off');
    }
    const normalized = normalizeSettingsPatch(values, context.settings.defaults || DEFAULT_SETTINGS);
    if (normalized.error || Object.keys(normalized.values).length !== Object.keys(values).length) throw invalid();
    context.settings.setMany(normalized.values);
    return createSceneSharedAppearance(context).read(type, config);
  }
  return { read, patch };
}

function readSceneSharedAppearances(context, items, getDefaultConfig) {
  const owner = createSceneSharedAppearance(context);
  const configurations = new Map();
  return Object.fromEntries(items.map(item => {
    const config = item.appearance.config || getDefaultConfig?.(item.type) || {};
    const key = sceneAppearanceKey(item.type, config);
    if (!configurations.has(key)) configurations.set(key, owner.read(item.type, config));
    return [item.id, configurations.get(key)];
  }));
}

module.exports = { createSceneSharedAppearance, readSceneSharedAppearances };
