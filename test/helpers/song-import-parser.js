'use strict';

const path = require('node:path');
const { loadModuleExports } = require('./frontend-modules');

// Loads the same module graph as the admin text-import UI.
function loadSongImportParser() {
  return loadModuleExports(
    path.join(__dirname, '../../public/js/admin/song-import-parser.js'),
    { window: { AdminApp: { utils: {} } } },
  );
}

module.exports = { loadSongImportParser };
