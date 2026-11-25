'use strict';

const fs = require('node:fs/promises');
const { sendJson } = require('./http-utils');

function matchesPublicAsset(req, tag) {
  const tags = String(req.headers?.['if-none-match'] || '').split(',').map(value => value.trim().replace(/^W\//, ''));
  return tags.includes('*') || tags.includes(tag.replace(/^W\//, ''));
}

function publicAssetHeaders(req, res, tag, immutable) {
  res.setHeader('ETag', tag);
  res.setHeader('Cache-Control', immutable ? 'private, max-age=31536000, immutable' : 'private, no-cache');
  if (!matchesPublicAsset(req, tag)) return false;
  res.writeHead(304);
  res.end();
  return true;
}

function fileRevision(stat) {
  return `${stat.ino}-${stat.size}-${stat.mtimeNs}-${stat.ctimeNs}`;
}

async function packedAssetTag(filename) {
  const member = process.versions.electron && !process.noAsar && /^(.*?\.asar)([\\/].+)$/i.exec(filename);
  if (!member) return '';
  // Electron opens packed files through per-process temporary copies. Use the
  // containing archive's real revision, except for independently mutable unpacked files.
  const nativeFs = require('original-fs').promises;
  const archive = await nativeFs.stat(member[1], { bigint: true });
  if (!archive.isFile()) return '';
  if (await nativeFs.stat(`${member[1]}.unpacked${member[2]}`, { throwIfNoEntry: false })) return '';
  return `W/"${fileRevision(archive)}-${encodeURIComponent(member[2])}"`;
}

async function servePublicFile(filename, req, res, type, hash = '') {
  let file;
  try {
    const packedTag = !hash && await packedAssetTag(filename);
    if (!packedTag) file = await fs.open(filename);
    const stat = file ? await file.stat({ bigint: true }) : await fs.stat(filename);
    if (!stat.isFile()) throw new Error('Expected a regular file');
    if (res.destroyed) return;
    const tag = hash ? `"${hash}"` : packedTag || `W/"${fileRevision(stat)}"`;
    if (publicAssetHeaders(req, res, tag, Boolean(hash))) return;
    if (!file && req.method !== 'HEAD' && stat.size) {
      file = await fs.open(filename);
      if (res.destroyed) return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': String(stat.size) });
    if (req.method === 'HEAD' || !stat.size) { res.end(); return; }
    const source = file.createReadStream();
    file = null; // The stream now owns the open descriptor.
    res.once('close', () => source.destroy());
    source.once('error', () => res.destroy());
    source.pipe(res);
  } catch {
    if (!res.destroyed && !res.headersSent) sendJson(res, 404, { ok: false, error: 'Not found.' });
    else if (!res.destroyed) res.destroy();
  } finally {
    await file?.close();
  }
}

module.exports = { matchesPublicAsset, publicAssetHeaders, servePublicFile };
