'use strict';

const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

function createHardwareFingerprint(options = {}) {
  const platform = options.platform || process.platform;
  const execFile = options.execFile || childProcess.execFile;
  const timeoutMs = Number(options.timeoutMs) || 2500;

  async function readCommand(command, args) {
    return new Promise((resolve) => {
      execFile(
        command,
        args,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 },
        (error, stdout) => {
          resolve(error ? '' : String(stdout || '').trim());
        },
      );
    });
  }

  async function collect() {
    const values = {
      machineGuidHash: '',
      smbiosUuidHash: '',
      systemDriveHash: '',
    };
    if (platform === 'win32') {
      const [machineGuid, smbiosUuid, driveSerial] = await Promise.all([
        readCommand('reg', [
          'query',
          'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
          '/v',
          'MachineGuid',
        ]),
        readCommand('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-CimInstance Win32_ComputerSystemProduct).UUID',
        ]),
        readCommand('cmd.exe', ['/d', '/c', 'vol %SystemDrive%']),
      ]);
      values.machineGuidHash = hashRaw(extractMachineGuid(machineGuid));
      values.smbiosUuidHash = hashRaw(smbiosUuid);
      values.systemDriveHash = hashRaw(extractVolumeSerial(driveSerial));
    } else {
      let machineId = '';
      try {
        machineId = fs.readFileSync('/etc/machine-id', 'utf8');
      } catch (error) {
        void error;
      }
      values.machineGuidHash = hashRaw(machineId || os.hostname());
      values.smbiosUuidHash = hashRaw(
        `${os.platform()}:${os.arch()}:${os.hostname()}`,
      );
      try {
        const stats = fs.statSync('/');
        values.systemDriveHash = hashRaw(`${stats.dev}:${stats.ino}`);
      } catch (error) {
        values.systemDriveHash = '';
        void error;
      }
    }
    return { version: 1, ...values };
  }

  return { collect };
}

function normalizeRaw(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .toLowerCase();
}

function hashRaw(value) {
  const normalized = normalizeRaw(value);
  return normalized
    ? crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')
    : '';
}

function extractMachineGuid(output) {
  const match = String(output || '').match(/MachineGuid\s+REG_SZ\s+(.+)/i);
  return match ? match[1] : output;
}

function extractVolumeSerial(output) {
  const match = String(output || '').match(/serial number is\s+([a-z0-9-]+)/i);
  return match ? match[1] : output;
}

module.exports = {
  createHardwareFingerprint,
  normalizeRaw,
  hashRaw,
  extractMachineGuid,
  extractVolumeSerial,
};
