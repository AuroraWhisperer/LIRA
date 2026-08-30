'use strict';

/**
 * Owns the Electron `powerMonitor` resume listener for the license manager.
 * Extracted from main.js so the wiring can be unit-tested with a fake
 * powerMonitor. `getLicenseManager` is a function so the handler always
 * resolves the current manager reference.
 */
function createLicenseResumeHandler({
  powerMonitor,
  getLicenseManager,
  afterResume = () => {},
  writeLog = () => {},
} = {}) {
  if (!powerMonitor) throw new Error('powerMonitor is required');
  if (typeof getLicenseManager !== 'function')
    throw new Error('getLicenseManager must be a function');

  let resumeHandler = null;

  function register() {
    unregister();
    resumeHandler = async () => {
      const manager = getLicenseManager();
      try {
        await manager?.resume?.();
        await afterResume();
      } catch (error) {
        writeLog('license-resume-check', error);
      }
    };
    powerMonitor.on('resume', resumeHandler);
  }

  function unregister() {
    if (!resumeHandler) return;
    powerMonitor.removeListener('resume', resumeHandler);
    resumeHandler = null;
  }

  return {
    register,
    unregister,
    get isRegistered() {
      return resumeHandler !== null;
    },
  };
}

module.exports = { createLicenseResumeHandler };
