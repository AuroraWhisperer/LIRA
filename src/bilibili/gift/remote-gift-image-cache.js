'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeImageBaseUrl } = require('./remote-catalog-cache');

const CACHE_DIR_NAME = 'overtime-gift-images';
const LOCAL_IMAGE_PREFIX = '/overtime-gift-images/';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 4;
const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);

function createRemoteGiftImageCache(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || '').trim());
  if (!dataDir || !String(options.dataDir || '').trim())
    throw new Error('dataDir is required.');
  const getImageBaseUrl = () => {
    const value =
      typeof options.imageBaseUrl === 'function'
        ? options.imageBaseUrl()
        : options.imageBaseUrl;
    const imageBaseUrl = normalizeCacheImageBaseUrl(value);
    if (!imageBaseUrl) throw new Error('imageBaseUrl is required.');
    return imageBaseUrl;
  };
  const cacheDir = path.join(dataDir, CACHE_DIR_NAME);
  const fetchImage = options.fetch || globalThis.fetch;
  if (typeof fetchImage !== 'function') throw new Error('fetch is required.');
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const concurrency = positiveInteger(
    options.concurrency,
    DEFAULT_CONCURRENCY,
  );
  const logger = options.logger || console;
  const pending = new Map();
  let active = 0;
  const waiting = [];
  fs.mkdirSync(cacheDir, { recursive: true });

  async function cacheGifts(gifts) {
    if (!Array.isArray(gifts)) return [];
    return Promise.all(
      gifts.map(async (gift) => {
        const imagePath = await cacheImagePath(gift?.imagePath);
        return { ...gift, imagePath };
      }),
    );
  }

  function getFilePath(imagePathOrBasename) {
    const basename = imageBasename(imagePathOrBasename, getImageBaseUrl());
    return basename ? path.join(cacheDir, basename) : '';
  }

  async function cacheImagePath(imagePath) {
    let parsed;
    try {
      parsed = parseAllowedImageUrl(imagePath, getImageBaseUrl());
    } catch (_) {
      return '';
    }
    if (!parsed) return '';
    const basename = path.posix.basename(parsed.pathname);
    const targetPath = path.join(cacheDir, basename);
    if (await isValidImageFile(targetPath, basename))
      return `${LOCAL_IMAGE_PREFIX}${basename}`;

    if (pending.has(basename)) return pending.get(basename);
    const task = runWithLimit(async () => {
      if (await isValidImageFile(targetPath, basename))
        return `${LOCAL_IMAGE_PREFIX}${basename}`;
      try {
        const bytes = await downloadImage(parsed.href, fetchImage, timeoutMs);
        if (!validateImageBytes(bytes, basename))
          throw new Error('downloaded image signature does not match extension');
        writeAtomic(targetPath, bytes);
        return `${LOCAL_IMAGE_PREFIX}${basename}`;
      } catch (error) {
        logger.debug?.(
          `[GiftImageCache] image unavailable (${basename}):`,
          error?.message || error,
        );
        return '';
      }
    }).finally(() => pending.delete(basename));
    pending.set(basename, task);
    return task;
  }

  async function runWithLimit(task) {
    if (active >= concurrency)
      await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  }

  return {
    cacheDir,
    cacheGifts,
    getFilePath,
  };
}

async function downloadImage(url, fetchImage, timeoutMs) {
  const response = await fetchImage(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' },
  });
  if (!response || response.ok !== true)
    throw new Error(`image request failed: HTTP ${response?.status || 0}`);
  if (response.redirected === true)
    throw new Error('image redirects are not allowed');
  const bytes = await readResponseBytes(response);
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new Error('image exceeds size limit');
  return bytes;
}

async function readResponseBytes(response) {
  if (response.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_IMAGE_BYTES) throw new Error('image exceeds size limit');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  }
  if (typeof response.arrayBuffer !== 'function')
    throw new Error('image response body is unavailable');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image exceeds size limit');
  return bytes;
}

function parseAllowedImageUrl(value, imageBaseUrl) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return null;
  }
  if (
    parsed.origin !== imageBaseUrl ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !/^\/gift-media\/images\/[A-Za-z0-9._-]+$/u.test(parsed.pathname)
  )
    return null;
  const basename = path.posix.basename(parsed.pathname);
  if (!isSafeBasename(basename)) return null;
  return parsed;
}

function imageBasename(value, imageBaseUrl) {
  if (isSafeBasename(value)) return value;
  const parsed = parseAllowedImageUrl(value, imageBaseUrl);
  return parsed ? path.posix.basename(parsed.pathname) : '';
}

function isSafeBasename(value) {
  const basename = String(value || '');
  const extension = path.posix.extname(basename).toLowerCase();
  return (
    /^[A-Za-z0-9._-]+$/u.test(basename) &&
    !basename.includes('..') &&
    basename !== '.' &&
    basename !== '..' &&
    IMAGE_EXTENSIONS.has(extension)
  );
}

function normalizeCacheImageBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.pathname !== '' && parsed.pathname !== '/') return '';
  } catch (_) {
    return '';
  }
  return normalizeImageBaseUrl(raw);
}

async function isValidImageFile(filePath, basename) {
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_IMAGE_BYTES)
      return false;
    const bytes = await fs.promises.readFile(filePath);
    return validateImageBytes(bytes, basename);
  } catch (_) {
    return false;
  }
}

function validateImageBytes(bytes, basename) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return false;
  const extension = path.posix.extname(String(basename || '')).toLowerCase();
  if (extension === '.png')
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg')
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === '.gif')
    return bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a');
  if (extension === '.webp')
    return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function writeAtomic(filePath, bytes) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
  );
  try {
    fs.writeFileSync(tempPath, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

module.exports = {
  CACHE_DIR_NAME,
  LOCAL_IMAGE_PREFIX,
  MAX_IMAGE_BYTES,
  createRemoteGiftImageCache,
  isSafeBasename,
  validateImageBytes,
};
