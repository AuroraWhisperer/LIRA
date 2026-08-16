'use strict';

function createDesktopState() {
  return {
    window: {
      main: null,
      baseUrl: ''
    },
    lifecycle: {
      runtime: null,
      shutdown: null,
      gracefulQuitStarted: false,
      forceQuitTimer: null
    },
    media: {
      headersConfigured: false,
      localAccess: null,
      providerRegistry: null
    },
    paths: {
      dataDir: '',
      logDir: '',
      logFile: '',
      terminalLogFile: ''
    },
    logging: {
      runId: '',
      sequence: 0
    },
    update: {
      value: {
        status: 'idle',
        message: '尚未检查更新',
        version: '',
        canDownload: false,
        canInstall: false,
        progress: null,
        updateVersion: ''
      },
      lastStatus: ''
    }
  };
}

module.exports = { createDesktopState };
