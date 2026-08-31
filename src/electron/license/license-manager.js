'use strict';

const crypto = require('node:crypto');
const licenseTokenUtils = require('./license-token-utils');
const licenseResponseUtils = require('./license-response-utils');
const { requestDeviceActivation } = require('./license-activation');
const { createLicenseErrorHandlers } = require('./license-error-handlers');
const { createLicenseOperations } = require('./license-operations');
const {
  PROTOCOL_VERSION,
  validateActivationInput,
  normalizeFingerprint,
  countFingerprintValues,
  buildAuthPayload,
  signPayload,
} = require('./license-protocol');
const {
  createRemoteLicenseClient,
  RemoteLicenseError,
} = require('./remote-license-client');
const { createDeviceKeyStore } = require('./device-key-store');
const { createLicenseStateStore } = require('./license-state-store');
const { createHardwareFingerprint } = require('./hardware-fingerprint');
const { getBuildInfo } = require('./build-integrity');
const { createRetryPolicy } = require('./retry-policy');
const {
  LicenseState,
  REAUTHENTICATE_CODES,
  RETRY_CHALLENGE_CODES,
  RENEW_EARLY_MS,
  HEARTBEAT_INTERVAL_MS,
  MAX_TIMER_DELAY_MS,
} = require('./license-runtime-policy');

const { resolveTokenExpiresAt, parseExpiresIn } = licenseTokenUtils;
const {
  getErrorCode,
  isRetryableAuthError,
  mapSongForSync,
  sanitizeDevice,
  sanitizeRemoteResponse,
  sanitizeStreamer,
} = licenseResponseUtils;

function createLicenseManager(options = {}) {
  const appVersion = String(options.appVersion || '0.0.0');
  const stateStore =
    options.stateStore || createLicenseStateStore({ dataDir: options.dataDir });
  const keyStore =
    options.keyStore ||
    createDeviceKeyStore({
      dataDir: options.dataDir,
      safeStorage: options.safeStorage,
    });
  const fingerprintProvider =
    options.fingerprintProvider || createHardwareFingerprint();
  const remote =
    options.remoteClient ||
    createRemoteLicenseClient({
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      isProduction: options.isProduction,
      allowInsecure: options.allowInsecure,
    });
  const buildInfoProvider =
    options.buildInfoProvider ||
    (() =>
      getBuildInfo({
        appVersion,
        isPackaged: options.isPackaged,
        appPath: options.appPath,
      }));
  const runtimeId = String(options.runtimeId || `lira:${crypto.randomUUID()}`);
  const randomSource =
    typeof options.randomSource === 'function'
      ? options.randomSource
      : Math.random;
  const suppliedTimers = options.timers || {};
  const timers = {
    setTimeout:
      typeof suppliedTimers.setTimeout === 'function'
        ? suppliedTimers.setTimeout
        : setTimeout,
    clearTimeout:
      typeof suppliedTimers.clearTimeout === 'function'
        ? suppliedTimers.clearTimeout
        : clearTimeout,
  };
  const renewalRetryPolicy = createRetryPolicy({
    jitter: () => randomSource(),
  });
  let state = LicenseState.CHECKING;
  let lastError = '';
  let identity = null;
  let profile = null;
  let accessToken = '';
  let tokenExpiresAt = 0;
  let renewalTimer = null;
  let heartbeatTimer = null;
  let renewalPromise = null;
  let heartbeatPromise = null;
  let busy = null;
  let disposed = false;
  let lifecycleGeneration = 0;
  const listeners = new Set();
  const { handleAuthError, handleProtectedRequestError, isBlockedCode } =
    createLicenseErrorHandlers({
      states: LicenseState,
      isDisposed: () => disposed,
      getState: () => state,
      hasAccessToken: () => Boolean(accessToken),
      getTokenExpiresAt: () => tokenExpiresAt,
      clearSession,
      resetRetryPolicy: () => renewalRetryPolicy.reset(),
      setState,
    });

  function getState() {
    return state;
  }

  function getSnapshot() {
    return {
      state,
      error: lastError || null,
      streamer: sanitizeStreamer(profile?.streamer || identity),
      device: profile?.device ? sanitizeDevice(profile.device) : undefined,
    };
  }

  function onStateChanged(listener) {
    if (disposed || typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setState(next, error = '') {
    const normalizedError = error || '';
    if (disposed || (state === next && lastError === normalizedError))
      return state;
    state = next;
    lastError = normalizedError;
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        void error;
      }
    }
    return state;
  }

  async function bootstrap() {
    if (disposed) return state;
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
          return setState(
            LicenseState.NEEDS_ACTIVATION,
            'DEVICE_KEY_UNAVAILABLE',
          );
        }
        await authenticate(identity, privateKey);
        return state;
      } catch (error) {
        return handleAuthError(error);
      }
    })();
    try {
      return await busy;
    } finally {
      busy = null;
    }
  }

  async function activate(input = {}) {
    if (disposed)
      return { ok: false, state, error: 'LICENSE_MANAGER_DISPOSED' };
    if (busy) return busy;
    const generation = lifecycleGeneration;
    busy = (async () => {
      const validated = validateActivationInput(input);
      if (!validated.ok) {
        setState(LicenseState.NEEDS_ACTIVATION, validated.error);
        return { ok: false, state, error: validated.error };
      }
      setState(LicenseState.AUTHORIZING);
      try {
        const activation = await requestDeviceActivation({
          validated,
          keyStore,
          fingerprintProvider,
          buildInfoProvider,
          remote,
          deviceName: options.deviceName,
          isActive: () => isLifecycleActive(generation),
        });
        if (!activation)
          return { ok: false, state, error: 'LICENSE_MANAGER_DISPOSED' };
        identity = stateStore.write(activation.identity);
        const authenticated = await authenticate(
          identity,
          activation.keyPair.privateKeyPem,
          0,
          generation,
        );
        if (!authenticated)
          return { ok: false, state, error: 'LICENSE_MANAGER_DISPOSED' };
        return {
          ok: true,
          state,
          streamer: sanitizeStreamer(
            profile?.streamer || activation.result.streamer,
          ),
        };
      } catch (error) {
        clearSession();
        const next = handleAuthError(error);
        return { ok: false, state: next, error: getErrorCode(error) };
      }
    })();
    try {
      return await busy;
    } finally {
      busy = null;
    }
  }

  async function retry() {
    return bootstrap();
  }

  async function ensureAuthorized() {
    if (disposed) throw new Error('LICENSE_NOT_AUTHORIZED');
    if (renewalPromise) await renewalPromise;
    if (state !== LicenseState.AUTHORIZED || !accessToken)
      throw new Error('LICENSE_NOT_AUTHORIZED');
    if (tokenExpiresAt && tokenExpiresAt <= Date.now()) {
      const renewed = await renew();
      if (!renewed || state !== LicenseState.AUTHORIZED || !accessToken)
        throw new Error('LICENSE_NOT_AUTHORIZED');
    }
    return accessToken;
  }

  function getAccessToken() {
    return accessToken;
  }

  // Internal composition roots use this validated client origin to resolve
  // immutable public catalog assets. It is intentionally absent from IPC.
  function getRemoteBaseUrl() {
    return remote.baseUrl;
  }

  async function withAuthorizedToken(operation, attempt = 0, sanitize = true) {
    const token = await ensureAuthorized();
    try {
      // Remote JSON is untrusted input.  Keep the device token and other
      // credentials inside the main process even if a proxy/server echoes
      // request fields back in a successful response.
      const result = await operation(token);
      return sanitize ? sanitizeRemoteResponse(result) : result;
    } catch (error) {
      const code = getErrorCode(error);
      if (
        attempt < 1 &&
        REAUTHENTICATE_CODES.has(code) &&
        state === LicenseState.AUTHORIZED
      ) {
        if (token !== accessToken && accessToken) {
          return withAuthorizedToken(operation, attempt + 1, sanitize);
        }
        const renewed = await renew({
          preserveValidSession: false,
          throwOnFailure: true,
        });
        if (renewed && state === LicenseState.AUTHORIZED && accessToken) {
          return withAuthorizedToken(operation, attempt + 1, sanitize);
        }
        if (state !== LicenseState.AUTHORIZED) throw error;
      }
      handleProtectedRequestError(error);
      throw error;
    }
  }

  async function authenticate(
    currentIdentity,
    privateKeyPem,
    attempt = 0,
    generation = lifecycleGeneration,
    expectedState = null,
    expectedToken = null,
  ) {
    const isAttemptActive = () =>
      isLifecycleActive(generation) &&
      (!expectedState || state === expectedState) &&
      (expectedToken === null || accessToken === expectedToken);
    if (!isAttemptActive()) return null;
    const fingerprint = normalizeFingerprint(
      await fingerprintProvider.collect(),
    );
    if (!isAttemptActive()) return null;
    if (countFingerprintValues(fingerprint) < 2)
      throw new RemoteLicenseError(
        'FINGERPRINT_UNAVAILABLE',
        '无法读取足够的设备标识，暂时无法完成绑定。',
      );
    const build = buildInfoProvider();
    const challenge = await remote.challenge({
      deviceId: currentIdentity.deviceId,
    });
    if (!isAttemptActive()) return null;
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
      virtualization: Boolean(options.virtualization),
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
        environment: { virtualization: Boolean(options.virtualization) },
      });
    } catch (error) {
      if (RETRY_CHALLENGE_CODES.has(getErrorCode(error)) && attempt < 1) {
        return authenticate(
          currentIdentity,
          privateKeyPem,
          attempt + 1,
          generation,
          expectedState,
          expectedToken,
        );
      }
      throw error;
    }
    if (!isAttemptActive()) return null;
    accessToken = String(result.accessToken || '');
    if (!accessToken)
      throw new RemoteLicenseError(
        'SIGNATURE_INVALID',
        '授权服务器未返回有效会话。',
      );
    tokenExpiresAt = resolveTokenExpiresAt(result, Date.now());
    profile = result.streamer
      ? {
          streamer: result.streamer,
          device: { id: result.deviceId, licenseId: result.licenseId },
        }
      : profile;
    setState(LicenseState.AUTHORIZED);
    scheduleSessionMaintenance();
    return result;
  }

  async function renew({
    preserveValidSession = true,
    throwOnFailure = false,
  } = {}) {
    if (disposed) return false;
    if (renewalPromise) return renewalPromise;
    const operation = (async () => {
      if (!identity || state !== LicenseState.AUTHORIZED) return false;
      const expectedToken = accessToken;
      try {
        const privateKey = keyStore.loadPrivateKey();
        const result = await authenticate(
          identity,
          privateKey,
          0,
          lifecycleGeneration,
          LicenseState.AUTHORIZED,
          expectedToken,
        );
        return Boolean(result);
      } catch (error) {
        const code = getErrorCode(error);
        if (isBlockedCode(code)) {
          handleAuthError(error);
          if (throwOnFailure) throw error;
          return false;
        }
        if (
          preserveValidSession &&
          isRetryableAuthError(error) &&
          accessToken &&
          tokenExpiresAt > Date.now()
        ) {
          scheduleRenewalRetry(error);
          return false;
        }
        handleAuthError(error);
        if (throwOnFailure) throw error;
        return false;
      }
    })();
    renewalPromise = operation;
    try {
      return await operation;
    } finally {
      if (renewalPromise === operation) renewalPromise = null;
    }
  }

  function scheduleRenewalRetry(error) {
    if (disposed) return;
    timers.clearTimeout(renewalTimer);
    const backoff = renewalRetryPolicy.nextDelay();
    if (backoff === null) {
      // Retries exhausted: stop hammering the server and surface the connection state.
      handleAuthError(
        error ||
          new RemoteLicenseError(
            'NETWORK_UNAVAILABLE',
            '授权服务器暂时不可用。',
            { retryable: true },
          ),
      );
      return;
    }
    const remaining = Math.max(0, tokenExpiresAt - Date.now());
    const retryDelay = Math.max(1000, Math.min(backoff, remaining));
    renewalTimer = timers.setTimeout(() => {
      renew().catch(() => {});
    }, retryDelay);
    renewalTimer.unref?.();
  }

  function scheduleSessionMaintenance() {
    if (disposed) return;
    renewalRetryPolicy.reset();
    timers.clearTimeout(renewalTimer);
    timers.clearTimeout(heartbeatTimer);
    const renewDelay = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(30000, tokenExpiresAt - Date.now() - RENEW_EARLY_MS),
    );
    renewalTimer = timers.setTimeout(() => {
      renew().catch(() => {});
    }, renewDelay);
    scheduleHeartbeat();
    renewalTimer.unref?.();
  }

  function scheduleHeartbeat() {
    if (disposed) return;
    timers.clearTimeout(heartbeatTimer);
    heartbeatTimer = timers.setTimeout(async () => {
      heartbeatTimer = null;
      await heartbeatNow();
      if (!disposed && state === LicenseState.AUTHORIZED) scheduleHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }

  async function heartbeatNow() {
    if (disposed) return false;
    if (heartbeatPromise) return heartbeatPromise;
    const operation = (async () => {
      if (state !== LicenseState.AUTHORIZED || !accessToken) return false;
      try {
        await withAuthorizedToken((token) => remote.heartbeat(token));
        return true;
      } catch (_) {
        return false;
      }
    })();
    heartbeatPromise = operation;
    try {
      return await operation;
    } finally {
      if (heartbeatPromise === operation) heartbeatPromise = null;
    }
  }

  async function resume() {
    if (disposed) return false;
    timers.clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
    if (state === LicenseState.NEEDS_CONNECTION) return bootstrap();
    if (state !== LicenseState.AUTHORIZED) return false;
    const result = await heartbeatNow();
    if (state === LicenseState.AUTHORIZED) scheduleHeartbeat();
    return result;
  }

  function clearSession() {
    accessToken = '';
    tokenExpiresAt = 0;
    profile = null;
    timers.clearTimeout(renewalTimer);
    timers.clearTimeout(heartbeatTimer);
    renewalTimer = null;
    heartbeatTimer = null;
  }

  function isLifecycleActive(generation) {
    return !disposed && generation === lifecycleGeneration;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    lifecycleGeneration += 1;
    clearSession();
    listeners.clear();
  }

  const {
    clearBilibiliCredentialsInternal,
    deleteSongPageBackground,
    getBilibiliCredentialsInternal,
    getCloudSongs,
    getCloudState,
    getGiftCatalog,
    getGiftEventsInternal,
    getProfile,
    getSongPageBackground,
    setBilibiliCredentialsInternal,
    syncSongs,
    updateCloudSettings,
    uploadSongPageBackground,
    watchCloudStateChangesInternal,
    watchGiftEventsInternal,
  } = createLicenseOperations({
    remote,
    withAuthorizedToken,
    withAuthorizedSecret: (operation) =>
      withAuthorizedToken(operation, 0, false),
    isDisposed: () => disposed,
    setProfile: (value) => {
      profile = value;
    },
    getSnapshot,
  });

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
    getRemoteBaseUrl,
    getProfile,
    getCloudState,
    updateCloudSettings,
    syncSongs,
    getCloudSongs,
    getGiftCatalog,
    getGiftEventsInternal,
    getSongPageBackground,
    uploadSongPageBackground,
    deleteSongPageBackground,
    getBilibiliCredentialsInternal,
    setBilibiliCredentialsInternal,
    clearBilibiliCredentialsInternal,
    watchCloudStateChangesInternal,
    watchGiftEventsInternal,
    resume,
    dispose,
  };
}

module.exports = {
  LicenseState,
  createLicenseManager,
  parseExpiresIn,
  resolveTokenExpiresAt,
  mapSongForSync,
};
