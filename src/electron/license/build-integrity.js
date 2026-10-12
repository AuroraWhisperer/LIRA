'use strict';

// Electron's patched fs treats app.asar as a directory; hash the raw archive.
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function getBuildInfo(options = {}) {
  const appVersion = String(options.appVersion || '').trim() || '0.0.0';
  const isPackaged = options.isPackaged === true;
  const appPath = options.appPath || '';
  let exists = false;
  if (isPackaged && appPath) {
    try {
      await fs.promises.access(appPath);
      exists = true;
    } catch (_) {
      exists = false;
    }
  }
  if (!exists) {
    return {
      appVersion,
      buildId: `LIRA/${appVersion}/dev`,
      integrityStatus: 'unverified',
    };
  }
  try {
    const archive = await fs.promises.open(appPath, 'r');
    try {
      const hash = crypto.createHash('sha256');
      const buffer = Buffer.allocUnsafe(64 * 1024);
      for (;;) {
        const { bytesRead } = await archive.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
      }
      return {
        appVersion,
        buildId: `LIRA/${appVersion}/${hash.digest('hex')}`,
        integrityStatus: 'verified',
      };
    } finally {
      await archive.close();
    }
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
