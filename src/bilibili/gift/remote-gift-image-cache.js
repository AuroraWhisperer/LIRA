'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { normalizeImageBaseUrl } = require('./remote-catalog-cache');
const { giftVariantId } = require('../../shared/gift-identity');
const { resolveDataPaths } = require('../../shared/data-paths');
const { pruneManagedFiles } = require('../../shared/file-retention');

const CACHE_DIR_NAME = 'overtime-gift-images';
const LOCAL_IMAGE_PREFIX = '/overtime-gift-images/';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 4;
const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
const BILIBILI_IMAGE_HOST = 'hdslb.com';
const BILIBILI_IMAGE_HEADERS = {
  Referer: 'https://live.bilibili.com/',
  'User-Agent': 'Mozilla/5.0 LIRA/4',
};

function createRemoteGiftImageCache(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || '').trim());
  if (!dataDir || !String(options.dataDir || '').trim()) throw new Error('dataDir is required.');
  const getImageBaseUrl = () => {
    const value = typeof options.imageBaseUrl === 'function' ? options.imageBaseUrl() : options.imageBaseUrl;
    const imageBaseUrl = normalizeCacheImageBaseUrl(value);
    if (!imageBaseUrl) throw new Error('imageBaseUrl is required.');
    return imageBaseUrl;
  };
  const cacheDir = resolveDataPaths(dataDir).giftImagesDir;
  const fetchImage = options.fetch || globalThis.fetch;
  if (typeof fetchImage !== 'function') throw new Error('fetch is required.');
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const concurrency = positiveInteger(options.concurrency, DEFAULT_CONCURRENCY);
  const logger = options.logger || console;
  const pending = new Map();
  const shutdown = new AbortController();
  let active = 0;
  const waiting = [];
  fs.mkdirSync(cacheDir, { recursive: true });
  const indexPath = path.join(cacheDir, 'index.json');
  const { images: lastGoodImages, valid: indexWasValid } = readImageIndex(indexPath);
  let canPrune = indexWasValid;
  if (!canPrune) {
    try { canPrune = !fs.readdirSync(cacheDir).some(isSafeBasename); }
    catch { canPrune = false; }
  }
  const usedImages = new Set();
  let lastPruned = -Infinity;
  pruneManagedFiles(dataDir, cacheDir, { matches: name => /^\.[A-Za-z0-9._-]+\.tmp-\d+-[a-f0-9]{12}$/.test(name),
    maxAgeMs: 86400000 });
  let indexDirty = false;
  let revision = 0;
  let indexWrite = Promise.resolve();

  function rememberImage(basename) {
    usedImages.add(basename);
    if (usedImages.size > 8192) usedImages.delete(usedImages.keys().next().value);
  }

  async function cacheGifts(gifts, cacheOptions = {}) {
    if (!Array.isArray(gifts)) return [];
    const total = gifts.length;
    let completed = 0;
    let available = 0;
    const result = await Promise.all(
      gifts.map(async (gift) => {
        const imagePath = await cacheGiftImage(gift, false);
        completed += 1;
        if (isGiftImageCurrent(gift)) available += 1;
        try {
          cacheOptions.onProgress?.({
            completed,
            total,
            available,
            failed: completed - available,
            giftId: String(gift?.id || ''),
            giftName: String(gift?.name || ''),
          });
        } catch (error) {
          logger.debug?.('[GiftImageCache] progress listener failed:', error?.message || error);
        }
        return { ...gift, imagePath };
      }),
    );
    await persistImageIndex();
    return result;
  }

  function getFilePath(imagePathOrBasename) {
    const basename = imageBasename(imagePathOrBasename, getImageBaseUrl());
    if (basename) rememberImage(basename);
    return basename ? path.join(cacheDir, basename) : '';
  }

  function getCachedImagePath(imagePath) {
    const candidate = serverImageCandidate(imagePath, safeImageBaseUrl());
    return getCachedCandidatePath(candidate);
  }

  function getCachedGiftImagePath(gift) {
    const imageBaseUrl = safeImageBaseUrl();
    for (const candidate of giftImageCandidates(gift, imageBaseUrl)) {
      const imagePath = getCachedCandidatePath(candidate);
      if (imagePath) return imagePath;
    }
    const previousBasename = lastGoodImages.get(gift?.variantId || giftVariantId(gift));
    return getCachedCandidatePath(previousBasename ? { basename: previousBasename } : bilibiliImageCandidate(gift));
  }

  function isGiftImageCurrent(gift) {
    const [candidate] = giftImageCandidates(gift, safeImageBaseUrl());
    return Boolean(getCachedCandidatePath(candidate));
  }

  function hasGiftImageSource(gift) {
    return giftImageCandidates(gift, safeImageBaseUrl()).length > 0;
  }

  function getCachedCandidatePath(candidate) {
    const filePath = candidate ? path.join(cacheDir, candidate.basename) : '';
    if (!filePath) return '';
    const basename = path.basename(filePath);
    rememberImage(basename);
    return isValidImageFileSync(filePath, basename) ? `${LOCAL_IMAGE_PREFIX}${basename}` : '';
  }

  async function cacheGiftImage(gift, persist = true) {
    const imageBaseUrl = safeImageBaseUrl();
    // A CDN outage must not turn every client into a full-library server download.
    const [candidate] = giftImageCandidates(gift, imageBaseUrl);
    const imagePath = await cacheCandidate(candidate);
    if (shutdown.signal.aborted) return imagePath || getCachedGiftImagePath(gift);
    const id = gift?.variantId || giftVariantId(gift);
    if (imagePath && id) {
      const basename = path.posix.basename(imagePath);
      if (lastGoodImages.get(id) !== basename) {
        lastGoodImages.set(id, basename);
        indexDirty = true;
        revision += 1;
      }
      if (persist) await persistImageIndex();
    }
    return imagePath || getCachedGiftImagePath(gift);
  }

  function getSourceImagePath(source, gift) {
    const candidate = sourceImageCandidate(source, gift, safeImageBaseUrl());
    if (candidate) rememberImage(candidate.basename);
    return candidate ? `${LOCAL_IMAGE_PREFIX}${candidate.basename}` : '';
  }

  async function cacheSourceImage(source, gift) {
    const candidate = sourceImageCandidate(source, gift, safeImageBaseUrl());
    return cacheCandidate(candidate);
  }

  function persistImageIndex() {
    const task = indexWrite.catch(() => {}).then(async () => {
      while (indexDirty) {
        const savedRevision = revision;
        await writeAtomic(indexPath, Buffer.from(JSON.stringify({
          schemaVersion: 2,
          images: Object.fromEntries(lastGoodImages),
        })));
        indexDirty = revision !== savedRevision;
      }
    });
    indexWrite = task;
    return task;
  }

  function safeImageBaseUrl() {
    try {
      return getImageBaseUrl();
    } catch (_) {
      return '';
    }
  }

  async function cacheCandidate(candidate) {
    if (!candidate || shutdown.signal.aborted) return '';
    const { url, basename, headers } = candidate;
    rememberImage(basename);
    const targetPath = path.join(cacheDir, basename);
    if (await isValidImageFile(targetPath, basename)) return `${LOCAL_IMAGE_PREFIX}${basename}`;

    if (pending.has(basename)) return pending.get(basename);
    const task = runWithLimit(async () => {
      if (shutdown.signal.aborted) return '';
      if (await isValidImageFile(targetPath, basename)) return `${LOCAL_IMAGE_PREFIX}${basename}`;
      try {
        const bytes = await downloadImage(url, fetchImage, timeoutMs, headers, shutdown.signal);
        shutdown.signal.throwIfAborted();
        if (!validateImageBytes(bytes, basename))
          throw new Error('downloaded image signature does not match extension');
        await writeAtomic(targetPath, bytes);
        revision += 1;
        return `${LOCAL_IMAGE_PREFIX}${basename}`;
      } catch (error) {
        logger.debug?.(`[GiftImageCache] image unavailable (${basename}):`, error?.message || error);
        return '';
      }
    }).finally(() => pending.delete(basename));
    pending.set(basename, task);
    return task;
  }

  async function runWithLimit(task) {
    if (active >= concurrency) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  }

  function prune(gifts) {
    const now = (options.now || Date.now)();
    if (shutdown.signal.aborted || !canPrune || !Array.isArray(gifts) || now - lastPruned < 3600000) return;
    lastPruned = now;
    const keep = new Set([...lastGoodImages.values(), ...usedImages, ...pending.keys()]);
    function visit(value) {
      if (typeof value === 'string') {
        for (const match of value.matchAll(/\/overtime-gift-images\/([A-Za-z0-9._-]+)/g)) keep.add(match[1]);
      } else if (value && typeof value === 'object') for (const item of Object.values(value)) visit(item);
    }
    try { options.visitAssetReferences?.(visit); } catch { return; }
    for (const gift of gifts) for (const candidate of giftImageCandidates(gift, safeImageBaseUrl())) keep.add(candidate.basename);
    const result = pruneManagedFiles(dataDir, cacheDir, {
      matches: name => /^(?:[1-9]\d{0,19}-[a-f0-9]{16}|source-[a-f0-9]{64})\.(?:gif|jpe?g|png|webp)$/.test(name),
      keep, maxAgeMs: 30 * 86400000, minAgeMs: 86400000, maxBytes: 512 * 1024 * 1024, refreshKept: true, now,
    });
    usedImages.clear();
    if (result.files) revision += 1;
  }

  return {
    cacheDir,
    prune,
    // Writes invalidate immediately; external removal/corruption is rechecked within one second.
    getRevision: () => `${revision}:${Math.floor((options.now || Date.now)() / 1000)}:${safeImageBaseUrl()}`,
    cacheGifts,
    cacheGiftImage,
    getSourceImagePath,
    cacheSourceImage,
    getCachedImagePath,
    getCachedGiftImagePath,
    isGiftImageCurrent,
    hasGiftImageSource,
    getFilePath,
    dispose() { shutdown.abort(); return Promise.allSettled([...pending.values(), persistImageIndex()]); },
  };
}

async function downloadImage(url, fetchImage, timeoutMs, extraHeaders, signal) {
  const response = await fetchImage(url, {
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]),
    headers: {
      Accept: 'image/png,image/jpeg,image/webp,image/gif',
      ...extraHeaders,
    },
  });
  if (!response || response.ok !== true) throw new Error(`image request failed: HTTP ${response?.status || 0}`);
  if (response.redirected === true) throw new Error('image redirects are not allowed');
  const bytes = await readResponseBytes(response);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image exceeds size limit');
  return bytes;
}

function giftImageCandidates(gift, imageBaseUrl) {
  const candidates = [];
  const serverCandidate = serverImageCandidate(gift?.imagePath, imageBaseUrl);
  const sourceCandidate = bilibiliImageCandidate(gift, serverCandidate);
  if (sourceCandidate) candidates.push(sourceCandidate);
  if (serverCandidate) candidates.push(serverCandidate);
  return candidates;
}

function bilibiliImageCandidate(gift, serverCandidate = null) {
  const id = String(gift?.id || '').trim();
  if (!/^[1-9]\d{0,19}$/u.test(id)) return null;
  const parsed = parseAllowedBilibiliImageUrl(gift?.sourceUrl);
  if (!parsed) return null;
  const extension = imageExtension(parsed.pathname);
  if (!extension) return null;
  const sourceHash = crypto
    .createHash('sha256')
    .update([parsed.href, serverCandidate?.url, gift?.variantId || giftVariantId(gift)].filter(Boolean).join('\n'))
    .digest('hex')
    .slice(0, 16);
  return {
    url: parsed.href,
    basename: `${id}-${sourceHash}${extension}`,
    headers: BILIBILI_IMAGE_HEADERS,
  };
}

function sourceImageCandidate(source, gift, imageBaseUrl) {
  const parsed = parseAllowedBilibiliImageUrl(source);
  if (!parsed) return null;
  if (parseAllowedBilibiliImageUrl(gift?.sourceUrl)?.href === parsed.href) {
    const candidate = bilibiliImageCandidate(gift, serverImageCandidate(gift.imagePath, imageBaseUrl));
    if (candidate) return candidate;
  }
  const hash = crypto.createHash('sha256').update(parsed.href).digest('hex');
  return { url: parsed.href, basename: `source-${hash}${imageExtension(parsed.pathname)}`, headers: BILIBILI_IMAGE_HEADERS };
}

function readImageIndex(filePath) {
  const images = new Map();
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (value?.schemaVersion !== 2 || !value.images || typeof value.images !== 'object' || Array.isArray(value.images)) return { images, valid: false };
    let valid = true;
    for (const [id, basename] of Object.entries(value.images)) {
      if (/^gv_[a-f0-9]{64}$/u.test(id) && typeof basename === 'string' && isSafeBasename(basename))
        images.set(id, basename);
      else valid = false;
    }
    return { images, valid };
  } catch (_) {
    // The image files remain reusable even if the optional fallback index is lost.
    return { images, valid: false };
  }
}

function serverImageCandidate(value, imageBaseUrl) {
  const parsed = parseAllowedImageUrl(value, imageBaseUrl);
  if (!parsed) return null;
  return {
    url: parsed.href,
    basename: path.posix.basename(parsed.pathname),
    headers: {},
  };
}

function parseAllowedBilibiliImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    (hostname !== BILIBILI_IMAGE_HOST && !hostname.endsWith(`.${BILIBILI_IMAGE_HOST}`)) ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443') ||
    parsed.hash ||
    !imageExtension(parsed.pathname)
  )
    return null;
  return parsed;
}

function imageExtension(pathname) {
  const extension = path.posix.extname(String(pathname || '')).toLowerCase();
  if (extension === '.apng') return '.png';
  return IMAGE_EXTENSIONS.has(extension) ? extension : '';
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
  if (typeof response.arrayBuffer !== 'function') throw new Error('image response body is unavailable');
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
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) return false;
    const bytes = await fs.promises.readFile(filePath);
    return validateImageBytes(bytes, basename);
  } catch (_) {
    return false;
  }
}

function isValidImageFileSync(filePath, basename) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) return false;
    const bytes = Buffer.alloc(Math.min(stats.size, 12));
    const descriptor = fs.openSync(filePath, 'r');
    try {
      const bytesRead = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
      return validateImageBytes(bytes.subarray(0, bytesRead), basename);
    } finally {
      fs.closeSync(descriptor);
    }
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
    return (
      bytes.length >= 6 &&
      (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')
    );
  if (extension === '.webp')
    return (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  return false;
}

async function writeAtomic(filePath, bytes) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
  );
  try {
    fs.writeFileSync(tempPath, bytes, { flag: 'wx', mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tempPath, filePath); break; }
      catch (error) {
        if (attempt >= 4 || !['EPERM', 'EBUSY'].includes(error.code)) throw error;
        await delay(50 * (attempt + 1));
      }
    }
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
  parseAllowedBilibiliImageUrl,
  validateImageBytes,
};
