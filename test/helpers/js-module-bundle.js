'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const LOCAL_IMPORT_PATTERN = /^import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"];\s*$/gm;

function readJsModuleBundle(...relativeSegments) {
  const visited = new Set();

  function read(filePath) {
    const resolvedPath = path.resolve(filePath);
    if (visited.has(resolvedPath)) return '';
    visited.add(resolvedPath);

    const source = fs.readFileSync(resolvedPath, 'utf8');
    const dependencies = [];
    const body = source.replace(LOCAL_IMPORT_PATTERN, (_statement, importPath) => {
      if (!importPath.startsWith('.')) {
        throw new Error(`Only local JavaScript imports can be bundled: ${importPath}`);
      }
      dependencies.push(read(path.resolve(path.dirname(resolvedPath), importPath)));
      return '';
    });
    return `${dependencies.join('\n')}\n${body.replace(/^export\s+/gm, '')}`;
  }

  return read(path.join(ROOT_DIR, ...relativeSegments));
}

module.exports = { readJsModuleBundle };

