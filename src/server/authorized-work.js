'use strict';

function createAuthorizedWorkController({
  isLicenseAuthorized,
  getBilibiliRuntime,
  getOvertimeGiftCatalog,
}) {
  function resumeAuthorizedWork() {
    const bilibiliRuntime = getBilibiliRuntime();
    if (!isLicenseAuthorized() || !bilibiliRuntime) {
      return Promise.resolve(false);
    }

    const catalogRefresh = getOvertimeGiftCatalog()?.refreshRemote?.({
      reason: 'authorization',
      force: true,
    });
    if (catalogRefresh?.catch) {
      catalogRefresh.catch((error) => {
        console.warn(
          `[GiftCatalog] authorization refresh failed: ${error.message}`,
        );
      });
    }
    return bilibiliRuntime.reconnect().then(() => true);
  }

  function pauseAuthorizedWork() {
    getBilibiliRuntime()?.disconnect?.();
  }

  return { resumeAuthorizedWork, pauseAuthorizedWork };
}

module.exports = { createAuthorizedWorkController };
