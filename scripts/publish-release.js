'use strict';

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PKG = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'),
);
const VERSION = PKG.version;
const TAG = `v${VERSION}`;
const OWNER = PKG.build.publish[0].owner;
const REPO = PKG.build.publish[0].repo;
const EXE_NAME = PKG.build.nsis.artifactName
  .replace('${version}', VERSION)
  .replace('${ext}', 'exe');
const EXPECTED_ASSETS = [EXE_NAME, `${EXE_NAME}.blockmap`, 'latest.yml'];
const OUTPUT_DIR = path.resolve(ROOT_DIR, PKG.build.directories.output);
const MAX_PUBLISH_ATTEMPTS = 3;
// 常见本地代理端口（Clash 默认 7890、v2rayN 默认 10809/1080），上传慢时自动探测提速
const LOCAL_PROXY_PORTS = [7890, 10809, 1080];

let proxyUrl = '';

if (require.main === module) {
  main().catch((error) => {
    console.error(`[publish-release] ${error.message || error}`);
    process.exit(1);
  });
}

async function main() {
  log(`Preparing release ${TAG} for ${OWNER}/${REPO}`);

  const head = ensureCleanEnoughGitState();
  proxyUrl = await resolveProxy();
  ensureTag(head);
  ensureGhToken();
  ensureGithubRelease();

  run('npm', ['run', '--silent', 'make:icon']);
  if (ensureCleanEnoughGitState() !== head) {
    throw new Error('Release source changed while preparing build resources.');
  }

  for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt += 1) {
    log(`electron-builder publish attempt ${attempt}/${MAX_PUBLISH_ATTEMPTS}`);
    try {
      // 使用本地 electron 构建，跳过下载
      run('npx', [
        'electron-builder',
        '--win',
        'nsis',
        '--x64',
        '--publish',
        'always',
        '--config.electronDist=node_modules/electron/dist',
      ]);
    } catch (error) {
      log(`electron-builder exited with an error: ${error.message}`);
      continue;
    }

    const missing = await findMissingAssets();
    if (missing.length === 0) {
      log(`All expected assets uploaded: ${EXPECTED_ASSETS.join(', ')}`);
      return;
    }

    log(
      `Missing or incomplete assets after attempt ${attempt}: ${missing.join(', ')}`,
    );
  }

  throw new Error(
    `Release ${TAG} is incomplete after ${MAX_PUBLISH_ATTEMPTS} attempts. ` +
      `Check "gh release view ${TAG}" and re-run this script.`,
  );
}

async function resolveProxy() {
  const fromEnv =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (fromEnv && fromEnv.trim()) {
    log(`Using proxy from environment: ${fromEnv.trim()}`);
    return fromEnv.trim();
  }
  if (process.env.RELEASE_NO_PROXY === '1') {
    log('Proxy disabled by RELEASE_NO_PROXY=1, uploading directly');
    return '';
  }
  for (const port of LOCAL_PROXY_PORTS) {
    if (await probeProxyPort(port)) {
      const detected = `http://127.0.0.1:${port}`;
      log(
        `Auto-detected local proxy ${detected}, routing GitHub uploads through it`,
      );
      return detected;
    }
  }
  log(
    'No local proxy detected, uploading directly (may be slow). Set HTTPS_PROXY to use one.',
  );
  return '';
}

function probeProxyPort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 500 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function ensureCleanEnoughGitState() {
  const status = runCapture('git', ['status', '--porcelain=v1', '--untracked-files=normal']).trim();
  if (status) throw new Error('Release requires a clean worktree. Commit or move pending changes before publishing.');
  const branch = runCapture('git', [
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]).trim();
  const head = runCapture('git', ['rev-parse', 'HEAD']).trim();
  log(`Current branch ${branch} at ${head.slice(0, 12)}`);
  return head;
}

function ensureTag(head) {
  const localTag = tryCapture('git', ['rev-parse', '--verify', `${TAG}^{commit}`]).trim();
  if (localTag && localTag !== head) throw new Error(`Local tag ${TAG} does not identify HEAD.`);
  const remoteTags = runCapture('git', ['ls-remote', '--tags', 'origin', TAG, `${TAG}^{}`]);
  const refs = new Map(remoteTags.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [commit, ref] = line.split(/\s+/);
    return [ref, commit];
  }));
  const remoteTag = refs.get(`refs/tags/${TAG}^{}`) || refs.get(`refs/tags/${TAG}`);
  if (remoteTag && remoteTag !== head) throw new Error(`Remote tag ${TAG} does not identify HEAD.`);
  if (!localTag) {
    log(`Creating annotated tag ${TAG}`);
    run('git', ['tag', '-a', TAG, '-m', TAG]);
  }

  if (!remoteTag) {
    log(`Pushing tag ${TAG} to origin`);
    run('git', ['push', 'origin', TAG]);
  }
}

function ensureGhToken() {
  if (process.env.GH_TOKEN) return;
  const token = tryCapture('gh', ['auth', 'token']);
  if (!token || !token.trim()) {
    throw new Error(
      'GH_TOKEN is not set and "gh auth token" returned nothing. Run "gh auth login" first.',
    );
  }
  process.env.GH_TOKEN = token.trim();
  log('GH_TOKEN populated from "gh auth token"');
}

function ensureGithubRelease() {
  const exists = tryCapture('gh', [
    'release',
    'view',
    TAG,
    '--repo',
    `${OWNER}/${REPO}`,
  ]);
  if (exists) {
    log(
      `GitHub release ${TAG} already exists, will only fill in missing assets`,
    );
    return;
  }

  log(
    `Creating GitHub release ${TAG} up front to avoid electron-builder's create-race`,
  );
  // Keep multiline release notes out of command-line arguments.
  const notesPath = path.join(os.tmpdir(), `release-notes-${TAG}.md`);
  fs.writeFileSync(notesPath, extractReleaseNotes(VERSION), 'utf8');
  try {
    run('gh', [
      'release',
      'create',
      TAG,
      '--repo',
      `${OWNER}/${REPO}`,
      '--title',
      VERSION,
      '--notes-file',
      notesPath,
    ]);
  } finally {
    fs.rmSync(notesPath, { force: true });
  }
}

function extractReleaseNotes(version) {
  const changelogPath = path.join(ROOT_DIR, 'UPDATE.md');
  if (!fs.existsSync(changelogPath)) return `Release ${version}`;

  const content = fs.readFileSync(changelogPath, 'utf8');
  const sectionStart = content.indexOf(`## v${version} `);
  if (sectionStart === -1) return `Release ${version}`;

  const newlineIndex = content.indexOf('\n', sectionStart);
  if (newlineIndex === -1) return `Release ${version}`;
  const afterHeading = newlineIndex + 1;
  const nextSection = content.indexOf('\n## v', afterHeading);
  const sectionEnd = nextSection === -1 ? content.length : nextSection;
  return content.slice(afterHeading, sectionEnd).trim() || `Release ${version}`;
}

async function findMissingAssets() {
  // Deliberately avoid "gh api --jq ..." here: on Windows the jq expression
  // gets mangled by cmd.exe's quoting, which made this always look empty
  // and falsely report every asset as missing. Parse the plain JSON instead.
  const raw = tryCapture('gh', [
    'api',
    `repos/${OWNER}/${REPO}/releases/tags/${TAG}`,
  ]);
  if (!raw) return EXPECTED_ASSETS;

  let release;
  try {
    release = JSON.parse(raw);
  } catch {
    return EXPECTED_ASSETS;
  }

  const uploaded = new Map(
    (release.assets || [])
      .filter((asset) => asset.state === 'uploaded')
      .map((asset) => [asset.name, asset]),
  );
  const missing = [];
  for (const name of EXPECTED_ASSETS) {
    const asset = uploaded.get(name);
    const localPath = path.join(OUTPUT_DIR, name);
    if (!asset || !fs.existsSync(localPath) || asset.size !== fs.statSync(localPath).size) {
      missing.push(name);
      continue;
    }
    const localDigest = await fileDigest(localPath);
    try {
      const remoteDigest = await publishedAssetDigest(asset);
      if (remoteDigest !== localDigest) missing.push(name);
    } catch (error) {
      log(`Cannot verify ${name}: ${error.message}`);
      missing.push(name);
    }
  }
  return missing;
}

async function fileDigest(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function publishedAssetDigest(asset) {
  const digest = String(asset.digest || '');
  if (/^sha256:[a-f0-9]{64}$/i.test(digest)) return digest.slice(7).toLowerCase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-release-verify-'));
  const filePath = path.join(directory, asset.name);
  try {
    run('gh', ['release', 'download', TAG, '--repo', `${OWNER}/${REPO}`, '--pattern', asset.name, '--output', filePath]);
    return await fileDigest(filePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function needsCommandShell(command) {
  return process.platform === 'win32' && (command === 'npm' || command === 'npx');
}

function proxyEnv(baseEnv) {
  if (!proxyUrl) return baseEnv;
  return {
    ...baseEnv,
    HTTPS_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    HTTP_PROXY: proxyUrl,
    http_proxy: proxyUrl,
  };
}

function run(command, args) {
  log(`$ ${command} ${args.join(' ')}`);
  const env = proxyEnv({ ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' });
  execFileSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: needsCommandShell(command),
    env,
  });
}

function runCapture(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT_DIR,
    shell: needsCommandShell(command),
    env: proxyEnv(process.env),
  }).toString();
}

function tryCapture(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: ROOT_DIR,
      shell: needsCommandShell(command),
      stdio: ['ignore', 'pipe', 'ignore'],
      env: proxyEnv(process.env),
    }).toString();
  } catch {
    return '';
  }
}

function log(message) {
  console.log(`[publish-release] ${message}`);
}

module.exports = { main };
