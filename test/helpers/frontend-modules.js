'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { readJsModuleBundle } = require('./js-module-bundle');

function createLyricToggleButton() {
  const classes = new Set();
  return {
    style: {},
    title: '',
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      },
    },
  };
}

async function loadModuleExports(entryPath, globals = {}) {
  // An array selects the entry and imported dependency namespaces from one graph.
  const entryPaths = Array.isArray(entryPath) ? entryPath : [entryPath];
  const context = vm.createContext({
    console,
    AbortSignal,
    fetch: globals.fetch,
    window: {},
    ...globals,
  });

  if (typeof vm.SourceTextModule !== 'function') {
    const namespaceExpressions = entryPaths.map((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      const exportNames = [];
      for (const match of source.matchAll(/^export\s+(?:(?:async)\s+)?(?:class|function|const|let|var)\s+([\w$]+)/gm)) {
        exportNames.push([match[1], match[1]]);
      }
      for (const match of source.matchAll(/^export\s*\{([^}]+)\}\s*;?/gm)) {
        for (const item of match[1].split(',')) {
          const [localName, exportedName] = item.trim().split(/\s+as\s+/);
          if (localName) exportNames.push([exportedName || localName, localName]);
        }
      }
      return `{${exportNames
        .map(
          ([exportedName, localName]) =>
            `${JSON.stringify(exportedName)}: typeof ${localName} === 'undefined' ? undefined : ${localName}`,
        )
        .join(',')}}`;
    });
    const bundle = readJsModuleBundle(...path.relative(path.resolve(__dirname, '..', '..'), entryPaths[0]).split(path.sep));
    const script = new vm.Script(`${bundle}\nglobalThis.__moduleNamespaces = [${namespaceExpressions.join(',')}];`, {
      filename: entryPaths[0],
    });
    script.runInContext(context);
    return Array.isArray(entryPath) ? context.__moduleNamespaces : context.__moduleNamespaces[0];
  }

  const modules = new Map();

  function load(filePath) {
    const identifier = pathToFileURL(filePath).href;
    if (modules.has(identifier)) return modules.get(identifier);
    const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
      context,
      identifier,
    });
    modules.set(identifier, module);
    return module;
  }

  const module = load(entryPaths[0]);
  await module.link((specifier, referencingModule) => {
    const dependencyUrl = new URL(specifier, referencingModule.identifier);
    return load(fileURLToPath(dependencyUrl));
  });
  await module.evaluate();
  return Array.isArray(entryPath) ? entryPaths.map((filePath) => {
    const dependency = modules.get(pathToFileURL(filePath).href);
    if (!dependency) throw new Error(`Module is not in the entry graph: ${filePath}`);
    return dependency.namespace;
  }) : module.namespace;
}

function response(payload) {
  return { ok: payload.ok !== false, payload };
}

module.exports = {
  createLyricToggleButton,
  loadModuleExports,
  response,
};
