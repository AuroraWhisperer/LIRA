'use strict';

const { createLicenseTransport, DEFAULT_BASE_URL, resolveConfiguredBaseUrl } = require('./license-transport');
const { RemoteLicenseError } = require('./remote-license-error');
const { createDeviceAuthEndpoints } = require('./device-authentication');
const { createCloudAccountEndpoints } = require('./cloud-account-protocol');
const { createDisplaySettingsEndpoints } = require('./display-settings-protocol');
const { createGiftEndpoints } = require('./gift-protocol');
const { createSongEndpoints } = require('./song-protocol');

function createRemoteLicenseClient(options = {}) {
  const transport = createLicenseTransport(options);
  return {
    baseUrl: transport.baseUrl,
    ...createDeviceAuthEndpoints(transport),
    ...createCloudAccountEndpoints(transport),
    ...createDisplaySettingsEndpoints(transport),
    ...createGiftEndpoints(transport),
    ...createSongEndpoints(transport),
  };
}

module.exports = { DEFAULT_BASE_URL, createRemoteLicenseClient, RemoteLicenseError, resolveConfiguredBaseUrl };
