'use strict';

const crypto = require('node:crypto');
const yauzl = require('yauzl');

const DOWNLOAD_HOSTS = new Set([
  'cdn.jsdelivr.net', 'raw.githubusercontent.com', 'github.com',
  'release-assets.githubusercontent.com', 'objects.githubusercontent.com',
]);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function isFont(bytes, format) {
  return bytes.length >= 12 && (format === 'woff2'
    ? bytes.toString('ascii', 0, 4) === 'wOF2'
    : format === 'ttf' && bytes.readUInt32BE(0) === 0x00010000);
}

async function readLimited(stream, limit, signal) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    signal.throwIfAborted();
    size += chunk.length;
    if (size > limit) throw new Error('FONT_SIZE_INVALID');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function fetchSource(source, fetch, signal) {
  let url = new URL(source.url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !DOWNLOAD_HOSTS.has(url.hostname)) throw new Error('FONT_SOURCE_INVALID');
    const response = await fetch(url.href, { signal, redirect: 'manual', credentials: 'omit' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('FONT_SOURCE_INVALID');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('FONT_DOWNLOAD_FAILED');
    }
    if (Number(response.headers.get('content-length')) > source.downloadSize) {
      await response.body?.cancel();
      throw new Error('FONT_SIZE_INVALID');
    }
    const bytes = await readLimited(response.body, source.downloadSize, signal);
    if (bytes.length !== source.downloadSize) throw new Error('FONT_SIZE_INVALID');
    return bytes;
  }
  throw new Error('FONT_SOURCE_INVALID');
}

async function extractFont(bytes, source, font, signal) {
  if (sha256(bytes) !== source.archiveSha256) throw new Error('FONT_HASH_INVALID');
  const zip = await yauzl.fromBufferPromise(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  try {
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted();
      if (entry.fileName !== source.zipEntry) continue;
      if (entry.isEncrypted() || entry.uncompressedSize !== font.size) throw new Error('FONT_SIZE_INVALID');
      return await readLimited(await zip.openReadStreamPromise(entry), font.size, signal);
    }
    throw new Error('FONT_ARCHIVE_INVALID');
  } finally {
    zip.close();
  }
}

async function downloadFont(font, { fetch = globalThis.fetch, signal, timeoutMs = 300000 } = {}) {
  for (const source of font.sources) {
    signal.throwIfAborted();
    const attempt = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    try {
      let bytes = await fetchSource(source, fetch, attempt);
      if (source.zipEntry) bytes = await extractFont(bytes, source, font, attempt);
      if (bytes.length !== font.size || sha256(bytes) !== font.sha256 || !isFont(bytes, font.format))
        throw new Error('FONT_HASH_INVALID');
      return bytes;
    } catch (error) {
      signal.throwIfAborted();
      if (source === font.sources.at(-1)) throw error;
    }
  }
  throw new Error('FONT_SOURCE_INVALID');
}

module.exports = { downloadFont, sha256, isFont };
