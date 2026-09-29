'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveInstallerTools } = require('../helpers/installer-tools');

function cacheFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-installer-tools-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const put = (file) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'synthetic tool');
    return target;
  };
  return { root, put };
}

test('installer tests find both flat and nested electron-builder cache layouts', (t) => {
  const { root, put } = cacheFixture(t);
  const compiler = put('nsis-3.0.4.1/Bin/makensis.exe');
  const plugin = put('nsis-resources-3.4.1/extracted/plugins/x86-unicode/StdUtils.dll');
  assert.equal(resolveInstallerTools({ ELECTRON_BUILDER_CACHE: root }).plugins, undefined);
  put('nsis-resources-3.4.1/extracted/plugins/x86-unicode/nsProcess.dll');
  assert.deepEqual(resolveInstallerTools({ ELECTRON_BUILDER_CACHE: root }), {
    compiler,
    plugins: path.dirname(plugin),
  });
  fs.unlinkSync(compiler);
  const nestedCompiler = put('nsis-3.0.4.1/extracted/Bin/makensis.exe');
  assert.equal(resolveInstallerTools({ ELECTRON_BUILDER_CACHE: root }).compiler, nestedCompiler);
});

test('installer tool overrides remain authoritative even when invalid', (t) => {
  const { root, put } = cacheFixture(t);
  put('nsis-3.0.4.1/Bin/makensis.exe');
  const compiler = path.join(root, 'missing-compiler.exe');
  const plugins = path.join(root, 'missing-plugins');
  assert.deepEqual(
    resolveInstallerTools({
      ELECTRON_BUILDER_CACHE: root,
      LIRA_TEST_MAKENSIS: compiler,
      LIRA_TEST_NSIS_PLUGINS: plugins,
    }),
    { compiler, plugins },
  );
});

test('installer discovery uses the Windows cache without changing the environment', (t) => {
  const { root, put } = cacheFixture(t);
  const compiler = put('electron-builder/Cache/nsis-3.0.4.1/Bin/makensis.exe');
  const env = Object.freeze({ LOCALAPPDATA: root });
  assert.deepEqual(resolveInstallerTools(env), { compiler, plugins: undefined });
  assert.deepEqual(resolveInstallerTools({}), { compiler: undefined, plugins: undefined });
});
