'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');

const VERIFIER_PATH = path.resolve(__dirname, '../scripts/verify-server-contract.js');
const FIRST_FIXTURE = 'docs/protocol/fixtures/synthetic.json';
const SECOND_FIXTURE = 'test/fixtures/synthetic.json';

function fixture(t) {
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const root = fs.realpathSync(fs.mkdtempSync(path.join(temporaryParent, 'lira server contract-')));
  t.after(() => {
    assert.equal(path.dirname(root), temporaryParent);
    assert.equal(fs.realpathSync(root), root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const serverRoot = path.join(root, 'lira-server');
  const clientRoot = path.join(root, 'client');
  const script = path.join(clientRoot, 'scripts/verify-server-contract.js');
  const lockPath = path.join(clientRoot, 'server-contract.lock.json');
  const write = (relativePath, value) => {
    const filename = path.join(serverRoot, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, value);
  };
  write(FIRST_FIXTURE, JSON.stringify({ synthetic: true, title: '歌曲😀' }) + '\n');
  write(SECOND_FIXTURE, JSON.stringify({ synthetic: true, value: 2 }) + '\n');
  write('src/index.js', "module.exports = 'synthetic';\n");
  write('package.json', '{"name":"synthetic-server"}\n');
  write('package-lock.json', '{"lockfileVersion":3}\n');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(VERIFIER_PATH, script);
  const emptyGitConfig = path.join(root, 'empty-git-config');
  fs.writeFileSync(emptyGitConfig, '');
  const gitEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyGitConfig,
  };
  const git = (...args) =>
    execFileSync('git', ['-C', serverRoot, ...args], {
      encoding: 'utf8',
      env: gitEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.hooksPath', path.join(root, 'no-hooks'));
  git('config', 'core.fsmonitor', 'false');
  git('config', 'commit.gpgsign', 'false');
  const commit = () => {
    git('add', '--', '.');
    git(
      '-c',
      'user.name=Contract Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--quiet',
      '-m',
      'Synthetic contract input',
    );
    return git('rev-parse', 'HEAD');
  };
  const lock = {
    schemaVersion: 1,
    repository: 'synthetic/server',
    revision: commit(),
    fixtures: Object.fromEntries(
      [FIRST_FIXTURE, SECOND_FIXTURE].map((relativePath) => [
        relativePath,
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(serverRoot, relativePath)))
          .digest('hex'),
      ]),
    ),
  };
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  return {
    root,
    clientRoot,
    serverRoot,
    script,
    lockPath,
    lock,
    write,
    git,
    commit,
    verifier: require(script),
    gitEnv,
  };
}

test('a clean pinned checkout validates original fixture bytes and parses JSON', (t) => {
  const f = fixture(t);
  const result = f.verifier.verifyServerContract({
    serverRoot: f.serverRoot,
    runtime: true,
  });
  assert.equal(result.revision, f.lock.revision);
  assert.equal(result.serverRoot, f.serverRoot);
  assert.equal(result.fixtures.size, 2);
  assert.deepEqual(f.verifier.readServerFixture(FIRST_FIXTURE, { serverRoot: f.serverRoot }), {
    synthetic: true,
    title: '歌曲😀',
  });
  assert.equal(f.git('status', '--porcelain'), '');
});

test('explicit roots override LIRA_SERVER_ROOT and the sibling default', (t) => {
  const f = fixture(t);
  const previous = process.env.LIRA_SERVER_ROOT;
  try {
    delete process.env.LIRA_SERVER_ROOT;
    assert.equal(f.verifier.resolveServerRoot(), f.serverRoot);
    const unrelated = path.join(f.root, 'explicit environment checkout');
    process.env.LIRA_SERVER_ROOT = unrelated;
    assert.equal(f.verifier.resolveServerRoot(), unrelated);
    assert.equal(f.verifier.resolveServerRoot(f.serverRoot), f.serverRoot);
    assert.equal(f.verifier.verifyServerContract({ serverRoot: f.serverRoot }).revision, f.lock.revision);
  } finally {
    if (previous === undefined) delete process.env.LIRA_SERVER_ROOT;
    else process.env.LIRA_SERVER_ROOT = previous;
  }
});

test('an unavailable checkout fails without creating or replacing it', (t) => {
  const f = fixture(t);
  const missing = path.join(f.root, 'missing server');
  assert.throws(() => f.verifier.verifyServerContract({ serverRoot: missing }), {
    code: 'SERVER_CONTRACT_CHECKOUT_REQUIRED',
  });
  assert.equal(fs.existsSync(missing), false);
});

test('a checkout subdirectory cannot inherit the parent revision as its own root', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      f.verifier.verifyServerContract({
        serverRoot: path.join(f.serverRoot, 'src'),
      }),
    { code: 'SERVER_CONTRACT_CHECKOUT_ROOT_REQUIRED' },
  );
});

test('a different commit fails even when all fixture contents still match', (t) => {
  const f = fixture(t);
  f.write('src/index.js', "module.exports = 'next synthetic revision';\n");
  const actualRevision = f.commit();
  assert.notEqual(actualRevision, f.lock.revision);
  assert.throws(() => f.verifier.verifyServerContract({ serverRoot: f.serverRoot }), {
    code: 'SERVER_CONTRACT_REVISION_MISMATCH',
  });
  assert.equal(f.git('rev-parse', 'HEAD'), actualRevision);
});

for (const staged of [false, true]) {
  test(`${staged ? 'staged' : 'unstaged'} fixture drift rejects every consumer without restoring files`, (t) => {
    const f = fixture(t);
    const changed = '{"synthetic":"changed"}\n';
    f.write(SECOND_FIXTURE, changed);
    if (staged) f.git('add', '--', SECOND_FIXTURE);
    assert.throws(
      () =>
        f.verifier.readServerFixture(FIRST_FIXTURE, {
          serverRoot: f.serverRoot,
        }),
      {
        code: 'SERVER_CONTRACT_FIXTURE_MISMATCH',
      },
    );
    assert.equal(fs.readFileSync(path.join(f.serverRoot, SECOND_FIXTURE), 'utf8'), changed);
    assert.equal(f.git('rev-parse', 'HEAD'), f.lock.revision);
  });
}

test('missing and undeclared fixture paths fail explicitly', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      f.verifier.readServerFixture('../outside.json', {
        serverRoot: f.serverRoot,
      }),
    {
      code: 'SERVER_CONTRACT_FIXTURE_UNDECLARED',
    },
  );
  fs.unlinkSync(path.join(f.serverRoot, SECOND_FIXTURE));
  assert.throws(() => f.verifier.verifyServerContract({ serverRoot: f.serverRoot }), {
    code: 'SERVER_CONTRACT_FIXTURE_MISSING',
  });
});

for (const [kind, relativePath] of [
  ['unstaged', 'src/index.js'],
  ['staged', 'package.json'],
  ['unstaged', 'package-lock.json'],
  ['untracked', 'src/untracked.js'],
]) {
  test(`runtime verification rejects ${kind} ${relativePath} while fixture-only checks remain valid`, (t) => {
    const f = fixture(t);
    f.write(relativePath, 'synthetic runtime drift\n');
    if (kind === 'staged') f.git('add', '--', relativePath);
    assert.doesNotThrow(() => f.verifier.verifyServerContract({ serverRoot: f.serverRoot }));
    assert.throws(
      () =>
        f.verifier.verifyServerContract({
          serverRoot: f.serverRoot,
          runtime: true,
        }),
      {
        code: 'SERVER_CONTRACT_RUNTIME_DIRTY',
      },
    );
    assert.equal(fs.readFileSync(path.join(f.serverRoot, relativePath), 'utf8'), 'synthetic runtime drift\n');
  });
}

test('CLI uses an explicit environment checkout and fails runtime drift before imports', (t) => {
  const f = fixture(t);
  const run = () =>
    spawnSync(process.execPath, [f.script, '--runtime'], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...f.gitEnv, LIRA_SERVER_ROOT: f.serverRoot },
    });
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, new RegExp(f.lock.revision));
  f.write('src/untracked.js', "throw new Error('must not import');\n");
  const invalid = run();
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /runtime inputs differ from pinned revision/);
});

test('the lock requires an immutable full commit instead of a branch name', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.lockPath, JSON.stringify({ ...f.lock, revision: 'main' }));
  assert.throws(() => f.verifier.verifyServerContract({ serverRoot: f.serverRoot }), {
    code: 'SERVER_CONTRACT_LOCK_INVALID',
  });
});

test('roundtrip validates the explicitly selected client checkout lock before server imports', (t) => {
  const f = fixture(t);
  const selectedRevision = '0'.repeat(40);
  fs.writeFileSync(f.lockPath, JSON.stringify({ ...f.lock, revision: selectedRevision }));
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../scripts/verify-song-roundtrip.cjs'), f.clientRoot, f.serverRoot],
    { encoding: 'utf8', env: f.gitEnv, windowsHide: true },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`expected ${selectedRevision}`));
  assert.doesNotMatch(result.stderr, /Cannot find module/);
});
