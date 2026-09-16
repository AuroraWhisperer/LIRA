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
  let authorizationEpoch = 0;
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

  function getAuthorizationEpoch() {
    return authorizationEpoch;
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
    clearSession();
    const generation = lifecycleGeneration;
    busy = (async () => {
      setState(LicenseState.CHECKING);
      identity = stateStore.read();
      if (!identity) {
        clearSession();
        return setState(LicenseState.NEEDS_ACTIVATION);
      }
      try {
        const privateKeyPem = keyStore.loadPrivateKey();
        if (!privateKeyPem) {
          clearSession();
          return setState(
            LicenseState.NEEDS_ACTIVATION,
            'DEVICE_KEY_UNAVAILABLE',
          );
        }
        await authenticate({ identity, privateKeyPem, generation });
        return state;
      } catch (error) {
        if (!isLifecycleActive(generation)) return state;
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
    clearSession();
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
        const authenticated = await authenticate({
          identity,
          privateKeyPem: activation.keyPair.privateKeyPem,
          generation,
        });
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
        if (!isLifecycleActive(generation))
          return { ok: false, state, error: getErrorCode(error) };
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
    const context = captureAuthorizationContext();
    assertAuthorizationContext(context);
    if (renewalPromise) await renewalPromise;
    assertAuthorizationContext(context);
    if (state !== LicenseState.AUTHORIZED || !accessToken)
      throw new Error('LICENSE_NOT_AUTHORIZED');
    if (tokenExpiresAt && tokenExpiresAt <= Date.now()) {
      const renewed = await renew();
      assertAuthorizationContext(context);
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

  function captureAuthorizationContext() {
    return {
      generation: lifecycleGeneration,
      owner: JSON.stringify([
        identity?.streamerId,
        identity?.deviceId,
        identity?.licenseId,
      ]),
    };
  }

  function isAuthorizationContextActive(context) {
    return (
      isLifecycleActive(context.generation) &&
      context.owner === captureAuthorizationContext().owner
    );
  }

  function assertAuthorizationContext(context) {
    if (!isAuthorizationContextActive(context))
      throw new RemoteLicenseError(
        'LICENSE_NOT_AUTHORIZED',
        'LICENSE_NOT_AUTHORIZED',
      );
  }

  async function withAuthorizedToken(
    operation,
    attempt = 0,
    sanitize = true,
    acceptResult = (result) => result,
  ) {
    // Token renewal stays inside one lifecycle; activation, blocking and
    // disposal invalidate its requests even when the same owner returns later.
    const context = captureAuthorizationContext();
    return execute(attempt);

    async function execute(currentAttempt) {
      assertAuthorizationContext(context);
      const token = await ensureAuthorized();
      assertAuthorizationContext(context);
      try {
        // Remote JSON is untrusted input. Keep credentials in main even when
        // the server echoes them, and commit state before yielding again.
        const result = await operation(token);
        assertAuthorizationContext(context);
        return acceptResult(sanitize ? sanitizeRemoteResponse(result) : result);
      } catch (error) {
        if (!isAuthorizationContextActive(context)) throw error;
        const code = getErrorCode(error);
        if (
          currentAttempt < 1 &&
          REAUTHENTICATE_CODES.has(code) &&
          state === LicenseState.AUTHORIZED
        ) {
          if (token !== accessToken && accessToken) {
            return execute(currentAttempt + 1);
          }
          const renewed = await renew({
            preserveValidSession: false,
            throwOnFailure: true,
          });
          if (!isAuthorizationContextActive(context)) throw error;
          if (renewed && state === LicenseState.AUTHORIZED && accessToken) {
            return execute(currentAttempt + 1);
          }
          if (state !== LicenseState.AUTHORIZED) throw error;
        }
        handleProtectedRequestError(error);
        throw error;
      }
    }
  }

  async function authenticate({
    identity: currentIdentity,
    privateKeyPem,
    attempt = 0,
    generation = lifecycleGeneration,
    expectedState = null,
    expectedToken = null,
  }) {
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
        return authenticate({
          identity: currentIdentity,
          privateKeyPem,
          attempt: attempt + 1,
          generation,
          expectedState,
          expectedToken,
        });
      }
      throw error;
    }
    if (!isAttemptActive()) return null;
    return acceptAuthenticationResult(result);
  }

  function acceptAuthenticationResult(result) {
    accessToken = String(result.accessToken || '');
    if (!accessToken)
      throw new RemoteLicenseError(
        'SIGNATURE_INVALID',
        '授权服务器未返回有效会话。',
      );
    tokenExpiresAt = resolveTokenExpiresAt(result, Date.now());
    authorizationEpoch += 1;
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
    const context = captureAuthorizationContext();
    const operation = (async () => {
      if (!identity || state !== LicenseState.AUTHORIZED) return false;
      const expectedToken = accessToken;
      try {
        const privateKeyPem = keyStore.loadPrivateKey();
        const result = await authenticate({
          identity,
          privateKeyPem,
          generation: context.generation,
          expectedState: LicenseState.AUTHORIZED,
          expectedToken,
        });
        return Boolean(result);
      } catch (error) {
        if (!isAuthorizationContextActive(context)) {
          if (throwOnFailure) throw error;
          return false;
        }
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
    const generation = lifecycleGeneration;
    timers.clearTimeout(heartbeatTimer);
    heartbeatTimer = timers.setTimeout(async () => {
      heartbeatTimer = null;
      await heartbeatNow();
      if (isLifecycleActive(generation) && state === LicenseState.AUTHORIZED)
        scheduleHeartbeat();
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
    const generation = lifecycleGeneration;
    const result = await heartbeatNow();
    if (isLifecycleActive(generation) && state === LicenseState.AUTHORIZED)
      scheduleHeartbeat();
    return result;
  }

  function clearSession() {
    lifecycleGeneration += 1;
    if (accessToken || profile) authorizationEpoch += 1;
    accessToken = '';
    tokenExpiresAt = 0;
    profile = null;
    timers.clearTimeout(renewalTimer);
    timers.clearTimeout(heartbeatTimer);
    renewalTimer = null;
    heartbeatTimer = null;
    renewalPromise = null;
    heartbeatPromise = null;
  }

  function isLifecycleActive(generation) {
    return !disposed && generation === lifecycleGeneration;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearSession();
    listeners.clear();
  }

  const operations = createLicenseOperations({
    remote,
    withAuthorizedToken,
    withAuthorizedSecret: (operation) =>
      withAuthorizedToken(operation, 0, false),
    isDisposed: () => disposed,
    getOverlayOwner: () => JSON.stringify([identity?.streamerId, identity?.deviceId]),
    setProfile: (value) => {
      profile = value;
    },
    getSnapshot,
  });

  return {
    LicenseState,
    getState,
    getSnapshot,
    getAuthorizationEpoch,
    getCloudSyncIdentity: () =>
      identity
        ? { streamerId: identity.streamerId, accountName: identity.accountName }
        : null,
    onStateChanged,
    bootstrap,
    activate,
    retry,
    ensureAuthorized,
    getAccessToken,
    getRemoteBaseUrl,
    ...operations,
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
