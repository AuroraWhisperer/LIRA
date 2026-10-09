'use strict';

const { posix: path, normalize } = require('node:path');
const asar = require('@electron/asar');

function verifyPackagedDependencies(archivePath) {
  asar.uncache(archivePath);
  try {
    const files = new Set(asar.listPackage(archivePath).map((file) => file.replaceAll('\\', '/').replace(/^\/+/, '')));
    const visited = new Set();
    const missing = [];

    // Resolve only inside this archive, never against the build machine's node_modules.
    function resolveManifest(directory, name) {
      for (;;) {
        if (path.basename(directory) !== 'node_modules') {
          const candidate = path.join(directory, 'node_modules', name, 'package.json');
          if (files.has(candidate)) return candidate;
        }
        if (directory === '.') return null;
        directory = path.dirname(directory);
      }
    }

    function visit(filename) {
      if (visited.has(filename)) return;
      visited.add(filename);
      const manifest = JSON.parse(asar.extractFile(archivePath, normalize(filename)).toString('utf8'));
      const optional = manifest.optionalDependencies || {};
      for (const name of Object.keys({ ...manifest.dependencies, ...optional })) {
        const resolved = resolveManifest(path.dirname(filename), name);
        if (resolved) visit(resolved);
        else if (!Object.hasOwn(optional, name)) missing.push(`${filename} -> ${name}`);
      }
    }

    visit('package.json');
    if (missing.length) {
      throw new Error(
        `Missing packaged production dependencies:\n${missing.join('\n')}\n` +
        'Install locked dependencies in this build checkout with npm ci using its own node_modules directory, then rebuild.',
      );
    }
    return { packageCount: visited.size - 1 };
  } finally {
    asar.uncache(archivePath);
  }
}

module.exports = { verifyPackagedDependencies };
