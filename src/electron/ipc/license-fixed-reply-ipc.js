'use strict';

const { fixedReplyParameters, sanitizeFixedReplySettings } = require('../../shared/fixed-reply-contract');

function registerLicenseFixedReplyIpc({ safeHandle, licenseManager, onFixedReplySettings }) {
  async function readSettings(operation) {
    const generation = licenseManager.getAuthorizationGeneration?.();
    const result = await operation();
    const settings = sanitizeFixedReplySettings(result);
    if (generation !== licenseManager.getAuthorizationGeneration?.()) {
      throw Object.assign(new Error(), { code: 'LICENSE_NOT_AUTHORIZED' });
    }
    onFixedReplySettings?.(settings, result.revision);
    return settings;
  }
  safeHandle('license:get-fixed-reply-settings', () => readSettings(() => licenseManager.getFixedReplySettings()), true);
  safeHandle('license:update-fixed-reply-settings', (settings) => {
    const patch = fixedReplyParameters(settings);
    return readSettings(() => licenseManager.updateFixedReplySettings(patch));
  }, true);
}

module.exports = { registerLicenseFixedReplyIpc };
