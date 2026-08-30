'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

function readCssBundle(...relativeSegments) {
  const visited = new Set();

  function read(filePath) {
    const resolvedPath = path.resolve(filePath);
    if (visited.has(resolvedPath)) return '';
    visited.add(resolvedPath);

    const source = fs.readFileSync(resolvedPath, 'utf8');
    return source.replace(
      /@import\s+url\(['"]([^'"]+)['"]\);/g,
      (_statement, importPath) => {
        if (/^(?:[a-z]+:|\/)/i.test(importPath)) return '';
        return read(path.resolve(path.dirname(resolvedPath), importPath));
      },
    );
  }

  return read(path.join(ROOT_DIR, ...relativeSegments));
}

module.exports = { readCssBundle };
