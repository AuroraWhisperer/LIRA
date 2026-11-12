'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');

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
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
    },
  };
}

async function loadModuleExports(entryPath, globals = {}, { entrySuffix = '', moduleFixtures = new Map() } = {}) {
  if (typeof vm.SourceTextModule !== 'function') {
    throw new Error('Frontend module tests require node --experimental-vm-modules.');
  }
  // An array selects the entry and imported dependency namespaces from one graph.
  const entryPaths = Array.isArray(entryPath) ? entryPath : [entryPath];
  const context = vm.isContext(globals) ? globals : vm.createContext({
    console,
    AbortSignal,
    fetch: globals.fetch,
    window: {},
    ...globals,
  });

  const modules = new Map();
  const fixtures = new Map([...moduleFixtures].map(([filePath, exports]) => [pathToFileURL(filePath).href, exports]));
  const entryIdentifier = pathToFileURL(entryPaths[0]).href;

  function load(filePath) {
    const identifier = pathToFileURL(filePath).href;
    if (modules.has(identifier)) return modules.get(identifier);
    const fixture = fixtures.get(identifier);
    const module = fixture
      ? new vm.SyntheticModule(Object.keys(fixture), function () {
        for (const [name, value] of Object.entries(fixture)) this.setExport(name, value);
      }, { context, identifier })
      : new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8') + (identifier === entryIdentifier ? entrySuffix : ''), {
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

// Existing white-box fixtures inspect entry-local state through a lexical probe.
// Imports and exports remain intact and are linked by the VM, including aliases
// and read-only imported bindings; dependency locals never become globals.
async function loadModuleScope(entryPath, globals = {}, moduleFixtures = new Map()) {
  const context = vm.isContext(globals) ? globals : vm.createContext(globals);
  const namespace = await loadModuleExports(entryPath, context, {
    entrySuffix: '\nexport const __evaluateTestExpression = (expression) => eval(expression);',
    moduleFixtures,
  });
  return namespace.__evaluateTestExpression;
}

function response(payload) {
  return { ok: payload.ok !== false, payload };
}

module.exports = {
  createLyricToggleButton,
  loadModuleExports,
  loadModuleScope,
  response,
};
