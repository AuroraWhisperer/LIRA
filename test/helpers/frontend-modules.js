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
  const context = vm.createContext({
    console,
    fetch: globals.fetch,
    window: {},
    ...globals,
  });

  if (typeof vm.SourceTextModule !== 'function') {
    const source = fs.readFileSync(entryPath, 'utf8');
    const exportNames = [];
    for (const match of source.matchAll(
      /^export\s+(?:(?:async)\s+)?(?:class|function|const|let|var)\s+([\w$]+)/gm,
    )) {
      exportNames.push([match[1], match[1]]);
    }
    for (const match of source.matchAll(/^export\s*\{([^}]+)\}\s*;?/gm)) {
      for (const item of match[1].split(',')) {
        const [localName, exportedName] = item.trim().split(/\s+as\s+/);
        if (localName) exportNames.push([exportedName || localName, localName]);
      }
    }
    const namespaceExpression = `{${exportNames
      .map(
        ([exportedName, localName]) =>
          `${JSON.stringify(exportedName)}: typeof ${localName} === 'undefined' ? undefined : ${localName}`,
      )
      .join(',')}}`;
    const bundle = readJsModuleBundle(
      ...path
        .relative(path.resolve(__dirname, '..', '..'), entryPath)
        .split(path.sep),
    );
    const script = new vm.Script(
      `${bundle}\nglobalThis.__moduleNamespace = ${namespaceExpression};`,
      {
        filename: entryPath,
      },
    );
    script.runInContext(context);
    return context.__moduleNamespace;
  }

  const modules = new Map();

  async function load(filePath) {
    const identifier = pathToFileURL(filePath).href;
    if (modules.has(identifier)) return modules.get(identifier);
    const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
      context,
      identifier,
    });
    modules.set(identifier, module);
    await module.link((specifier, referencingModule) => {
      const dependencyUrl = new URL(specifier, referencingModule.identifier);
      return load(fileURLToPath(dependencyUrl));
    });
    return module;
  }

  const module = await load(entryPath);
  await module.evaluate();
  return module.namespace;
}

function response(payload) {
  return { ok: payload.ok !== false, payload };
}

module.exports = {
  createLyricToggleButton,
  loadModuleExports,
  response,
};
