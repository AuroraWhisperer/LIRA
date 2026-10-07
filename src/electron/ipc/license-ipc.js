'use strict';

const { registerLicenseOverlayIpc } = require('./license-overlay-ipc');
const { registerLicenseSongsIpc } = require('./license-songs-ipc');
const { safeState, safeErrorCode, safeErrorIndex, safeString, sanitizePublicUrl } = require('./license-public-values');
const { sanitizeWelcomeFieldErrors } = require('../../shared/welcome-settings-contract');

const SAFE_GIFT_CATALOG_STATUSES = new Set(['required', 'running', 'updating', 'ready', 'error']);
const SAFE_GIFT_CATALOG_PHASES = new Set(['idle', 'catalog', 'images', 'complete', 'error']);
function registerLicenseIpc(options = {}) {
  const {
    ipcMain,
    licenseManager,
    giftCatalog = null,
    getMainWindow = () => null,
    getDesktopBaseUrl = () => '',
    hasExactOrigin = () => false,
  } = options;
  if (!ipcMain || !licenseManager) throw new Error('License IPC dependencies are required.');

  const safeHandle = (channel, handler, mainFrameOnly = false) => {
    try {
      ipcMain.removeHandler?.(channel);
    } catch (error) {
      void error;
    }
    ipcMain.handle(channel, async (event, payload) => {
      const window = getMainWindow();
      const senderUrl = event?.senderFrame?.url || '';
      if (
        !window ||
        window.isDestroyed?.() ||
        event?.sender !== window.webContents ||
        (mainFrameOnly && event?.senderFrame !== window.webContents.mainFrame) ||
        !hasExactOrigin(senderUrl, getDesktopBaseUrl())
      ) {
        return {
          ok: false,
          state: safeState(licenseManager.getState()),
          error: 'IPC_SOURCE_INVALID',
        };
      }
      try {
        return await handler(payload);
      } catch (error) {
        const response = {
          ok: false,
          state: safeState(licenseManager.getState()),
          error: safeErrorCode(error),
        };
        const index = safeErrorIndex(error?.index);
        if (index !== undefined) response.index = index;
        const fieldErrors = sanitizeWelcomeFieldErrors(error?.fieldErrors);
        if (fieldErrors.length) response.fieldErrors = fieldErrors;
        return response;
      }
    });
  };

  safeHandle('license:get-state', () => sanitizeStateResponse(licenseManager.getSnapshot()));
  safeHandle('license:activate', (payload) => {
    const input = validateActivationPayload(payload);
    if (!input.ok) return input;
    return licenseManager.activate(input).then((result) => sanitizeActivationResponse(result));
  });
  safeHandle('license:retry', async () => {
    await licenseManager.retry();
    const snapshot = licenseManager.getSnapshot();
    return {
      ok: licenseManager.getState() === licenseManager.LicenseState.AUTHORIZED,
      ...sanitizeStateSnapshot(snapshot),
    };
  });
  if (giftCatalog) {
    safeHandle('license:get-gift-catalog-state', () => ({
      ok: true,
      ...sanitizeGiftCatalogState(giftCatalog.getState?.()),
    }));
    safeHandle('license:retry-gift-catalog', async () => {
      if (safeState(licenseManager.getState()) !== 'authorized') {
        return {
          ok: false,
          ...sanitizeGiftCatalogState({
            status: 'required',
            phase: 'idle',
            error: 'LICENSE_REQUIRED',
          }),
        };
      }
      const snapshot = await giftCatalog.initialize?.();
      const state = sanitizeGiftCatalogState(snapshot || giftCatalog.getState?.());
      return { ok: state.status === 'ready', ...state };
    });
  }
  safeHandle('license:get-profile', () =>
    licenseManager.getProfile().then((snapshot) => ({ ok: true, ...sanitizeStateSnapshot(snapshot) })),
  );
  registerLicenseOverlayIpc({ safeHandle, licenseManager });
  registerLicenseSongsIpc({ safeHandle, licenseManager });

  const disposeLicenseState = licenseManager.onStateChanged((snapshot) => {
    const window = getMainWindow();
    if (window && !window.isDestroyed?.())
      window.webContents.send('license:state-changed', sanitizeStateSnapshot(snapshot));
  });
  const disposeGiftCatalogState = giftCatalog?.onStateChanged?.((snapshot) => {
    const window = getMainWindow();
    if (window && !window.isDestroyed?.())
      window.webContents.send('license:gift-catalog-state-changed', sanitizeGiftCatalogState(snapshot));
  });
  return () => {
    disposeGiftCatalogState?.();
    disposeLicenseState?.();
  };
}

function sanitizeStateResponse(snapshot = {}) {
  return { ok: true, ...sanitizeStateSnapshot(snapshot) };
}

function sanitizeActivationResponse(result = {}) {
  const response = { ok: result?.ok === true, state: safeState(result?.state) };
  const error = sanitizeOptionalError(result?.error);
  if (error) response.error = error;
  const streamer = sanitizeStreamer(result?.streamer);
  if (streamer) response.streamer = streamer;
  return response;
}

function sanitizeStateSnapshot(snapshot = {}) {
  const response = {
    state: safeState(snapshot?.state),
    error: sanitizeOptionalError(snapshot?.error),
  };
  const streamer = sanitizeStreamer(snapshot?.streamer);
  if (streamer) response.streamer = streamer;
  const device = sanitizeDevice(snapshot?.device);
  if (device) response.device = device;
  return response;
}

function sanitizeGiftCatalogState(snapshot = {}) {
  const total = safeNonNegativeInteger(snapshot?.total);
  const completedAtMs = Date.parse(safeString(snapshot?.completedAt, 32));
  const completed = Math.min(safeNonNegativeInteger(snapshot?.completed), total);
  return {
    status: SAFE_GIFT_CATALOG_STATUSES.has(snapshot?.status) ? snapshot.status : 'required',
    background: snapshot?.background === true,
    phase: SAFE_GIFT_CATALOG_PHASES.has(snapshot?.phase) ? snapshot.phase : 'idle',
    completed,
    total,
    available: Math.min(safeNonNegativeInteger(snapshot?.available), completed),
    failed: Math.min(safeNonNegativeInteger(snapshot?.failed), completed),
    percent: Math.min(100, safeNonNegativeInteger(snapshot?.percent)),
    currentGiftId: safeString(snapshot?.currentGiftId, 32),
    currentGiftName: safeString(snapshot?.currentGiftName, 100),
    completedAt: Number.isFinite(completedAtMs) ? new Date(completedAtMs).toISOString() : null,
    error: sanitizeOptionalError(snapshot?.error),
    warning: sanitizeOptionalError(snapshot?.warning),
  };
}

function safeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function sanitizeOptionalError(value) {
  if (value === undefined || value === null || value === '') return null;
  return safeErrorCode({ code: value });
}

function sanitizeStreamer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {
    accountName: safeString(value.accountName, 32),
    displayName: safeString(value.displayName || value.accountName, 80),
    subdomain: safeString(value.subdomain, 63),
  };
  const songPageUrl = sanitizePublicUrl(value.songPageUrl);
  if (songPageUrl !== undefined) result.songPageUrl = songPageUrl;
  const manageUrl = sanitizePublicUrl(value.manageUrl);
  if (manageUrl !== undefined) result.manageUrl = manageUrl;
  return result;
}

function sanitizeDevice(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    id: safeString(value.id, 128),
    name: safeString(value.name, 100),
    status: safeString(value.status, 32),
    licenseId: safeString(value.licenseId, 128),
  };
}

function validateActivationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return {
      ok: false,
      state: 'needs_activation',
      error: 'ACTIVATION_INPUT_INVALID',
    };
  const accountName = String(payload.accountName || '');
  const password = String(payload.password || '');
  const activationCode = String(payload.activationCode || '');
  if (accountName.length > 64)
    return {
      ok: false,
      state: 'needs_activation',
      error: 'ACCOUNT_NAME_LENGTH',
    };
  if (password.length > 256) return { ok: false, state: 'needs_activation', error: 'PASSWORD_TOO_LONG' };
  if (activationCode.length > 256)
    return {
      ok: false,
      state: 'needs_activation',
      error: 'ACTIVATION_CODE_INVALID',
    };
  if (!accountName || !password || !activationCode)
    return {
      ok: false,
      state: 'needs_activation',
      error: 'ACTIVATION_INPUT_INVALID',
    };
  return { ok: true, accountName, password, activationCode };
}

module.exports = { registerLicenseIpc, validateActivationPayload };
