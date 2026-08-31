'use strict';

const SONG_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_LICENSE_STATES = new Set([
  'checking',
  'needs_activation',
  'needs_connection',
  'authorizing',
  'authorized',
  'blocked',
]);
const SONG_PUBLIC_FIELDS = [
  'id',
  'title',
  'name',
  'artist',
  'categoryName',
  'category_name',
  'tags',
  'language',
  'sourcePlatform',
  'source_platform',
  'note',
  'requestPrice',
  'request_price',
  'songClip',
  'song_clip',
  'enabled',
  'isEnabled',
  'is_enabled',
  'sortOrder',
  'sort_order',
  'createdAt',
  'updatedAt',
];
function registerLicenseIpc(options = {}) {
  const {
    ipcMain,
    licenseManager,
    getMainWindow = () => null,
    getDesktopBaseUrl = () => '',
    hasExactOrigin = () => false,
  } = options;
  if (!ipcMain || !licenseManager)
    throw new Error('License IPC dependencies are required.');

  const safeHandle = (channel, handler) => {
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
        return {
          ok: false,
          state: safeState(licenseManager.getState()),
          error: safeErrorCode(error),
        };
      }
    });
  };

  safeHandle('license:get-state', () =>
    sanitizeStateResponse(licenseManager.getSnapshot()),
  );
  safeHandle('license:activate', (payload) => {
    const input = validateActivationPayload(payload);
    if (!input.ok) return input;
    return licenseManager
      .activate(input)
      .then((result) => sanitizeActivationResponse(result));
  });
  safeHandle('license:retry', async () => {
    await licenseManager.retry();
    const snapshot = licenseManager.getSnapshot();
    return {
      ok: licenseManager.getState() === licenseManager.LicenseState.AUTHORIZED,
      ...sanitizeStateSnapshot(snapshot),
    };
  });
  safeHandle('license:get-profile', () =>
    licenseManager
      .getProfile()
      .then((snapshot) => ({ ok: true, ...sanitizeStateSnapshot(snapshot) })),
  );
  safeHandle('license:sync-songs', (songs) => {
    if (!Array.isArray(songs) || songs.length > 5000)
      return {
        ok: false,
        state: safeState(licenseManager.getState()),
        error: 'SONG_LIST_INVALID',
      };
    if (JSON.stringify(songs).length > 4 * 1024 * 1024)
      return {
        ok: false,
        state: safeState(licenseManager.getState()),
        error: 'SONG_LIST_TOO_LARGE',
      };
    return licenseManager
      .syncSongs(songs)
      .then((result) => sanitizeSyncResponse(result));
  });
  safeHandle('license:get-song-page-background', () =>
    licenseManager
      .getSongPageBackground()
      .then((result) => sanitizeBackgroundResponse(result)),
  );
  safeHandle('license:get-cloud-songs', () =>
    licenseManager
      .getCloudSongs()
      .then((result) => sanitizeCloudSongsResponse(result)),
  );
  safeHandle('license:upload-song-page-background', (payload) => {
    const bytes = payload?.bytes;
    if (!(bytes instanceof Uint8Array) || !bytes.length) {
      return {
        ok: false,
        state: safeState(licenseManager.getState()),
        error: 'BACKGROUND_IMAGE_REQUIRED',
      };
    }
    if (bytes.byteLength > SONG_BACKGROUND_MAX_BYTES) {
      return {
        ok: false,
        state: safeState(licenseManager.getState()),
        error: 'PAYLOAD_TOO_LARGE',
      };
    }
    return licenseManager
      .uploadSongPageBackground(bytes, payload?.fileName)
      .then((result) => sanitizeBackgroundResponse({ ok: true, ...result }));
  });
  safeHandle('license:delete-song-page-background', () =>
    licenseManager
      .deleteSongPageBackground()
      .then((result) => sanitizeBackgroundResponse(result)),
  );

  return licenseManager.onStateChanged((snapshot) => {
    const window = getMainWindow();
    if (window && !window.isDestroyed?.())
      window.webContents.send(
        'license:state-changed',
        sanitizeStateSnapshot(snapshot),
      );
  });
}

function safeErrorCode(error) {
  const value = String(error?.code || error?.message || 'LICENSE_ERROR');
  return SAFE_ERROR_CODE_PATTERN.test(value) ? value : 'LICENSE_ERROR';
}

function safeState(value) {
  return SAFE_LICENSE_STATES.has(value) ? value : 'checking';
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

function safeString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function sanitizeSyncResponse(result = {}) {
  const response = { ok: result?.ok !== false };
  copyPrimitiveField(response, result, 'count');
  const songPageUrl = sanitizePublicUrl(result?.songPageUrl);
  if (songPageUrl !== undefined) response.songPageUrl = songPageUrl;
  return response;
}

function sanitizeCloudSongsResponse(result = {}) {
  const rawSongs = Array.isArray(result)
    ? result
    : Array.isArray(result?.songs)
      ? result.songs
      : Array.isArray(result?.items)
        ? result.items
        : [];
  const songs = rawSongs.map(sanitizeSong).filter(Boolean);
  return { songs };
}

function sanitizeSong(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of SONG_PUBLIC_FIELDS) copyPrimitiveField(result, value, key);
  return result;
}

function sanitizeBackgroundResponse(result = {}) {
  const response = { ok: result?.ok !== false, background: null };
  const background = sanitizeBackgroundInfo(result?.background);
  if (background) response.background = background;
  return response;
}

function sanitizeBackgroundInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  const url = sanitizeRelativeUrl(value.url);
  const previewUrl = sanitizePublicUrl(value.previewUrl);
  if (url !== undefined) result.url = url;
  if (previewUrl !== undefined) result.previewUrl = previewUrl;
  copyPrimitiveField(result, value, 'bytes');
  copyPrimitiveField(result, value, 'updatedAt');
  return Object.keys(result).length ? result : null;
}

function copyPrimitiveField(target, source, key) {
  if (
    !source ||
    typeof source !== 'object' ||
    !Object.prototype.hasOwnProperty.call(source, key)
  )
    return;
  const value = source[key];
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    target[key] = typeof value === 'string' ? value.slice(0, 4096) : value;
  }
}

function sanitizeRelativeUrl(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//')
  )
    return undefined;
  try {
    const parsed = new URL(value, 'https://license.invalid');
    if (
      parsed.origin !== 'https://license.invalid' ||
      parsed.username ||
      parsed.password ||
      hasCredentialQuery(parsed)
    )
      return undefined;
    return value.slice(0, 2048);
  } catch (_) {
    return undefined;
  }
}

function sanitizePublicUrl(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = new URL(value);
    const allowedProtocol =
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1');
    if (
      !allowedProtocol ||
      parsed.username ||
      parsed.password ||
      hasCredentialQuery(parsed)
    )
      return undefined;
    return parsed.href.slice(0, 2048);
  } catch (_) {
    return undefined;
  }
}

function hasCredentialQuery(url) {
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase().replace(/[_-]/g, '');
    if (
      normalized === 'authorization' ||
      normalized === 'cookie' ||
      normalized === 'password' ||
      normalized === 'passwd' ||
      normalized === 'key' ||
      normalized === 'activationcode' ||
      normalized === 'pairingcode' ||
      normalized === 'fingerprint' ||
      normalized === 'hardwareid' ||
      normalized.includes('privatekey') ||
      normalized.endsWith('token') ||
      normalized.endsWith('secret') ||
      normalized.endsWith('apikey') ||
      normalized.endsWith('signature')
    )
      return true;
  }
  return false;
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
  if (password.length > 256)
    return { ok: false, state: 'needs_activation', error: 'PASSWORD_TOO_LONG' };
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
