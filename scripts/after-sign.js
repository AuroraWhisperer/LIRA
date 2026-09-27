'use strict';

const { generatePackagedManifest } = require('./client-integrity-manifest');

// Signing may change unpacked binaries. Refresh before building the installer.
module.exports = generatePackagedManifest;
