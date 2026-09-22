'use strict';

const { LicenseState } = require('./license/license-runtime-policy');

function createDesktopReadinessController({
  licenseManager,
  runtime,
  remoteGiftController,
  cloudSyncController,
  getMainWindow,
  baseUrl,
  writeLog,
}) {
  let active = false;
  let disposed = false;
  let recoveryGeneration = 0;
  const initialRoute =
    licenseManager.getState() === LicenseState.AUTHORIZED && runtime.isGiftCatalogInitialized() ? 'admin' : 'license';
  const navigation = createMainNavigation({
    initialRoute,
    getMainWindow,
    baseUrl,
    writeLog,
  });
  const navigateMain = navigation.navigate;
  let unsubscribeCatalog = null;
  let unsubscribeLicense = null;

  function resumeAuthorizedWork(startup) {
    const generation = recoveryGeneration;
    const authorizationEpoch = licenseManager.getAuthorizationEpoch?.();
    // Source switching must freeze before waiting for cloud restoration.
    const giftStart = remoteGiftController?.start();
    const cloudReady = startup
      ? cloudSyncController?.start().catch((error) => writeLog('cloud-sync', error))
      : cloudSyncController?.whenIdle();
    const resume = cloudReady?.then(() => {
      if (
        active &&
        generation === recoveryGeneration &&
        authorizationEpoch === licenseManager.getAuthorizationEpoch?.() &&
        licenseManager.getState() === LicenseState.AUTHORIZED
      ) {
        return runtime.resumeAuthorizedWork?.();
      }
    });
    Promise.all([giftStart, resume]).catch((error) => writeLog('license-resume', error));
  }

  function onCatalogChanged(snapshot) {
    if (
      active &&
      snapshot?.status === 'ready' &&
      licenseManager.getState() === LicenseState.AUTHORIZED &&
      runtime.isGiftCatalogInitialized()
    ) {
      navigateMain('admin');
    }
  }

  function onLicenseChanged(snapshot) {
    if (!active) return;
    recoveryGeneration += 1;
    writeLog('license-state', {
      event: 'changed',
      state: snapshot.state,
      error: snapshot.error || null,
    });
    if (snapshot.state === LicenseState.AUTHORIZED) {
      resumeAuthorizedWork(false);
      const ready = runtime.isGiftCatalogInitialized();
      navigateMain(ready ? 'admin' : 'license');
      refreshGiftCatalog(runtime, ready ? 'authorized-session' : 'first-authorization', writeLog);
    } else {
      remoteGiftController?.stop();
    }
    if (
      snapshot.state !== LicenseState.AUTHORIZED &&
      snapshot.state !== LicenseState.CHECKING &&
      snapshot.state !== LicenseState.AUTHORIZING
    ) {
      runtime.pauseAuthorizedWork?.();
      navigateMain('license');
    }
  }

  function start() {
    if (active || disposed) return;
    active = true;
    unsubscribeCatalog = runtime.onGiftCatalogInitializationStateChanged(onCatalogChanged);
    unsubscribeLicense = licenseManager.onStateChanged(onLicenseChanged);
    if (licenseManager.getState() === LicenseState.AUTHORIZED) {
      resumeAuthorizedWork(true);
      refreshGiftCatalog(
        runtime,
        runtime.isGiftCatalogInitialized() ? 'authorized-startup' : 'first-authorized-startup',
        writeLog,
      );
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    active = false;
    recoveryGeneration += 1;
    navigation.dispose();
    unsubscribeCatalog?.();
    unsubscribeLicense?.();
  }

  return { initialRoute, start, dispose };
}

function refreshGiftCatalog(runtime, reason, writeLog) {
  const initialization = runtime.initializeGiftCatalog({ force: true, reason });
  initialization?.catch?.((error) => writeLog('gift-catalog-initialization', error));
  return initialization;
}

// Navigation owns route deduplication and loadURL completion generations.
function createMainNavigation({ initialRoute, getMainWindow, baseUrl, writeLog }) {
  let active = true;
  let mainRoute = initialRoute;
  let navigationGeneration = 0;
  function navigateMain(route) {
    const window = getMainWindow();
    if (!active || mainRoute === route || !window || window.isDestroyed()) return;
    mainRoute = route;
    const generation = ++navigationGeneration;
    const pathname = route === 'admin' ? '/admin?desktop=1' : '/license';
    window.loadURL(baseUrl + pathname).catch((error) => {
      if (active && generation === navigationGeneration && mainRoute === route) {
        mainRoute = '';
      }
      writeLog('license-navigation', error);
    });
  }

  return {
    navigate: navigateMain,
    dispose() {
      active = false;
      navigationGeneration += 1;
    },
  };
}

module.exports = { createDesktopReadinessController };
