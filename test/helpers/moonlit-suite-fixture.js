'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createMoonlitZip } = require('../../scripts/package-moonlit-suite');
const { createComponentStyleLibrary } = require('../../src/server/component-style-library');

let template;

// Installs the bundled Moonlit suite through the real library inspect/install
// path once per process, then copies the installed library into each isolated
// data directory. Tests that verify the import UI still upload the ZIP.
async function installMoonlitSuite(dataDir) {
  template ??= (async () => {
    const root = path.resolve(__dirname, '../../tmp');
    fs.mkdirSync(root, { recursive: true });
    const directory = fs.mkdtempSync(path.join(root, 'moonlit-suite-template-'));
    process.once('exit', () => fs.rmSync(directory, { recursive: true, force: true }));
    const library = createComponentStyleLibrary(directory);
    const pack = await library.inspect(Readable.from([createMoonlitZip()]), () => {});
    library.install(pack.id);
    return directory;
  })();
  fs.cpSync(await template, dataDir, { recursive: true });
}

module.exports = { installMoonlitSuite };
