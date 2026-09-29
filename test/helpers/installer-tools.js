'use strict';

const fs = require('node:fs');
const path = require('node:path');

function findCachedDirectory(root, requiredFiles) {
  if (!fs.existsSync(root)) return undefined;
  const directories = [
    root,
    ...fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .sort(),
  ];
  return directories.find((directory) => requiredFiles.every((file) => fs.existsSync(path.join(directory, file))));
}

function resolveInstallerTools(env = process.env) {
  const cache =
    env.ELECTRON_BUILDER_CACHE || (env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'electron-builder', 'Cache'));
  const compilerRoot =
    !env.LIRA_TEST_MAKENSIS && cache && findCachedDirectory(path.join(cache, 'nsis-3.0.4.1'), ['Bin/makensis.exe']);
  const pluginRoot =
    !env.LIRA_TEST_NSIS_PLUGINS &&
    cache &&
    findCachedDirectory(path.join(cache, 'nsis-resources-3.4.1'), [
      'plugins/x86-unicode/StdUtils.dll',
      'plugins/x86-unicode/nsProcess.dll',
    ]);
  return {
    compiler: env.LIRA_TEST_MAKENSIS || (compilerRoot ? path.join(compilerRoot, 'Bin', 'makensis.exe') : undefined),
    plugins: env.LIRA_TEST_NSIS_PLUGINS || (pluginRoot ? path.join(pluginRoot, 'plugins', 'x86-unicode') : undefined),
  };
}

module.exports = { resolveInstallerTools };
