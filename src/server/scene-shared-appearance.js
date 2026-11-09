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
const { hasInstalledAppearance, sharedControllerAppearance, sceneAppearanceKey, SHARED_SCENE_SETTING_FIELDS,
  sceneAppearanceFromSettings, sceneAppearanceSettingsPatch } = require('../../public/js/shared/scene-shared-appearance.js');
const { GIFT_MOTION_EFFECTS, giftMotionSettingKeys } = require('../../public/js/shared/gift-motion-settings.js');
const { ADVANCED_LYRIC_PRESETS_SETTING } = require('../../public/js/shared/advanced-lyric-appearance.js');
const { SONG_BOARD_THEME_FIELDS } = require('../../public/js/shared/song-board-theme-fields.js');
const { NOW_PLAYING_SETTING, readNowPlayingConfig } = require('./now-playing-settings');

const LOCAL_TYPES = ['songlist', 'lyrics', 'interactions', 'blindbox'];
const BLINDBOX_KEYS = { top: 'blindboxOverlayTop', winnersOnly: 'blindboxWinnersOnly', hideLoss: 'blindboxWinnersOnly',
  heartBoxOnly: 'blindboxHeartBoxOnly', compact: 'blindboxCompact', noScroll: 'blindboxAutoPages' };
const invalid = () => Object.assign(new Error('只能调整此样式的公共显示参数。'), { statusCode: 400 });

function settingsKeys(type) {
  const fields = LOCAL_TYPES.includes(type) ? Object.keys(SCENE_EXTRA_COMPONENTS[type].fields)
    .filter(key => Object.hasOwn(DEFAULT_SETTINGS, key)) : [];
  return type === 'lyrics' ? [...fields, ADVANCED_LYRIC_PRESETS_SETTING] : fields;
}

function sharedResourceAppearance(type, config = {}) {
  if (type !== 'lyrics') return config;
  const { lyricLayer: _layer, ...appearance } = config;
  return appearance;
}

function createSceneSharedAppearance(context) {
  const settings = { ...DEFAULT_SETTINGS, ...context.settings.get() };
  let readStyle;
  let opening;
  function resource(config, type) {
    if (!config.resourceStyle || !context.system.dataDir) return null;
    // Removed packages keep their saved appearance and assets for existing scenes.
    readStyle ??= createComponentStyleStore(context.system.dataDir).createStyleReader();
    return readStyle(config.resourceStyle.id, type);
  }
  function read(type, config, defaults) {
    if (config.resourceStyle) return sharedResourceAppearance(type, resource(config, type)?.config);
    if (hasInstalledAppearance(config)) return {};
    if (Object.hasOwn(SHARED_SCENE_SETTING_FIELDS, type)) return sceneAppearanceFromSettings(type, settings);
    if (type === 'gift-frame') {
      const effects = GIFT_MOTION_EFFECTS.filter(effect => !config.style || config.style === 'follow' || config.style === effect.style);
      return Object.fromEntries(effects.flatMap(effect => giftMotionSettingKeys(effect).map(key => [key, settings[key]])));
    }
    if (type === 'now-playing') {
      const { style: _style, nowPlayingPart: _part, ...appearance } = readNowPlayingConfig(settings);
      return appearance;
    }
    if (type === 'clock') defaults ??= getClockConfig(settings);
    if (type === 'queue') defaults ??= projectOverlayState('queue', { settings }).settings;
    if (type === 'overtime') defaults ??= (context.readState ? context.readState()
      : context.system.getState?.(['overtime']))?.overtime?.background;
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
      return sharedResourceAppearance(type,
        createComponentStyleLibrary(context.system.dataDir).config({ id: config.resourceStyle.id, patch }).config);
    }
    // The desktop relay remains the only writer of clock/queue/overtime drafts
    // and remote danmaku settings. This capability never acquires their authority.
    if (!LOCAL_TYPES.includes(type) && !Object.hasOwn(SHARED_SCENE_SETTING_FIELDS, type)
      && !['gift-frame', 'gift-feed', 'guard-thanks', 'opening', 'now-playing'].includes(type)) throw invalid();
    const nextConfig = { ...config, ...current, ...patch };
    if (type === 'lyrics') delete nextConfig[ADVANCED_LYRIC_PRESETS_SETTING];
    const next = type === 'gift-frame' ? null : normalizeSceneConfig(type, nextConfig);
    let values;
    if (type === 'gift-frame') {
      values = patch;
    } else if (Object.hasOwn(SHARED_SCENE_SETTING_FIELDS, type)) {
      values = sceneAppearanceSettingsPatch(type, patch);
    } else if (type === 'now-playing') {
      const saved = readNowPlayingConfig(context.settings.get());
      const appearance = normalizeSceneConfig(type, { ...saved, ...patch });
      context.settings.setMany({ [NOW_PLAYING_SETTING]: JSON.stringify(appearance) });
      return createSceneSharedAppearance(context).read(type, config);
    } else if (type === 'gift-feed') {
      const value = validateGiftDisplaySettings({ ...next, palette: 'bilibili-four', thresholds: [next.threshold1, next.threshold2, next.threshold3] });
      context.settings.setMany({ [GIFT_DISPLAY_SETTING]: JSON.stringify(value) });
      return createSceneSharedAppearance(context).read(type, config);
    } else if (type === 'opening') {
      values = openingStyleSettingsPatch(config.style === 'original' ? opening.style : config.style, patch);
    } else if (type === 'guard-thanks') {
      const effect = GUARD_THANKS_EFFECTS.find(effect => effect.style === config.style);
      values = { [`${effect.prefix}TextMode`]: next.textMode };
    } else {
      values = Object.fromEntries(Object.keys(patch).map(key => [type === 'blindbox' ? BLINDBOX_KEYS[key] || key : key,
        key === ADVANCED_LYRIC_PRESETS_SETTING ? patch[key] : String(next[key])]));
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
    if (!configurations.has(key)) {
      const appearance = owner.read(item.type, config);
      if (item.type === 'lyrics') delete appearance[ADVANCED_LYRIC_PRESETS_SETTING];
      configurations.set(key, appearance);
    }
    return [item.id, configurations.get(key)];
  }));
}

module.exports = { createSceneSharedAppearance, readSceneSharedAppearances };
