import { normalizeRangeValue } from '../shared/utils.js';
import { normalizePersistedQueueStyle, readQueueStyleSettings, queueStyleSettingsPayload } from '../shared/queue-style-settings.js';
import { componentField } from './component-preview-panel.js';

export const QUEUE_CLASSIC_FIELDS = `themePrimary themeAccent themeText themeBackground themeOpacity themeRadius
  queueSongFontSize queueTitleFontSize backdropBlur glowIntensity overlayLowPowerMode enableGradient gradientEnd
  overlayFontFamily overlayFontWeight overlaySongColor overlayRequesterColor overlayTitle overlayShowIndex
  overlayIndexThreshold overlayIndexColor`.split(/\s+/);
export const QUEUE_IDENTITY_FIELDS = ['overlayTitle', 'queueTitleFontSize', 'overlayShowIndex', 'overlayIndexThreshold',
  'overlayIndexColor', 'overlayPin1', 'overlayPin2', 'overlayPin3', 'overlayRuleFontSize',
  ...Array.from({ length: 6 }, (_, index) => `overlayRule${index + 1}`),
  ...Array.from({ length: 6 }, (_, index) => `overlayRuleColor${index + 1}`)];
export const QUEUE_STYLE_CONTROLS = {
  fontSize: 'identityQueueFontSize', fontFamily: 'illustratedQueueFontFamily', fontWeight: 'illustratedQueueFontWeight',
  useCustomTextColor: 'illustratedQueueUseCustomTextColor', textColor: 'illustratedQueueTextColor',
  scrollMode: 'identityQueueScrollMode', scrollSpeed: 'identityQueueScrollSpeed',
};
const STYLES = ['classic', 'identity', 'storybook', 'neon-vinyl', 'cherry-ribbon', 'golden-lily'];
const SETTING_KEYS = new Set(['overlayQueueStyle', 'themeFontScale', ...QUEUE_CLASSIC_FIELDS, ...QUEUE_IDENTITY_FIELDS,
  ...STYLES.flatMap((style) => Object.keys(queueStyleSettingsPayload(style, readQueueStyleSettings({}, style))))]);

export function pickQueueSettings(settings) {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => SETTING_KEYS.has(key)));
}

export function queueConfigFromSettings(settings) {
  const config = pickQueueSettings(settings);
  config.overlayQueueStyle = normalizePersistedQueueStyle(settings.overlayQueueStyle);
  for (const style of STYLES) Object.assign(config, queueStyleSettingsPayload(style, readQueueStyleSettings(settings, style)));
  return config;
}

export function collectQueueTheme(root) {
  const value = (id) => componentField(root, id)?.value ?? '';
  const style = normalizePersistedQueueStyle(value('overlayQueueStyle'));
  const fields = style === 'classic' ? QUEUE_CLASSIC_FIELDS : style === 'identity' ? QUEUE_IDENTITY_FIELDS : [];
  const payload = { overlayQueueStyle: style, ...Object.fromEntries(fields.map((key) => [key, value(key)])) };
  if (style === 'classic') {
    for (const key of ['overlaySongColor', 'overlayRequesterColor']) {
      if (componentField(root, `${key}Mode`)?.value === 'inherit') payload[key] = '';
    }
  }
  const styleValues = style === 'classic'
    ? { scrollMode: value('queueScrollMode'), scrollSpeed: value('queueScrollSpeed') }
    : Object.fromEntries(Object.entries(QUEUE_STYLE_CONTROLS).map(([field, id]) => [field, value(id)]));
  if (style === 'identity') styleValues.fontFamily = value('overlayFontFamily');
  return { ...payload, ...queueStyleSettingsPayload(style, styleValues) };
}

export function queueSettingsPayload(draft, changed) {
  return { ...pickQueueSettings(changed), overlayQueueStyle: draft.overlayQueueStyle };
}

// Project legacy settings to controls without rewriting the saved draft.
export function queueThemeControlValues(settings) {
  const active = readQueueStyleSettings(settings, settings.overlayQueueStyle);
  const scale = Number(normalizeRangeValue(settings.themeFontScale, 0.25, 2, 1));
  return {
    ...Object.fromEntries(Object.entries(QUEUE_STYLE_CONTROLS).map(([field, id]) => [id, active[field]])),
    queueSongFontSize: normalizeRangeValue(settings.queueSongFontSize, 10, 70, Math.round(scale * 28)),
    queueTitleFontSize: normalizeRangeValue(settings.queueTitleFontSize, 10, 40, Math.round(scale * 30)),
    identityQueueFontSize: normalizeRangeValue(active.fontSize, 9, 78, 28),
    overlayRuleFontSize: normalizeRangeValue(settings.overlayRuleFontSize, 5, 18, 10),
    queueScrollSpeed: normalizeQueueScrollSpeedForDisplay(settings.queueScrollSpeed),
    identityQueueScrollSpeed: normalizeQueueScrollSpeedForDisplay(active.scrollSpeed),
  };
}

function normalizeQueueScrollSpeedForDisplay(input) {
  const valueNumber = Number(input);
  if (!Number.isFinite(valueNumber)) return '80';
  if (valueNumber > 100) {
    const actualSpeed = Math.max(50, Math.min(200, valueNumber));
    return String(Math.round(1 + ((actualSpeed - 50) / 150) * 99));
  }
  return String(Math.max(1, Math.min(100, Math.round(valueNumber))));
}
