'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
const { verifyPackagedDependencies } = require('./verify-packaged-dependencies');
const {
  MANIFEST_NAME,
  MAX_FILES,
  validatePath,
  readManifest,
  inspectFile,
  failure,
} = require('../src/electron/resource-integrity-files');
const execFileAsync = promisify(execFile);

function validateArchiveEntries(names, listing) {
  if (names.length !== listing.length) throw failure('INSTALLER_LAYOUT_INVALID');
  const selected = new Map();
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index].replace(/[/]$/, '');
    const key = name.toLowerCase();
    if (key !== 'resources' && !key.startsWith('resources/')) continue;
    const relative = name.slice('resources/'.length);
    const relativeKey = relative.toLowerCase();
    if (
      key !== 'resources' &&
      relativeKey !== MANIFEST_NAME &&
      relativeKey !== 'app.asar' &&
      relativeKey !== 'app.asar.unpacked' &&
      !relativeKey.startsWith('app.asar.unpacked/')
    )
      continue;
    if (name !== 'resources' && !name.startsWith('resources/')) throw failure('PATH_INVALID');
    const type = listing[index][0];
    if (name === 'resources' || relative === 'app.asar.unpacked') {
      if (type !== 'd') throw failure('PATH_UNSAFE');
    } else {
      if (relative !== MANIFEST_NAME) validatePath(relative);
      if (!['-', 'd'].includes(type) || ((relative === MANIFEST_NAME || relative === 'app.asar') && type !== '-'))
        throw failure('PATH_UNSAFE');
    }
    if (selected.has(key)) throw failure('PATH_INVALID');
    selected.set(key, { name, type });
    if (selected.size > MAX_FILES * 2 + 2) throw failure('MANIFEST_INVALID');
  }
  if (!selected.has(`resources/${MANIFEST_NAME}`) || !selected.has('resources/app.asar'))
    throw failure('MANIFEST_MISSING');
  return [...selected.values()];
}

async function copyEmbeddedArchive(filename, directory, options) {
  // libarchive only scans a bounded SFX prefix. Use the builder's existing
  // archiver to locate a later payload, then apply the same tar checks to it.
  const { stdout } = await execFileAsync(await getPath7za(), ['l', '-slt', '--', filename], options);
  const header = stdout.split(/\r?\n----------\r?\n/, 1)[0];
  const offset = Number(header.match(/^Offset = (\d+)\r?$/m)?.[1]);
  const size = Number(header.match(/^Physical Size = (\d+)\r?$/m)?.[1]);
  const end = offset + size;
  if (
    !/^Type = 7z\r?$/m.test(header) ||
    !Number.isSafeInteger(offset) || offset <= 0 ||
    !Number.isSafeInteger(size) || size < 32 ||
    !Number.isSafeInteger(end) || end > (await fs.promises.stat(filename)).size
  ) throw failure('INSTALLER_LAYOUT_INVALID');
  const archive = path.join(directory, 'payload.7z');
  await pipeline(
    fs.createReadStream(filename, { start: offset, end: end - 1 }),
    fs.createWriteStream(archive, { flags: 'wx' }),
  );
  return archive;
}

async function verifyInstaller(filename, metadata) {
  // No installer, application executable or archived JavaScript is executed.
  const tar =
    process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe') : 'bsdtar';
  const options = { windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000 };
  const lines = (text) => {
    const result = text
      .split(String.fromCharCode(10))
      .map((line) => (line.endsWith(String.fromCharCode(13)) ? line.slice(0, -1) : line));
    while (result.at(-1) === '') result.pop();
    return result;
  };
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lira-installer-integrity-'));
  try {
    let archive = filename;
    let names;
    try {
      names = lines((await execFileAsync(tar, ['-tf', archive], options)).stdout);
    } catch {
      archive = await copyEmbeddedArchive(filename, directory, options);
      names = lines((await execFileAsync(tar, ['-tf', archive], options)).stdout);
    }
    const listing = lines((await execFileAsync(tar, ['-tvf', archive], options)).stdout);
    const entries = validateArchiveEntries(names, listing);
    const selected = [`resources/${MANIFEST_NAME}`, 'resources/app.asar'];
    if (entries.some((entry) => entry.name.startsWith('resources/app.asar.unpacked/')))
      selected.push('resources/app.asar.unpacked');
    await execFileAsync(tar, ['-xf', archive, '-C', directory, '--', ...selected], options);
    const resourcesDir = path.join(directory, 'resources');
    const manifest = await readManifest(fs, resourcesDir, metadata);
    const actual = entries
      .filter((entry) => entry.type === '-' && entry.name !== `resources/${MANIFEST_NAME}`)
      .map((entry) => entry.name.slice('resources/'.length))
      .sort();
    const expected = manifest.files.map((file) => file.path).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw failure('INSTALLER_SCOPE_MISMATCH');
    for (const file of manifest.files) {
      const reasonCode = await inspectFile(fs, resourcesDir, file);
      if (reasonCode) throw failure(reasonCode);
    }
    verifyPackagedDependencies(path.join(resourcesDir, 'app.asar'));
    return { totalFiles: manifest.files.length };
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

async function verifyInstallerArtifact(event) {
  if (event.target?.name !== 'nsis' || !event.file.endsWith('.exe')) return;
  const { Arch } = require('builder-util');
  await verifyInstaller(event.file, {
    appVersion: event.packager.appInfo.version,
    platform: 'win32',
    arch: typeof event.arch === 'string' ? event.arch : Arch[event.arch],
  });
}

module.exports = verifyInstallerArtifact;
module.exports.verifyInstaller = verifyInstaller;
module.exports.validateArchiveEntries = validateArchiveEntries;
