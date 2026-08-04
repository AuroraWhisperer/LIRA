'use strict';

const { app } = require('electron');
const { main } = require('../capture-bilibili-events');

main().then(() => {
  app.exit(0);
}).catch((error) => {
  console.error(`[Capture] failed: ${error.message}`);
  app.exit(1);
});
