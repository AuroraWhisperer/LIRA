'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { inspect } = require('node:util');

function fixture(options = {}) {
  const commands = [];
  const commandOptions = [];
  const cleaned = [];
  const logs = [];
  const reads = [];
  const assetNames = ['setup-1.0.0.exe', 'setup-1.0.0.exe.blockmap', 'latest.yml'];
  const uploaded = new Set(options.existingAssets || []);
  const staleAssets = new Set(options.staleAssetNames || []);
  let uploadAttempts = 0;
  let built = false;
  let verified = false;
  const head = 'a'.repeat(40);
  const bytes = Buffer.from('current artifact');
  const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  const module = { exports: {} };
  const pkg = {
    version: '1.0.0',
    build: {
      publish: [{ owner: 'fixture', repo: 'fixture' }],
      directories: { output: 'release' },
      nsis: { artifactName: 'setup-${version}.${ext}' },
    },
  };
  const fakeFs = {
    readFileSync() {
      return JSON.stringify(pkg);
    },
    existsSync() {
      return true;
    },
    statSync() {
      return { size: bytes.length };
    },
    async *createReadStream(filename) {
      reads.push(filename);
      const changed = (verified && options.artifactsChanged) || (uploadAttempts > 0 && options.artifactsChangedDuringUpload);
      yield changed ? Buffer.from('changed artifact') : bytes;
    },
    mkdtempSync() {
      return path.join(__dirname, `../fixture-verify-${commands.length}`);
    },
    rmSync(directory) {
      cleaned.push(directory);
    },
  };
  function execFileSync(command, args, executionOptions) {
    commands.push([command, ...args]);
    commandOptions.push({ command, ...executionOptions });
    if (options.childOutput && executionOptions.stdio === 'inherit') logs.push(options.childOutput);
    if (options.childError && (options.failCommand || 'npx') === command) {
      if (!executionOptions.stdio) logs.push(options.childError.stderr.toString());
      throw options.childError;
    }
    if (command === 'git') {
      if (args[0] === 'status') return Buffer.from(options.dirty || (built && options.sourceChanged) ? ' M src/changed.js' : '');
      if (args[0] === 'ls-remote') {
        const remoteHead = built && options.tagChanged ? 'c'.repeat(40) : options.remoteHead || head;
        return Buffer.from(options.noTags && !options.tagChanged ? '' : `${remoteHead}\trefs/tags/v1.0.0^{}`);
      }
      if (args.includes('--abbrev-ref')) return Buffer.from('main');
      if (args.includes('v1.0.0^{commit}')) {
        if (options.noTags) throw new Error('unknown tag');
        return Buffer.from(options.tagHead || head);
      }
      if (args[0] === 'rev-parse' && args.includes('HEAD') && built && options.headChanged)
        return Buffer.from('d'.repeat(40));
      return Buffer.from(head);
    }
    if (command === 'npx') {
      if (options.buildFails) throw new Error('fixture build failure');
      built = true;
    }
    if (command === 'gh' && args[0] === 'auth' && options.tokenMissing) return Buffer.from('');
    if (command === 'gh' && args[1] === 'upload') {
      uploadAttempts += 1;
      const names = args.slice(3, args.indexOf('--repo')).map((filename) => path.basename(filename));
      if (options.uploadFails) throw new Error('fixture upload failure');
      for (const name of names) {
        if (uploadAttempts !== 1 || !options.firstUploadAssets || options.firstUploadAssets.includes(name)) {
          uploaded.add(name);
          staleAssets.delete(name);
        }
      }
      if ((uploadAttempts === 1 && options.firstUploadAssets) || options.uploadErrorAfterAll)
        throw new Error('fixture upload response lost');
    }
    if (command === 'gh' && args[0] === 'api') {
      if (options.apiFails) throw new Error('fixture API unavailable');
      return Buffer.from(
        JSON.stringify({
          assets: assetNames.filter((name) => uploaded.has(name)).map((name) => ({
            name,
            state: 'uploaded',
            size: bytes.length,
            digest: options.missingDigests ? undefined : options.staleAssets || staleAssets.has(name) ? `sha256:${'0'.repeat(64)}` : digest,
          })),
        }),
      );
    }
    return Buffer.from(options.childOutput || 'existing');
  }
  const filename = path.resolve(__dirname, '../../scripts/publish-release.js');
  const requireFake = (name) => {
    if (name === './verify-client-installer')
      return {
        async verifyInstaller() {
          commands.push(['verify-installer']);
          if (options.invalidInstaller) throw new Error('fixture invalid installer');
          verified = true;
        },
      };
    if (name === './release-output') return require('../../scripts/release-output');
    if (name === 'node:fs') return fakeFs;
    if (name === 'node:child_process')
      return {
        execFileSync,
        spawnSync(command, args, executionOptions) {
          try {
            return {
              status: 0,
              stdout: execFileSync(command, args, executionOptions),
              stderr: Buffer.from(options.childOutput ? `synthetic warning ${options.childOutput}` : ''),
            };
          } catch (error) {
            return {
              error,
              status: error.status ?? 1,
              stdout: error.stdout,
              stderr: error.stderr,
              output: error.output,
            };
          }
        },
      };
    return require(name);
  };
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      require: requireFake,
      module,
      __dirname: path.dirname(filename),
      Buffer,
      process: {
        platform: 'win32',
        env: {
          RELEASE_NO_PROXY: '1',
          GH_TOKEN: 'fixture',
          ...options.environment,
        },
        exit() {
          throw new Error('unexpected process exit');
        },
      },
      console: {
        log(...values) {
          logs.push(values.join(' '));
        },
        error(...values) {
          logs.push(values.join(' '));
        },
      },
    },
    { filename },
  );
  return { publisher: module.exports, commands, commandOptions, cleaned, logs, reads };
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
    assert.equal(
      f.commands.some(([command]) => command === 'npx' || command === 'npm'),
      false,
    );
  }
});

test('missing credentials, failed builds and invalid installers never create or push tags', async () => {
  for (const options of [
    { tokenMissing: true, environment: { GH_TOKEN: '' } },
    { buildFails: true },
    { invalidInstaller: true },
    { sourceChanged: true },
    { headChanged: true },
    { artifactsChanged: true },
  ]) {
    const f = fixture({ noTags: true, ...options });
    await assert.rejects(f.publisher.main());
    assert.equal(f.commands.some(([command, action]) => command === 'git' && ['tag', 'push'].includes(action)), false);
    assert.equal(f.commands.some((entry) => entry[2] === 'upload'), false);
    if (options.tokenMissing) assert.equal(f.commands.some(([command]) => command === 'npx'), false);
  }
});

test('tags are rechecked and published only after the final installer passes verification', async () => {
  const conflict = fixture({ tagChanged: true });
  await assert.rejects(conflict.publisher.main(), /Remote tag/);
  assert.equal(conflict.commands.some((entry) => entry[2] === 'upload'), false);

  const f = fixture({ noTags: true });
  await f.publisher.main();
  const verifiedAt = f.commands.findIndex(([command]) => command === 'verify-installer');
  const taggedAt = f.commands.findIndex(([command, action]) => command === 'git' && action === 'tag');
  const pushedAt = f.commands.findIndex(([command, action]) => command === 'git' && action === 'push');
  assert.ok(verifiedAt < taggedAt && taggedAt < pushedAt);
  assert.equal(f.commands.filter(([command, action]) => command === 'git' && action === 'ls-remote').length, 2);
});

test('publication delegates final verification to its own gate exactly once', async () => {
  const f = fixture();
  await f.publisher.main();
  const build = f.commands.find(([command]) => command === 'npx');
  assert.equal(build[build.indexOf('--config') + 1], 'scripts/release-builder-config.js');
  assert.equal(f.commands.filter(([command]) => command === 'verify-installer').length, 1);
});

test('a failed build cannot be accepted because old release assets exist', async () => {
  const f = fixture({ buildFails: true });
  await assert.rejects(f.publisher.main(), /fixture build failure/);
  assert.equal(f.commands.filter(([command]) => command === 'npx').length, 1);
  assert.equal(
    f.commands.some(([command, action]) => command === 'gh' && action === 'api'),
    false,
  );
});

test('validation occurs before any upload, and failed or changed artifacts are never uploaded', async () => {
  for (const options of [{ invalidInstaller: true }, { artifactsChanged: true }]) {
    const f = fixture(options);
    await assert.rejects(f.publisher.main());
    assert.equal(
      f.commands.some(
        ([command, action, operation]) => command === 'gh' && action === 'release' && operation === 'upload',
      ),
      false,
    );
  }
  const f = fixture();
  await f.publisher.main();
  const build = f.commands.find(([command]) => command === 'npx');
  assert.equal(build[build.indexOf('--publish') + 1], 'never');
  assert.ok(
    f.commands.findIndex(([command]) => command === 'verify-installer') <
      f.commands.findIndex((entry) => entry[2] === 'upload'),
  );
});

test('upload retries never rebuild the already verified artifact set', async () => {
  const f = fixture({ uploadFails: true });
  await assert.rejects(f.publisher.main(), /incomplete/);
  assert.equal(f.commands.filter(([command]) => command === 'npx').length, 1);
  assert.equal(f.commands.filter(([command]) => command === 'verify-installer').length, 1);
  assert.equal(f.commands.filter((entry) => entry[2] === 'upload').length, 3);
});

test('partial upload retries send only assets whose remote content is unconfirmed', async () => {
  const f = fixture({ firstUploadAssets: ['setup-1.0.0.exe', 'setup-1.0.0.exe.blockmap'] });
  await f.publisher.main();
  const uploads = f.commands.filter((entry) => entry[2] === 'upload');
  assert.equal(uploads.length, 2);
  assert.deepEqual(uploads[1].slice(4, uploads[1].indexOf('--repo')).map((filename) => path.basename(filename)), ['latest.yml']);
});

test('matching existing assets are reused and lost upload responses can recover', async () => {
  const complete = fixture({ existingAssets: ['setup-1.0.0.exe', 'setup-1.0.0.exe.blockmap', 'latest.yml'] });
  await complete.publisher.main();
  assert.equal(complete.commands.some((entry) => entry[2] === 'upload'), false);
  const partial = fixture({ existingAssets: ['setup-1.0.0.exe'] });
  await partial.publisher.main();
  const upload = partial.commands.find((entry) => entry[2] === 'upload');
  assert.deepEqual(upload.slice(4, upload.indexOf('--repo')).map((filename) => path.basename(filename)), ['setup-1.0.0.exe.blockmap', 'latest.yml']);
  const lostResponse = fixture({ uploadErrorAfterAll: true });
  await lostResponse.publisher.main();
  assert.equal(lostResponse.commands.filter((entry) => entry[2] === 'upload').length, 1);
});

test('remote lookup failure or changed local artifacts cannot be accepted as a successful upload', async () => {
  for (const options of [{ apiFails: true }, { artifactsChangedDuringUpload: true }]) {
    const f = fixture(options);
    await assert.rejects(f.publisher.main());
    assert.equal(f.logs.some((line) => line.includes('All expected assets uploaded')), false);
  }
});

test('an existing mismatched asset is replaced without reuploading matching siblings', async () => {
  const f = fixture({
    existingAssets: ['setup-1.0.0.exe', 'setup-1.0.0.exe.blockmap', 'latest.yml'],
    staleAssetNames: ['setup-1.0.0.exe'],
  });
  await f.publisher.main();
  const uploads = f.commands.filter((entry) => entry[2] === 'upload');
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].slice(4, uploads[0].indexOf('--repo')).map((filename) => path.basename(filename)), ['setup-1.0.0.exe']);
});

test('remote comparisons reuse the digest checked before and after upload', async () => {
  const f = fixture();
  await f.publisher.main();
  for (const name of ['setup-1.0.0.exe', 'setup-1.0.0.exe.blockmap', 'latest.yml']) {
    assert.equal(f.reads.filter((filename) => path.basename(filename) === name).length, 3);
  }
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
  assert.equal(
    f.commands.filter(
      ([command, action, operation]) => command === 'gh' && action === 'release' && operation === 'download',
    ).length,
    3,
  );
  assert.equal(f.cleaned.length, 3);
  assert.equal(
    f.commandOptions
      .filter(({ command }) => command === 'git' || command === 'gh')
      .every(({ shell }) => shell === false),
    true,
  );
  assert.equal(
    f.commandOptions
      .filter(({ command }) => command === 'npm' || command === 'npx')
      .every(({ shell }) => shell === true),
    true,
  );
});

test('release proxy logging strips userinfo including username-only and encoded credentials', async () => {
  for (const proxy of [
    'http://syntheticUser:syntheticPass@proxy.invalid:7890',
    'http://syntheticUser@proxy.invalid:7890',
    'http://syntheticUser:synthetic%40Pass@proxy.invalid:7890',
  ]) {
    const f = fixture({ environment: { HTTPS_PROXY: proxy } });
    await f.publisher.main();
    const rendered = f.logs.join('\n');
    for (const secret of ['syntheticUser', 'syntheticPass', 'synthetic%40Pass']) {
      assert.equal(rendered.includes(secret), false, 'proxy credential leaked');
    }
    assert.match(rendered, /proxy.invalid:7890/);
    assert.equal(f.commandOptions.find(({ command }) => command === 'npx').env.HTTPS_PROXY, proxy);
  }
});

for (const command of ['git', 'npm', 'npx']) {
  test(`release sanitizes ${command} failure output and the final thrown error`, async () => {
    const password = 'syntheticCertPassword';
    const proxy = 'http://syntheticUser:syntheticProxyPassword@proxy.invalid:7890';
    const detail = `synthetic tool failure /p ${password}; ${proxy}; user=syntheticUser password=syntheticProxyPassword`;
    const childError = Object.assign(new Error(detail), {
      code: 'SYNTHETIC_TOOL_FAILURE',
      status: 23,
      signal: null,
      stdout: Buffer.from(detail),
      stderr: Buffer.from(detail),
      output: [null, Buffer.from(detail), Buffer.from(detail)],
      spawnargs: [password],
    });
    const f = fixture({
      environment: { HTTPS_PROXY: proxy, WINDOWS_CERT_PASSWORD: password },
      childError,
      failCommand: command,
      childOutput: detail,
    });
    const error = await f.publisher.main().catch((failure) => failure);
    const rendered = [
      f.logs.join('\n'),
      error?.message,
      error?.stack,
      inspect(error, { depth: 8 }),
      JSON.stringify(error),
    ].join('\n');
    for (const secret of [password, 'syntheticUser', 'syntheticProxyPassword']) {
      assert.equal(rendered.includes(secret), false, 'synthetic secret leaked');
    }
    assert.equal(error.status, 23);
    assert.equal(error.code, 'SYNTHETIC_TOOL_FAILURE');
    assert.match(error.message, /synthetic tool failure/);
  });
}

test('release sanitizes successful child output and preserves credential-free proxy diagnostics', async () => {
  const proxy = 'http://proxy.invalid:7890';
  const f = fixture({
    environment: {
      HTTPS_PROXY: proxy,
      WINDOWS_CERT_PASSWORD: 'syntheticCertPassword',
    },
    childOutput: 'synthetic tool completed syntheticCertPassword',
  });
  await f.publisher.main();
  assert.equal(f.logs.join('\n').includes('syntheticCertPassword'), false);
  assert.match(f.logs.join('\n'), /synthetic tool completed/);
  assert.match(f.logs.join('\n'), /synthetic warning/);
  assert.match(f.logs.join('\n'), /Using proxy from environment: http:\/\/proxy.invalid:7890/);
});
