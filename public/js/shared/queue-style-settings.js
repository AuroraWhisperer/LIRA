// Point-song board style setting ownership and compatibility projection.
'use strict';

const STYLE_SETTING_KEYS = {
  classic: {
    fontSize: 'queueSongFontSize',
    scrollMode: 'queueScrollMode',
    scrollSpeed: 'queueScrollSpeed',
  },
  identity: {
    fontSize: 'identityQueueFontSize',
    scrollMode: 'identityQueueScrollMode',
    scrollSpeed: 'identityQueueScrollSpeed',
  },
  storybook: illustratedStyleKeys('storybook'),
  'neon-vinyl': illustratedStyleKeys('neonVinyl'),
  'cherry-ribbon': illustratedStyleKeys('cherryRibbon'),
  'golden-lily': illustratedStyleKeys('goldenLily'),
};

const LEGACY_KEYS = {
  fontSize: 'identityQueueFontSize',
  fontFamily: 'illustratedQueueFontFamily',
  fontWeight: 'illustratedQueueFontWeight',
  useCustomTextColor: 'illustratedQueueUseCustomTextColor',
  textColor: 'illustratedQueueTextColor',
  scrollMode: 'queueScrollMode',
  scrollSpeed: 'identityQueueScrollSpeed',
};

const FIELD_DEFAULTS = {
  fontSize: '26',
  fontFamily: 'default',
  fontWeight: 'default',
  useCustomTextColor: 'false',
  textColor: '#315d7d',
  scrollMode: 'bounce',
  scrollSpeed: '80',
};

export const QUEUE_ILLUSTRATED_STYLES = new Set([
  'storybook',
  'neon-vinyl',
  'cherry-ribbon',
  'golden-lily',
]);

function illustratedStyleKeys(prefix) {
  return {
    fontSize: `${prefix}QueueFontSize`,
    fontFamily: `${prefix}QueueFontFamily`,
    fontWeight: `${prefix}QueueFontWeight`,
    useCustomTextColor: `${prefix}QueueUseCustomTextColor`,
    textColor: `${prefix}QueueTextColor`,
    scrollMode: `${prefix}QueueScrollMode`,
    scrollSpeed: `${prefix}QueueScrollSpeed`,
  };
}

export function normalizePersistedQueueStyle(style) {
  if (QUEUE_ILLUSTRATED_STYLES.has(style)) return style;
  if (style === 'identity' || style === 'festival') return 'identity';
  return 'classic';
}

export function readQueueStyleSettings(settings, style) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const normalizedStyle = normalizePersistedQueueStyle(style);
  const keys = STYLE_SETTING_KEYS[normalizedStyle];
  const values = { style: normalizedStyle };

  for (const field of Object.keys(FIELD_DEFAULTS)) {
    const key = keys[field];
    const legacyKey = normalizedStyle === 'classic' ? null : LEGACY_KEYS[field];
    if (key && source[key] !== undefined && source[key] !== null) {
      values[field] = String(source[key]);
    } else if (
      legacyKey &&
      source[legacyKey] !== undefined &&
      source[legacyKey] !== null
    ) {
      values[field] = String(source[legacyKey]);
    } else if (normalizedStyle === 'classic' && field === 'fontSize') {
      values[field] = '40';
    } else {
      values[field] = FIELD_DEFAULTS[field];
    }
  }

  return values;
}

export function queueStyleSettingsPayload(style, values) {
  const normalizedStyle = normalizePersistedQueueStyle(style);
  const keys = STYLE_SETTING_KEYS[normalizedStyle];
  const source = values && typeof values === 'object' ? values : {};
  const payload = {};

  for (const [field, key] of Object.entries(keys)) {
    if (source[field] === undefined || source[field] === null) continue;
    payload[key] = String(source[field]);
  }

  return payload;
}

export function resolveQueueStyleSettings(settings, style) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const active = readQueueStyleSettings(source, style);
  if (active.style === 'classic') return { ...source };

  const resolved = {
    ...source,
    identityQueueFontSize: active.fontSize,
    identityQueueScrollSpeed: active.scrollSpeed,
    queueScrollMode: active.scrollMode,
  };
  if (QUEUE_ILLUSTRATED_STYLES.has(active.style)) {
    resolved.illustratedQueueFontFamily = active.fontFamily;
    resolved.illustratedQueueFontWeight = active.fontWeight;
    resolved.illustratedQueueUseCustomTextColor = active.useCustomTextColor;
    resolved.illustratedQueueTextColor = active.textColor;
  }
  return resolved;
}
