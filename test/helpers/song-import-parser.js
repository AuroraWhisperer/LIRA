'use strict';

const vm = require('node:vm');
const { readJsModuleBundle } = require('./js-module-bundle');

// Evaluates the admin text-import parser as the browser bundle does and returns its parsing entry points.
function loadSongImportParser() {
  const context = { window: { AdminApp: { utils: {} } } };
  vm.runInNewContext(
    `${readJsModuleBundle('public', 'js', 'admin', 'song-import-parser.js')}\nthis.parser = { parseTable, parseDelimited };`,
    context,
  );
  return context.parser;
}

module.exports = { loadSongImportParser };
