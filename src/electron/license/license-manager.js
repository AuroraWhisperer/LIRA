'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const {
  PROTOCOL_VERSION,
  validateActivationInput,
  normalizeFingerprint,
  countFingerprintValues,
  buildActivationPayload,
  buildAuthPayload,
  signPayload
} = require('./license-protocol');
const { createRemoteLicenseClient, RemoteLicenseError } = require('./remote-license-client');
const { createDeviceKeyStore } = require('./device-key-store');
const { createLicenseStateStore } = require('./license-state-store');
const { createHardwareFingerprint } = require('./hardware-fingerprint');
const { getBuildInfo } = require('./build-integrity');

const LicenseState = Object.freeze({
  CHECKING: 'checking',
  NEEDS_ACTIVATION: 'needs_activation',
  NEEDS_CONNECTION: 'needs_connection',
  AUTHORIZING: 'authorizing',
  AUTHORIZED: 'authorized',
  BLOCKED: 'blocked'
});

const BLOCKED_CODES = new Set([
  'DEVICE_REVOKED', 'LICENSE_REVOKED', 'STREAMER_DISABLED',
  'DEVICE_FINGERPRINT_MISMATCH', 'SIGNATURE_INVALID', 'BUILD_NOT_ALLOWED',
  'INTEGRITY_NOT_VERIFIED', 'BUILD_ID_REQUIRED'
]);

function createLicenseManager(options = {}) {
  const appVersion = String(options.appVersion || '0.0.0');
  const stateStore = options.stateStore || createLicenseStateStore({ dataDir: options.dataDir });
  const keyStore = options.keyStore || createDeviceKeyStore({ dataDir: options.dataDir, safeStorage: options.safeStorage });
  const fingerprintProvider = options.fingerprintProvider || createHardwareFingerprint();
  const remote = options.remoteClient || createRemoteLicenseClient({
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
    isProduction: options.isProduction,
    allowInsecure: options.allowInsecure
  });
  const buildInfoProvider = options.buildInfoProvider || (() => getBuildInfo({
    appVersion,
    isPackaged: options.isPackaged,
    appPath: options.appPath
  }));
  const runtimeId = String(options.runtimeId || `lira:${crypto.randomUUID()}`);
  let state = LicenseState.CHECKING;
  let lastError = '';
  let identity = null;
  let profile = null;
  let accessToken = '';
  let tokenExpiresAt = 0;
  let renewalTimer = null;
  let heartbeatTimer = null;
  let busy = null;
  const listeners = new Set();

  function getState() { return state; }

  function getSnapshot() {
    return {
      state,
      error: lastError || null,
      streamer: sanitizeStreamer(profile?.streamer || identity),
      device: profile?.device ? sanitizeDevice(profile.device) : undefined
    };
  }

  function onStateChanged(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setState(next, error = '') {
    state = next;
    lastError = error || '';
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try { listener(snapshot); } catch (error) { void error; }
    }
    return state;
  }

  async function bootstrap() {
    if (busy) return busy;
    busy = (async () => {
      setState(LicenseState.CHECKING);
      identity = stateStore.read();
      if (!identity) {
        clearSession();
        return setState(LicenseState.NEEDS_ACTIVATION);
      }
      try {
        const privateKey = keyStore.loadPrivateKey();
        if (!privateKey) {
          clearSession();
          return setState(LicenseState.NEEDS_ACTIVATION, 'DEVICE_KEY_UNAVAILABLE');
        }
        await authenticate(identity, privateKey);
        return state;
      } catch (error) {
        return handleAuthError(error);
      }
    })();
    try { return await busy; } finally { busy = null; }
  }

  async function activate(input = {}) {
    if (busy) return busy;
    busy = (async () => {
      const validated = validateActivationInput(input);
      if (!validated.ok) {
        setState(LicenseState.NEEDS_ACTIVATION, validated.error);
        return { ok: false, state, error: validated.error };
      }
      setState(LicenseState.AUTHORIZING);
      try {
        let keyPair;
        try { keyPair = keyStore.loadOrCreate(); } catch (error) {
          if (typeof keyStore.createNew !== 'function') throw error;
          keyPair = keyStore.createNew();
        }
        const fingerprint = normalizeFingerprint(await fingerprintProvider.collect());
        if (countFingerprintValues(fingerprint) < 2) throw new RemoteLicenseError('FINGERPRINT_UNAVAILABLE', '无法读取足够的设备标识，暂时无法完成绑定。');
        const build = buildInfoProvider();
        const deviceName = String(options.deviceName || os.hostname()).trim().slice(0, 100);
        const platform = `${process.platform}-${process.arch}`.slice(0, 40);
        const canonical = buildActivationPayload({
          ...validated,
          deviceName,
          platform,
          appVersion: build.appVersion,
          buildId: build.buildId,
          keyProtection: keyPair.keyProtection,
          publicKeyPem: keyPair.publicKeyPem,
          fingerprint
        });
        const result = await remote.activate({
          protocolVersion: PROTOCOL_VERSION,
          code: validated.activationCode,
          accountName: validated.accountName,
          password: validated.password,
          deviceName,
          platform,
          appVersion: build.appVersion,
          buildId: build.buildId,
          publicKey: keyPair.publicKeyPem,
          activationSignature: signPayload(canonical, keyPair.privateKeyPem),
          keyProtection: keyPair.keyProtection,
          integrityStatus: build.integrityStatus,
          fingerprint
        });
        identity = stateStore.write({
          deviceId: result.deviceId,
          licenseId: result.licenseId,
          streamerId: result.streamerId,
          accountName: validated.accountName,
          subdomain: result.streamer?.subdomain || validated.accountName,
          publicKeyPem: keyPair.publicKeyPem,
          keyProtection: keyPair.keyProtection,
          deviceName,
          createdAt: new Date().toISOString()
        });
        await authenticate(identity, keyPair.privateKeyPem);
        return { ok: true, state, streamer: sanitizeStreamer(profile?.streamer || result.streamer) };
      } catch (error) {
        clearSession();
        const next = handleAuthError(error);
        return { ok: false, state: next, error: getErrorCode(error) };
      }
    })();
    try { return await busy; } finally { busy = null; }
  }

  async function retry() {
    return bootstrap();
  }

  async function ensureAuthorized() {
    if (state !== LicenseState.AUTHORIZED || !accessToken) throw new Error('LICENSE_NOT_AUTHORIZED');
    if (tokenExpiresAt && tokenExpiresAt <= Date.now()) {
      const renewed = await renew();
      if (!renewed || state !== LicenseState.AUTHORIZED || !accessToken) throw new Error('LICENSE_NOT_AUTHORIZED');
    }
    return accessToken;
  }

  function getAccessToken() { return accessToken; }

  async function getProfile() {
    const token = await ensureAuthorized();
    const result = await remote.profile(token);
    profile = result;
    return getSnapshot();
  }

  async function syncSongs(songs) {
    if (!Array.isArray(songs) || songs.length > 5000) throw new RemoteLicenseError('SONG_LIST_INVALID', '歌库数量超出同步上限。');
    const list = songs.map(mapSongForSync);
    const token = await ensureAuthorized();
    return remote.syncSongs(list, token);
  }

  async function createPairingCode() { return remote.createPairingCode(await ensureAuthorized()); }
  async function listPairingCodes() { return remote.listPairingCodes(await ensureAuthorized()); }
  async function revokePairingCode(id) { return remote.revokePairingCode(id, await ensureAuthorized()); }

  async function authenticate(currentIdentity, privateKeyPem, attempt = 0) {
    const fingerprint = normalizeFingerprint(await fingerprintProvider.collect());
    if (countFingerprintValues(fingerprint) < 2) throw new RemoteLicenseError('FINGERPRINT_UNAVAILABLE', '无法读取足够的设备标识，暂时无法完成绑定。');
    const build = buildInfoProvider();
    const challenge = await remote.challenge({ deviceId: currentIdentity.deviceId });
    const canonical = buildAuthPayload({
      protocolVersion: PROTOCOL_VERSION,
      deviceId: currentIdentity.deviceId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      runtimeId,
      appVersion: build.appVersion,
      buildId: build.buildId,
      integrityStatus: build.integrityStatus,
      fingerprint,
      virtualization: Boolean(options.virtualization)
    });
    let result;
    try {
      result = await remote.verify({
        protocolVersion: PROTOCOL_VERSION,
        deviceId: currentIdentity.deviceId,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature: signPayload(canonical, privateKeyPem),
        runtimeId,
        appVersion: build.appVersion,
        buildId: build.buildId,
        integrityStatus: build.integrityStatus,
        fingerprint,
        environment: { virtualization: Boolean(options.virtualization) }
      });
    } catch (error) {
      if (getErrorCode(error) === 'CHALLENGE_EXPIRED' && attempt < 1) {
        return authenticate(currentIdentity, privateKeyPem, attempt + 1);
      }
      throw error;
    }
    accessToken = String(result.accessToken || '');
    if (!accessToken) throw new RemoteLicenseError('SIGNATURE_INVALID', '授权服务器未返回有效会话。');
    tokenExpiresAt = Date.now() + parseExpiresIn(result.expiresIn);
    profile = result.streamer ? { streamer: result.streamer, device: { id: result.deviceId, licenseId: result.licenseId } } : profile;
    setState(LicenseState.AUTHORIZED);
    scheduleSessionMaintenance();
    return result;
  }

  async function renew() {
    if (!identity || state !== LicenseState.AUTHORIZED) return false;
    try {
      const privateKey = keyStore.loadPrivateKey();
      await authenticate(identity, privateKey);
      return true;
    } catch (error) {
      if (isRetryableAuthError(error) && accessToken && tokenExpiresAt > Date.now()) {
        scheduleRenewalRetry();
        return false;
      }
      handleAuthError(error);
      return false;
    }
  }

  function scheduleRenewalRetry() {
    clearTimeout(renewalTimer);
    const remaining = Math.max(0, tokenExpiresAt - Date.now());
    const retryDelay = Math.min(30000, Math.max(5000, remaining));
    renewalTimer = setTimeout(() => { renew().catch(() => {}); }, retryDelay);
    renewalTimer.unref?.();
  }

  function scheduleSessionMaintenance() {
    clearTimeout(renewalTimer);
    clearTimeout(heartbeatTimer);
    const renewDelay = Math.max(30000, tokenExpiresAt - Date.now() - 75000);
    renewalTimer = setTimeout(() => { renew().catch(() => {}); }, renewDelay);
    heartbeatTimer = setTimeout(async function heartbeat() {
      if (state !== LicenseState.AUTHORIZED || !accessToken) return;
      try {
        await remote.heartbeat(accessToken);
      } catch (error) {
        if (!(isRetryableAuthError(error) && tokenExpiresAt > Date.now())) {
          handleAuthError(error);
          return;
        }
      }
      heartbeatTimer = setTimeout(heartbeat, 150000);
    }, 150000);
    renewalTimer.unref?.();
    heartbeatTimer.unref?.();
  }

  function clearSession() {
    accessToken = '';
    tokenExpiresAt = 0;
    profile = null;
    clearTimeout(renewalTimer);
    clearTimeout(heartbeatTimer);
    renewalTimer = null;
    heartbeatTimer = null;
  }

  function handleAuthError(error) {
    const code = getErrorCode(error);
    clearSession();
    if (code === 'DEVICE_KEY_CORRUPT' || code === 'DEVICE_KEY_UNAVAILABLE') return setState(LicenseState.NEEDS_ACTIVATION, code);
    if (BLOCKED_CODES.has(code)) return setState(LicenseState.BLOCKED, code);
    if (code === 'NETWORK_UNAVAILABLE' || code === 'REQUEST_TIMEOUT') return setState(LicenseState.NEEDS_CONNECTION, code);
    if (code === 'CHALLENGE_EXPIRED') return setState(LicenseState.NEEDS_CONNECTION, code);
    if (code === 'DEVICE_NOT_FOUND') return setState(LicenseState.NEEDS_ACTIVATION, code);
    return setState(LicenseState.NEEDS_ACTIVATION, code);
  }

  function dispose() { clearSession(); listeners.clear(); }

  return {
    LicenseState,
    getState,
    getSnapshot,
    onStateChanged,
    bootstrap,
    activate,
    retry,
    ensureAuthorized,
    getAccessToken,
    getProfile,
    syncSongs,
    createPairingCode,
    listPairingCodes,
    revokePairingCode,
    dispose
  };
}

function parseExpiresIn(value) {
  const match = String(value || '').match(/^(\d+)\s*(s|m|h)?$/i);
  if (!match) return 10 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = String(match[2] || 's').toLowerCase();
  return amount * (unit === 'h' ? 3600000 : unit === 'm' ? 60000 : 1000);
}

function getErrorCode(error) { return error instanceof RemoteLicenseError ? error.code : String(error?.code || error?.message || 'NETWORK_UNAVAILABLE'); }

function isRetryableAuthError(error) {
  return error instanceof RemoteLicenseError && (
    error.retryable || error.code === 'NETWORK_UNAVAILABLE' || error.code === 'REQUEST_TIMEOUT'
  );
}

function sanitizeStreamer(value) {
  if (!value || typeof value !== 'object') return undefined;
  return {
    accountName: String(value.accountName || '').slice(0, 32),
    displayName: String(value.displayName || value.accountName || '').slice(0, 80),
    subdomain: String(value.subdomain || '').slice(0, 63),
    songPageUrl: String(value.songPageUrl || '').slice(0, 300),
    manageUrl: String(value.manageUrl || '').slice(0, 300)
  };
}

function sanitizeDevice(value) {
  return {
    id: String(value.id || '').slice(0, 128),
    name: String(value.name || '').slice(0, 100),
    status: String(value.status || '').slice(0, 32),
    licenseId: String(value.licenseId || '').slice(0, 128)
  };
}

function mapSongForSync(song = {}) {
  const enabled = song.isEnabled ?? song.is_enabled ?? song.enabled ?? true;
  return {
    name: String(song.name ?? song.title ?? '').trim(),
    artist: String(song.artist ?? '').trim(),
    categoryName: String(song.categoryName ?? song.category_name ?? '').trim(),
    tags: String(song.tags ?? '').trim(),
    language: String(song.language ?? '').trim(),
    sourcePlatform: String(song.sourcePlatform ?? song.source_platform ?? '').trim(),
    note: String(song.note ?? '').trim(),
    requestPrice: String(song.requestPrice ?? song.request_price ?? '').trim(),
    songClip: String(song.songClip ?? song.song_clip ?? '').trim(),
    isEnabled: !(enabled === false || enabled === 0 || String(enabled).toLowerCase() === 'false'),
    sortOrder: Number(song.sortOrder ?? song.sort_order ?? 0) || 0
  };
}

module.exports = { LicenseState, createLicenseManager, parseExpiresIn, mapSongForSync };
