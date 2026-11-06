'use strict';

const { createCloudAccountOperations } = require('./cloud-account-protocol');
const { createDisplaySettingsOperations } = require('./display-settings-protocol');
const { createGiftOperations } = require('./gift-protocol');
const { createSongOperations } = require('./song-protocol');

function createLicenseOperations({
  remote, withAuthorizedToken, withAuthorizedSecret, getAuthorizationGeneration,
  getOverlayOwner, isDisposed, setProfile, getSnapshot,
} = {}) {
  return {
    ...createCloudAccountOperations({ remote, withAuthorizedToken, withAuthorizedSecret, getAuthorizationGeneration, setProfile, getSnapshot }),
    ...createDisplaySettingsOperations({ remote, withAuthorizedToken, getAuthorizationGeneration, getOverlayOwner, isDisposed }),
    ...createGiftOperations({ remote, withAuthorizedToken }),
    ...createSongOperations({ remote, withAuthorizedToken }),
  };
}

module.exports = { createLicenseOperations };
