'use strict';

const path = require('node:path');
const vm = require('node:vm');
const { sanitizeSource } = require('./esm-source-sanitizer');

// Parse static ESM declarations without evaluating product code. Literal
// require/import calls are included only at executable source positions;
// computed paths and runtime globals still need ownership review.
function buildDependencyGraph(sources) {
  const graph = new Map();
  for (const [file, source] of sources) {
    const specifiers = new Set(new vm.SourceTextModule(source, { identifier: file }).dependencySpecifiers);
    const sanitized = sanitizeSource(source);
    for (const match of source.matchAll(/\b(?:require|import)\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g)) {
      if (/^(?:require|import)\b/.test(sanitized.slice(match.index))) specifiers.add(match[2]);
    }
    const dependencies = new Set();
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/js/')) continue;
      const pathname = specifier.split(/[?#]/, 1)[0];
      const base = specifier.startsWith('/js/')
        ? path.posix.join('public', pathname)
        : path.posix.join(path.posix.dirname(file), pathname);
      const target = [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, `${base}/index.js`]
        .find(candidate => sources.has(candidate));
      if (target) dependencies.add(target);
    }
    graph.set(file, [...dependencies]);
  }
  return graph;
}

function findDependencyCycles(graph) {
  const visited = new Set();
  const active = new Set();
  const chain = [];
  const cycles = [];
  function visit(file) {
    if (active.has(file)) {
      cycles.push([...chain.slice(chain.indexOf(file)), file]);
      return;
    }
    if (visited.has(file)) return;
    visited.add(file);
    active.add(file);
    chain.push(file);
    for (const dependency of graph.get(file)) visit(dependency);
    chain.pop();
    active.delete(file);
  }
  for (const file of graph.keys()) visit(file);
  return cycles;
}

module.exports = { buildDependencyGraph, findDependencyCycles };
