'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const TAG = `v${VERSION}`;
const OWNER = PKG.build.publish[0].owner;
const REPO = PKG.build.publish[0].repo;
const EXE_NAME = PKG.build.nsis.artifactName
  .replace('${version}', VERSION)
  .replace('${ext}', 'exe');
const EXPECTED_ASSETS = [EXE_NAME, `${EXE_NAME}.blockmap`, 'latest.yml'];
const MAX_PUBLISH_ATTEMPTS = 3;

main();

function main() {
  log(`Preparing release ${TAG} for ${OWNER}/${REPO}`);

  ensureCleanEnoughGitState();
  ensureTag();
  ensureGhToken();
  ensureGithubRelease();

  run('npm', ['run', '--silent', 'make:icon']);

  for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt += 1) {
    log(`electron-builder publish attempt ${attempt}/${MAX_PUBLISH_ATTEMPTS}`);
    try {
      run('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'always']);
    } catch (error) {
      log(`electron-builder exited with an error: ${error.message}`);
    }

    const missing = findMissingAssets();
    if (missing.length === 0) {
      log(`All expected assets uploaded: ${EXPECTED_ASSETS.join(', ')}`);
      return;
    }

    log(`Missing or incomplete assets after attempt ${attempt}: ${missing.join(', ')}`);
  }

  throw new Error(
    `Release ${TAG} is incomplete after ${MAX_PUBLISH_ATTEMPTS} attempts. ` +
    `Check "gh release view ${TAG}" and re-run this script.`
  );
}

function ensureCleanEnoughGitState() {
  const branch = runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const head = runCapture('git', ['rev-parse', 'HEAD']).trim();
  log(`Current branch ${branch} at ${head.slice(0, 12)}`);
}

function ensureTag() {
  const localTag = tryCapture('git', ['rev-parse', TAG]);
  if (!localTag) {
    log(`Creating annotated tag ${TAG}`);
    run('git', ['tag', '-a', TAG, '-m', TAG]);
  }

  const remoteTag = runCapture('git', ['ls-remote', '--tags', 'origin', TAG]);
  if (!remoteTag.trim()) {
    log(`Pushing tag ${TAG} to origin`);
    run('git', ['push', 'origin', TAG]);
  }
}

function ensureGhToken() {
  if (process.env.GH_TOKEN) return;
  const token = tryCapture('gh', ['auth', 'token']);
  if (!token || !token.trim()) {
    throw new Error('GH_TOKEN is not set and "gh auth token" returned nothing. Run "gh auth login" first.');
  }
  process.env.GH_TOKEN = token.trim();
  log('GH_TOKEN populated from "gh auth token"');
}

function ensureGithubRelease() {
  const exists = tryCapture('gh', ['release', 'view', TAG, '--repo', `${OWNER}/${REPO}`]);
  if (exists) {
    log(`GitHub release ${TAG} already exists, will only fill in missing assets`);
    return;
  }

  log(`Creating GitHub release ${TAG} up front to avoid electron-builder's create-race`);
  run('gh', [
    'release', 'create', TAG,
    '--repo', `${OWNER}/${REPO}`,
    '--title', VERSION,
    '--notes', extractReleaseNotes(VERSION),
  ]);
}

function extractReleaseNotes(version) {
  const changelogPath = path.join(ROOT_DIR, 'UPDATE.md');
  if (!fs.existsSync(changelogPath)) return `Release ${version}`;

  const content = fs.readFileSync(changelogPath, 'utf8');
  const sectionStart = content.indexOf(`## v${version} `);
  if (sectionStart === -1) return `Release ${version}`;

  const afterHeading = content.indexOf('\n', sectionStart) + 1;
  const nextSection = content.indexOf('\n## v', afterHeading);
  const sectionEnd = nextSection === -1 ? content.length : nextSection;
  return content.slice(afterHeading, sectionEnd).trim() || `Release ${version}`;
}

function findMissingAssets() {
  // Deliberately avoid "gh api --jq ..." here: on Windows the jq expression
  // gets mangled by cmd.exe's quoting, which made this always look empty
  // and falsely report every asset as missing. Parse the plain JSON instead.
  const raw = tryCapture('gh', ['api', `repos/${OWNER}/${REPO}/releases/tags/${TAG}`]);
  if (!raw) return EXPECTED_ASSETS;

  let release;
  try {
    release = JSON.parse(raw);
  } catch {
    return EXPECTED_ASSETS;
  }

  const uploaded = new Set(
    (release.assets || [])
      .filter((asset) => asset.state === 'uploaded')
      .map((asset) => asset.name)
  );
  return EXPECTED_ASSETS.filter((name) => !uploaded.has(name));
}

function run(command, args) {
  log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd: ROOT_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
}

function runCapture(command, args) {
  return execFileSync(command, args, { cwd: ROOT_DIR, shell: process.platform === 'win32' }).toString();
}

function tryCapture(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: ROOT_DIR,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch {
    return '';
  }
}

function log(message) {
  console.log(`[publish-release] ${message}`);
}
