'use strict';

const childProcess = require('node:child_process');

function openAdminPageIfNeeded(baseUrl) {
  if (process.env.AUTO_OPEN_ADMIN !== '1') return;
  const adminUrl = `${baseUrl}/admin`;
  const reportFailure = (error) => {
    console.log(`Open admin page manually: ${adminUrl}`);
    console.warn(`Could not open browser automatically: ${error.message}`);
  };
  try {
    if (process.platform === 'win32') {
      childProcess
        .spawn('cmd', ['/c', 'start', '', adminUrl], {
          detached: true,
          stdio: 'ignore',
        })
        .once('error', reportFailure)
        .unref();
    } else {
      console.log(`Open admin page manually: ${adminUrl}`);
    }
  } catch (error) {
    reportFailure(error);
  }
}

module.exports = { openAdminPageIfNeeded };
