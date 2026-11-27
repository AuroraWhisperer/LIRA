'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeAtomicFile } = require('../atomic-file');

const SAFE_FIELDS = [
  'schemaVersion',
  'protocolVersion',
  'deviceId',
  'licenseId',
  'streamerId',
  'accountName',
  'subdomain',
  'publicKeyPem',
  'keyProtection',
  'createdAt',
  'deviceName',
];

function createLicenseStateStore(options = {}) {
  const licenseDir = path.join(path.resolve(String(options.dataDir || process.cwd())), 'license');
  const statePath = path.join(licenseDir, 'license-state.json');

  function read() {
    if (!fs.existsSync(statePath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.deviceId || !parsed.publicKeyPem) return null;
      return pickSafeFields(parsed);
    } catch (_) {
      return null;
    }
  }

  function write(value = {}) {
    const next = pickSafeFields({
      schemaVersion: 1,
      protocolVersion: 2,
      ...value,
    });
    if (!next.deviceId || !next.publicKeyPem) throw new Error('LICENSE_STATE_INVALID');
    fs.mkdirSync(licenseDir, { recursive: true });
    writeAtomicFile(statePath, JSON.stringify(next, null, 2));
    return next;
  }

  return { read, write };
}

function pickSafeFields(value) {
  const result = {};
  for (const key of SAFE_FIELDS) {
    if (value[key] !== undefined && value[key] !== null) result[key] = value[key];
  }
  return result;
}

module.exports = { createLicenseStateStore, pickSafeFields };
