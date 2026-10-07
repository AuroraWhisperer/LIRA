'use strict';

const { DANMAKU_STYLE_OPTIONS, normalizeStyleOptions } = require('../../shared/danmaku-style-options');
const { normalizeStyleParameters } = require('../../shared/component-style-parameters');
const { normalizeLayout } = require('../../shared/danmaku-layout');

const {
  overlayFilterParameters,
  sanitizeOverlayFilters,
  sanitizeOverlayViewers,
} = require('../../shared/overlay-filters-contract');
const {
  welcomeV2Parameters,
  sanitizeWelcomeV2,
} = require('../../shared/welcome-settings-contract');
const { sanitizePublicUrl } = require('./license-public-values');
const OVERLAY_STYLES = new Set(Object.keys(DANMAKU_STYLE_OPTIONS));

function registerLicenseOverlayIpc({ safeHandle, licenseManager }) {
  safeHandle('license:get-overlay-settings', async () =>
    sanitizeOverlaySettings(await licenseManager.getOverlaySettings()),
  );
  safeHandle(
    'license:get-overlay-filters',
    async () => sanitizeOverlayFilters(await licenseManager.getOverlayFilters()),
    true,
  );
  safeHandle(
    'license:update-overlay-filters',
    async (settings) =>
      sanitizeOverlayFilters(await licenseManager.updateOverlayFilters(overlayFilterParameters(settings))),
    true,
  );
  safeHandle(
    'license:get-overlay-viewers',
    async () => sanitizeOverlayViewers(await licenseManager.getOverlayViewers()),
    true,
  );
  safeHandle('license:get-welcome-settings', async () =>
    sanitizeWelcomeSettings(await licenseManager.getWelcomeSettings()),
  );
  safeHandle('license:get-welcome-settings-v2', async () => {
    const result = await licenseManager.getWelcomeSettingsV2();
    return result?.schemaVersion === 1
      ? { ...sanitizeWelcomeSettings(result), schemaVersion: 1 }
      : sanitizeWelcomeV2(result);
  });
  safeHandle('license:update-welcome-settings-v2', async (settings) =>
    sanitizeWelcomeV2(await licenseManager.updateWelcomeSettingsV2(welcomeV2Parameters(settings))),
  );
  safeHandle('license:get-pk-report-settings', async () =>
    sanitizePkReportSettings(await licenseManager.getPkReportSettings()),
  );
  safeHandle('license:update-pk-report-settings', async (settings) =>
    sanitizePkReportSettings(await licenseManager.updatePkReportSettings(pkReportParameters(settings))),
  );
  safeHandle('license:update-welcome-settings', async (settings) =>
    sanitizeWelcomeSettings(await licenseManager.updateWelcomeSettings(welcomeParameters(settings))),
  );
  safeHandle('license:update-overlay-settings', async (settings) => {
    const parameters = overlayParameters(settings);
    return sanitizeOverlaySettings(await licenseManager.updateOverlaySettings(parameters));
  });
}

function welcomeParameters(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.keys(value).length ||
    Object.keys(value).some((key) => !['enabled', 'messages'].includes(key)) ||
    (Object.hasOwn(value, 'enabled') && typeof value.enabled !== 'boolean')
  ) {
    throw Object.assign(new Error(), { code: 'INVALID_WELCOME_SETTINGS' });
  }
  if (
    Object.hasOwn(value, 'messages') &&
    (!Array.isArray(value.messages) ||
      value.messages.length < 1 ||
      value.messages.length > 30 ||
      value.messages.some(
        (item) =>
          typeof item !== 'string' || !item.trim() || Array.from(item).length > 80 || /[\x00-\x1f\x7f]/u.test(item),
      ))
  ) {
    throw Object.assign(new Error(), { code: 'INVALID_WELCOME_MESSAGES' });
  }
  return {
    ...(Object.hasOwn(value, 'enabled') ? { enabled: value.enabled } : {}),
    ...(Object.hasOwn(value, 'messages') ? { messages: value.messages.map((item) => item.trim()) } : {}),
  };
}

function pkReportParameters(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.enabled !== 'boolean'
  ) {
    throw Object.assign(new Error(), { code: 'INVALID_PK_REPORT_SETTINGS' });
  }
  return { enabled: value.enabled };
}

function sanitizePkReportSettings(value) {
  if (value?.ok !== true || typeof value.enabled !== 'boolean')
    throw Object.assign(new Error(), { code: 'INVALID_RESPONSE' });
  return { ok: true, enabled: value.enabled };
}

function sanitizeWelcomeSettings(value) {
  if (value?.ok === false || typeof value?.enabled !== 'boolean' || !Array.isArray(value?.messages))
    throw Object.assign(new Error(), { code: 'INVALID_RESPONSE' });
  return { ok: true, ...welcomeParameters({ enabled: value.enabled, messages: value.messages }) };
}

function overlayParameters(value) {
  if (!OVERLAY_STYLES.has(value?.style)) {
    throw Object.assign(new Error('INVALID_OVERLAY_STYLE'), { code: 'INVALID_OVERLAY_STYLE' });
  }
  const duration = value?.fullscreenDurationSeconds;
  if (!Number.isInteger(duration) || duration < 2 || duration > 30) {
    throw Object.assign(new Error('INVALID_OVERLAY_DURATION'), { code: 'INVALID_OVERLAY_DURATION' });
  }
  return {
    style: value.style,
    fullscreenDurationSeconds: duration,
    ...(value.styleParameters === undefined ? {} : { styleParameters: normalizeStyleParameters('danmaku', value.styleParameters) }),
    ...(value.layout === undefined ? {} : { layout: normalizeLayout(value.layout) }),
    ...(value.styleOptions === undefined
      ? {}
      : {
          styleOptions: normalizeStyleOptions(value.styleOptions),
        }),
  };
}

function sanitizeOverlaySettings(value) {
  const parameters = overlayParameters(value);
  const overlayUrl = sanitizePublicUrl(value?.overlayUrl);
  if (
    !overlayUrl ||
    !/^\/overlay\/[A-Za-z0-9_-]{16}$/.test(new URL(overlayUrl).pathname) ||
    new URL(overlayUrl).search ||
    new URL(overlayUrl).hash
  ) {
    throw Object.assign(new Error('INVALID_RESPONSE'), { code: 'INVALID_RESPONSE' });
  }
  return { ok: true, ...parameters, overlayUrl };
}

module.exports = { registerLicenseOverlayIpc };
