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
  return { ...payload, ...queueStyleSettingsPayload(style, styleValues) };
}

export function queueSettingsPayload(draft, changed) {
  return { ...pickQueueSettings(changed), overlayQueueStyle: draft.overlayQueueStyle };
}
