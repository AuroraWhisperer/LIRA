'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fixture(options = {}) {
  const commands = [];
  const commandOptions = [];
  const cleaned = [];
  const head = 'a'.repeat(40);
  const bytes = Buffer.from('current artifact');
  const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  const module = { exports: {} };
  const pkg = {
    version: '1.0.0',
    build: { publish: [{ owner: 'fixture', repo: 'fixture' }], directories: { output: 'release' }, nsis: { artifactName: 'setup-${version}.${ext}' } },
  };
  const fakeFs = {
    readFileSync() { return JSON.stringify(pkg); },
    existsSync() { return true; },
    statSync() { return { size: bytes.length }; },
    async *createReadStream() { yield bytes; },
    mkdtempSync() { return path.join(__dirname, `fixture-verify-${commands.length}`); },
    rmSync(directory) { cleaned.push(directory); },
  };
  function execFileSync(command, args, executionOptions) {
    commands.push([command, ...args]);
    commandOptions.push({ command, ...executionOptions });
    if (command === 'git') {
      if (args[0] === 'status') return Buffer.from(options.dirty ? ' M src/changed.js' : '');
      if (args[0] === 'ls-remote') return Buffer.from(`${options.remoteHead || head}\trefs/tags/v1.0.0^{}`);
      if (args.includes('--abbrev-ref')) return Buffer.from('main');
      if (args.some((arg) => arg === 'v1.0.0^{commit}' || arg === 'v1.0.0')) return Buffer.from(options.tagHead || head);
      return Buffer.from(head);
    }
    if (command === 'npx' && options.buildFails) throw new Error('fixture build failure');
    if (command === 'gh' && args[0] === 'api') {
      return Buffer.from(JSON.stringify({ assets: ['setup-1.0.0.exe', 'setup-1.0.0.exe.blockmap', 'latest.yml'].map((name) => ({
        name, state: 'uploaded', size: bytes.length,
        digest: options.missingDigests ? undefined : options.staleAssets ? `sha256:${'0'.repeat(64)}` : digest,
      })) }));
    }
    return Buffer.from('existing');
  }
  const filename = path.resolve(__dirname, '../scripts/publish-release.js');
  const requireFake = (name) => {
    if (name === 'node:fs') return fakeFs;
    if (name === 'node:child_process') return { execFileSync };
    return require(name);
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: requireFake, module, __dirname: path.dirname(filename), Buffer,
    process: { platform: 'win32', env: { RELEASE_NO_PROXY: '1', GH_TOKEN: 'fixture' }, exit() { throw new Error('unexpected process exit'); } },
    console: { log() {}, error() {} },
  }, { filename });
  return { publisher: module.exports, commands, commandOptions, cleaned };
}

test('importing the release script does not build, tag, or publish', async () => {
  const f = fixture();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(f.commands, []);
});

test('release preflight rejects dirty worktrees and mismatched tags before building', async () => {
  for (const options of [{ dirty: true }, { tagHead: 'b'.repeat(40) }, { remoteHead: 'c'.repeat(40) }]) {
    const f = fixture(options);
    await assert.rejects(f.publisher.main());
    assert.equal(f.commands.some(([command]) => command === 'npx' || command === 'npm'), false);
  }
});

test('a failed build cannot be accepted because old release assets exist', async () => {
  const f = fixture({ buildFails: true });
  await assert.rejects(f.publisher.main(), /incomplete/);
  assert.equal(f.commands.filter(([command]) => command === 'npx').length, 3);
  assert.equal(f.commands.some(([command, action]) => command === 'gh' && action === 'api'), false);
});

test('release assets must match this build content, not just its file names', async () => {
  const stale = fixture({ staleAssets: true });
  await assert.rejects(stale.publisher.main(), /incomplete/);
  const current = fixture();
  await current.publisher.main();
  assert.equal(current.commands.filter(([command]) => command === 'npx').length, 1);
});

test('release verification downloads assets without digests and cleans isolated output', async () => {
  const f = fixture({ missingDigests: true });
  await f.publisher.main();
  assert.equal(f.commands.filter(([command, action, operation]) => command === 'gh' && action === 'release' && operation === 'download').length, 3);
  assert.equal(f.cleaned.length, 3);
  assert.equal(f.commandOptions.filter(({ command }) => command === 'git' || command === 'gh').every(({ shell }) => shell === false), true);
  assert.equal(f.commandOptions.filter(({ command }) => command === 'npm' || command === 'npx').every(({ shell }) => shell === true), true);
});
