'use strict';

const { viewerNameUid, viewerNameParameters, viewerNamesPageParameters, viewerNameSettingsParameters,
  sanitizeViewerName, sanitizeViewerNames, sanitizeViewerNameSettings } = require('../../shared/viewer-names-contract');

function registerLicenseViewerNameIpc({ safeHandle, licenseManager }) {
  async function read(operation, sanitize) {
    const generation = licenseManager.getAuthorizationGeneration?.();
    const result = await operation();
    if (generation !== licenseManager.getAuthorizationGeneration?.()) {
      throw Object.assign(new Error('LICENSE_NOT_AUTHORIZED'), { code: 'LICENSE_NOT_AUTHORIZED' });
    }
    return sanitize(result);
  }
  safeHandle('license:get-viewer-name-settings', () =>
    read(() => licenseManager.getViewerNameSettings(), sanitizeViewerNameSettings));
  safeHandle('license:update-viewer-name-settings', (input) => {
    const patch = viewerNameSettingsParameters(input);
    return read(() => licenseManager.updateViewerNameSettings(patch), sanitizeViewerNameSettings);
  });
  safeHandle('license:list-viewer-names', (input) => {
    const query = viewerNamesPageParameters(input);
    return read(() => licenseManager.listViewerNames(query), sanitizeViewerNames);
  });
  safeHandle('license:update-viewer-name', (input) => {
    const value = viewerNameParameters(input);
    return read(() => licenseManager.updateViewerName(value), sanitizeViewerName);
  });
  safeHandle('license:delete-viewer-name', (uid) => {
    viewerNameUid(uid);
    return read(() => licenseManager.deleteViewerName(uid), (result) => {
      if (result?.ok !== true) throw Object.assign(new Error('INVALID_RESPONSE'), { code: 'INVALID_RESPONSE' });
      return { ok: true };
    });
  });
}

module.exports = { registerLicenseViewerNameIpc };
