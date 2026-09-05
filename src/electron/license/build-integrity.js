'use strict';

// Electron's patched fs treats app.asar as a directory; hash the raw archive.
const fs = process.versions.electron
  ? require('original-fs')
  : require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function getBuildInfo(options = {}) {
  const appVersion = String(options.appVersion || '').trim() || '0.0.0';
  const isPackaged = options.isPackaged === true;
  const appPath = options.appPath || '';
  if (!isPackaged || !appPath || !fs.existsSync(appPath)) {
    return {
      appVersion,
      buildId: `LIRA/${appVersion}/dev`,
      integrityStatus: 'unverified',
    };
  }
  try {
    const digest = crypto
      .createHash('sha256')
      .update(fs.readFileSync(appPath))
      .digest('hex');
    return {
      appVersion,
      buildId: `LIRA/${appVersion}/${digest}`,
      integrityStatus: 'verified',
    };
  } catch (_) {
    return {
      appVersion,
      buildId: `LIRA/${appVersion}/unverified`,
      integrityStatus: 'unverified',
    };
  }
}

function getPackagedAsarPath(resourcesPath) {
  return path.join(String(resourcesPath || ''), 'app.asar');
}

module.exports = { getBuildInfo, getPackagedAsarPath };
