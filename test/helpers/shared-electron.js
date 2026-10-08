'use strict';

const { _electron } = require('playwright');

// Launches the bundled Electron for Playwright's Electron handshake. `ELECTRON_RUN_AS_NODE`
// makes the Electron binary start as plain Node, so the handshake never completes and every
// desktop test fails with an opaque "Process failed to launch!"; the variable is removed for
// the launched app only. Tests that deliberately run Electron as Node (build-integrity) keep
// spawning it themselves with their own environment.
function launchElectron(options = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return _electron.launch({ env, ...options });
}

module.exports = { launchElectron };
