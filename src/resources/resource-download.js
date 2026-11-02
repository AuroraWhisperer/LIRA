'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isIP } = require('node:net');
const { createResourcePackages, packagePath } = require('./resource-packages');

const DEFAULT_CDN_ORIGIN = 'https://assets.lirahub.cn';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 128 * 1024 * 1024;

function resolveCdnOrigin(value = process.env.LIRA_RESOURCE_CDN_BASE || DEFAULT_CDN_ORIGIN) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/'
    || url.search || url.hash || isIP(url.hostname) || !url.hostname.includes('.')
    || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new Error('RESOURCE_CDN_INVALID');
  return url.origin;
}

async function readManifest({ origin, fetch, signal, timeoutMs = 15000 }) {
  const attempt = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const response = await fetch(`${origin}/resources/manifest.json`, {
    signal: attempt, credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_MANIFEST_BYTES) {
    await response.body?.cancel();
    throw new Error('RESOURCE_MANIFEST_UNAVAILABLE');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    attempt.throwIfAborted();
    size += chunk.length;
    if (size > MAX_MANIFEST_BYTES) throw new Error('RESOURCE_MANIFEST_INVALID');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateManifest(manifest, allowedFiles) {
  if (![1, 2].includes(manifest?.version) || !Array.isArray(manifest.files) || manifest.files.length > 512)
    throw new Error('RESOURCE_MANIFEST_INVALID');
  const allowed = new Map(allowedFiles.map(file => [file.path, file]));
  const seen = new Set();
  const files = [];
  let total = 0;
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !/^(fonts|img)\/[a-zA-Z0-9_./-]+\.(woff2|ttf|otf|png|webp|jpg|jpeg|gif|avif)$/.test(file.path)
      || file.path.split('/').some(part => !part || part === '.' || part === '..') || seen.has(file.path)
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size)
      || file.size <= 0 || file.size > MAX_ASSET_BYTES) throw new Error('RESOURCE_MANIFEST_INVALID');
    seen.add(file.path);
    total += file.size;
    if (total > 512 * 1024 * 1024) throw new Error('RESOURCE_MANIFEST_INVALID');
    if (allowed.has(file.path)) files.push({ ...allowed.get(file.path), sha256: file.sha256, size: file.size });
  }
  if (files.length !== allowed.size) throw new Error('RESOURCE_MANIFEST_INVALID');
  if (manifest.version === 1) return { files, downloads: files.map(file => ({ ...file, id: file.path, files: [file] })) };
  if (!Array.isArray(manifest.packages) || manifest.packages.length > 512) throw new Error('RESOURCE_MANIFEST_INVALID');
  const definitions = new Map(createResourcePackages(files).map(resource => [resource.id, resource]));
  const metadata = new Map(manifest.files.map(file => [file.path, { path: file.path, size: file.size, sha256: file.sha256 }]));
  const packages = new Set();
  const downloads = [];
  total = 0;
  for (const resource of manifest.packages) {
    if (!resource || typeof resource.id !== 'string' || resource.id.length > 200 || packages.has(resource.id)
      || !/^[a-f0-9]{64}$/.test(resource.sha256) || !Number.isSafeInteger(resource.size)
      || resource.size <= 0 || resource.size > MAX_ASSET_BYTES || !Array.isArray(resource.files)
      || !resource.files.length || resource.files.length > 512 || new Set(resource.files).size !== resource.files.length
      || resource.files.some(name => !metadata.has(name))) throw new Error('RESOURCE_MANIFEST_INVALID');
    packages.add(resource.id);
    total += resource.size;
    if (total > 512 * 1024 * 1024) throw new Error('RESOURCE_MANIFEST_INVALID');
    const definition = definitions.get(resource.id);
    if (!definition) continue;
    const expected = new Set(definition.files.map(file => file.path));
    if (definition.files.some(file => !resource.files.includes(file.path))
      || resource.files.some(name => allowed.has(name) && !expected.has(name))) throw new Error('RESOURCE_MANIFEST_INVALID');
    if (!definition.archive && (resource.files.length !== 1 || resource.sha256 !== definition.files[0].sha256
      || resource.size !== definition.files[0].size)) throw new Error('RESOURCE_MANIFEST_INVALID');
    const download = { ...definition, sha256: resource.sha256, size: resource.size,
      members: resource.files.map(name => metadata.get(name)) };
    download.path = packagePath(download);
    download.sourcePath = download.path;
    downloads.push(download);
  }
  if (downloads.length !== definitions.size) throw new Error('RESOURCE_MANIFEST_INVALID');
  return { files, downloads };
}

function objectName(file) {
  return `${file.sha256}${path.posix.extname(file.path)}`;
}

async function downloadResource(file, { origin, directory, fetch, signal, onProgress, timeoutMs = 300000 }) {
  const attempt = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const source = (file.sourcePath || `objects/${objectName(file)}`).split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${origin}/resources/${source}`, {
    signal: attempt, credentials: 'omit', redirect: 'error',
  });
  if (!response.ok || Number(response.headers.get('content-length')) > file.size) {
    await response.body?.cancel();
    throw new Error('RESOURCE_DOWNLOAD_FAILED');
  }
  return writeResource(file, response.body, { directory, signal: attempt, onProgress });
}

async function writeResource(file, stream, { directory, signal, onProgress = () => {} }) {
  const temporary = path.join(directory, `${objectName(file)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of stream) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > file.size) throw new Error('RESOURCE_SIZE_INVALID');
      hash.update(chunk);
      await handle.writeFile(chunk);
      onProgress(size);
    }
    signal.throwIfAborted();
    if (size !== file.size || hash.digest('hex') !== file.sha256) throw new Error('RESOURCE_HASH_INVALID');
    await handle.close();
    handle = null;
    const filename = path.join(directory, objectName(file));
    await fs.rename(temporary, filename);
    return filename;
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}

module.exports = { resolveCdnOrigin, readManifest, validateManifest, objectName, downloadResource, writeResource };
