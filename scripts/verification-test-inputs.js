'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const cache = require('./verification-cache');

// These complete test sources were reviewed together with installer-tools.js.
// New imports/VM/filesystem consumers require review; until then use all inputs.
const reviewedInstallers = new Map([
  ['app-exit', '9dede36261e8b811cfe3a959da31e999fe2cd21f23f297a99ccb17d8600ffb7d'],
  ['diagnostics', '479576d57e253f8274ceab6a0ebc14cd9dea4e84bd0195ddd280e41e5a153ffd'],
  ['directory', '37fd4338fd7cba431788f56aca438f4a670b2caaf2b8c803e64164cff9e76456'],
  ['migration', '427e4a8bd8e62f49f74a404e870d913c16fe487d7e998e46f9dda57834a861db'],
  ['uninstall', '8b202d5952acc36c88b5fa420690a2e7719b8df8327d5205767a725b91024fc6'],
].map(([name, hash]) => [`test/engineering/installer-${name}.test.js`, hash]));
const reviewedInstallerHelper = '19701c22817dd20e606aab84fa147dfc3e28d028dc5cbb36b53d5cbe180949de';
const tools = new Set([
  'package.json', 'package-lock.json', 'scripts/run-tests.js', 'scripts/verify-tests.js',
  'scripts/verification-cache.js', 'scripts/verification-test-inputs.js',
  'scripts/verification-test-reporter.js', 'scripts/verification-test-results.js',
]);

function reviewedSource(root, file, expected) {
  return expected && fs.existsSync(path.join(root, file))
    && cache.digest(fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n')) === expected;
}

function testInputs(root, file, inputs) {
  if (!reviewedSource(root, file, reviewedInstallers.get(file))
      || !reviewedSource(root, 'test/helpers/installer-tools.js', reviewedInstallerHelper)) return inputs;
  return inputs.filter(([name]) => tools.has(name) || name.endsWith('/package.json') || name === file
    || name === 'test/helpers/installer-tools.js'
    || name === 'scripts/collect-install-diagnostics.ps1'
    || name.startsWith('build/'));
}

function browserInstallationRoot(executable) {
  let directory = path.dirname(executable);
  while (directory !== path.dirname(directory)) {
    if (/^chromium-\d+$/.test(path.basename(directory))) return path.dirname(directory);
    directory = path.dirname(directory);
  }
  throw new Error(`Cannot identify the complete Playwright installation for ${executable}`);
}

function browserFiles(executable) {
  const directory = browserInstallationRoot(executable);
  if (!fs.existsSync(directory)) return 'missing';
  // Windows Chromium writes diagnostics beside the executable during tests.
  const generatedLogs = new Set([
    path.join('chrome-win64', 'debug.log'),
    path.join('chrome-headless-shell-win64', 'debug.log'),
  ]);
  // An override can point at a shared tools directory. Only scan Playwright's
  // versioned installations, never its unrelated siblings or an entire drive.
  return cache.digest(fs.readdirSync(directory).filter((name) =>
    /^(?:chromium(?:[_-]headless[_-]shell)?|firefox|webkit|ffmpeg|winldd)-\d+$/.test(name),
  ).sort().map((name) => [name, cache.hashTree(path.join(directory, name), new Set(), generatedLogs)]));
}

function compilerFiles(compiler) {
  if (!compiler) return 'missing';
  const parent = path.dirname(compiler);
  const directory = path.basename(parent).toLowerCase() === 'bin' ? path.dirname(parent) : parent;
  if (directory === path.dirname(directory)) throw new Error('NSIS compiler must be inside a dedicated tool directory.');
  if (process.env.NSISDIR && path.resolve(process.env.NSISDIR) !== path.resolve(directory)) {
    throw new Error('Cached verification requires NSISDIR to match the selected compiler installation.');
  }
  const adjacent = fs.existsSync(parent) ? fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => [entry.name, cache.hashFile(path.join(parent, entry.name))]) : [];
  return cache.digest([compiler, adjacent.sort(), ...['Bin', 'Include', 'Plugins', 'Stubs', 'Contrib']
    .map((name) => [name, cache.hashTree(path.join(directory, name))])]);
}

function runtimeInputs(root, files, groups, conservative = true) {
  const requireRoot = createRequire(path.join(root, 'package.json'));
  const result = {};
  if (files.some((file) => groups.installer.includes(file))) {
    const { compiler, plugins } = requireRoot('./test/helpers/installer-tools').resolveInstallerTools();
    const powershell = process.platform === 'win32'
      ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : null;
    result.installer = {
      compiler: compiler || null, compilerFiles: compilerFiles(compiler),
      plugins: plugins || null, pluginFiles: cache.hashTree(plugins),
      powershell: powershell && cache.hashFile(powershell),
    };
  }
  if (conservative) {
    let installed;
    try {
      installed = requireRoot.resolve('playwright');
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
    if (installed) {
      const executable = requireRoot('playwright').chromium.executablePath();
      // Headless Chromium uses a sibling headless-shell installation. Include
      // the complete cache, also for desktop/offline tests that launch browsers.
      result.browser = { executable, files: browserFiles(executable) };
    } else result.browser = { files: 'missing' };
  }
  if (files.some((file) => groups.contracts.includes(file))) {
    // Never replace the live checkout/fixture check with the lockfile's promise.
    const contract = requireRoot('./scripts/verify-server-contract').verifyServerContract();
    result.contracts = {
      root: contract.serverRoot, revision: contract.revision,
      fixtures: [...contract.fixtures].map(([name, bytes]) => [name, cache.digest(bytes.toString('base64'))]),
    };
  }
  return result;
}

function createPlan(root, files, groups, { force = false } = {}) {
  const inputs = cache.repositoryInputs(root);
  const environment = cache.testEnvironment(root);
  const selectedInputs = new Map(files.map((file) => [file, testInputs(root, file, inputs)]));
  const runtimes = runtimeInputs(root, files, groups, [...selectedInputs.values()].some((owned) => owned === inputs));
  return files.map((file) => {
    const owned = selectedInputs.get(file);
    const runtime = Object.entries(runtimes).filter(([group]) => group === 'browser' ? owned === inputs : groups[group].includes(file));
    const key = cache.digest([file, owned, environment, runtime]);
    return { file, key, reuse: !force && cache.hasProof(root, 'tests', file, key),
      inputs: owned.length, scope: owned === inputs ? 'conservative' : 'installer' };
  });
}

module.exports = { reviewedInstallers, testInputs, browserInstallationRoot, runtimeInputs, createPlan };
