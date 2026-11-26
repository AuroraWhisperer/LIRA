'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { resolveDataPaths } = require('../shared/data-paths');
const { pruneManagedFiles } = require('../shared/file-retention');
const { MAX_ASSET_BYTES, resolveCdnOrigin, readManifest, validateManifest, objectName, downloadResource } = require('./resource-download');
const { extractResourcePackage } = require('./resource-archive');
const { isLegacyResource } = require('./resource-packages');
const catalog = require('./catalog.json');
const RESOURCE_ERRORS = new Set(['RESOURCE_MANIFEST_UNAVAILABLE', 'RESOURCE_MANIFEST_INVALID',
  'RESOURCE_DOWNLOAD_FAILED', 'RESOURCE_SIZE_INVALID', 'RESOURCE_HASH_INVALID', 'RESOURCE_ARCHIVE_INVALID']);
const FILE_ERRORS = new Set(['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'EROFS', 'EBUSY', 'ENOENT']);

function createResourceLibrary({ dataDir, publicDir, files = catalog.files, fetch = globalThis.fetch,
  cdnBaseUrl, timeoutMs, manifestTimeoutMs, logger = console } = {}) {
  const origin = resolveCdnOrigin(cdnBaseUrl);
  const directory = path.join(resolveDataPaths(dataDir).cacheDir, 'resources');
  const indexPath = path.join(directory, 'index.json');
  const allowed = new Map(files.map(file => [file.path, file]));
  const sharedFiles = files.filter(file => !isLegacyResource(file.path));
  const available = new Map();
  const assetWaiters = new Map();
  const blocked = new Set();
  const invalidObjects = new Set();
  const versionChecks = new Map();
  const listeners = new Set();
  const controller = new AbortController();
  let installed = readIndex();
  let scanId = 0;
  let lastCompletedScan = 0;
  let pending = null;
  let downloadingFiles = null;
  let checked = false;
  let closed = false;
  let writes = Promise.resolve();
  let requestStarts = [];
  let state = { status: 'idle', total: 0, completed: 0, failed: 0, currentFont: '',
    totalBytes: 0, downloadedBytes: 0, completedAt: '' };

  const getState = () => ({ ...state });
  function reportFailure(error, phase, resourceId) {
    const code = RESOURCE_ERRORS.has(error?.message) ? error.message
      : FILE_ERRORS.has(error?.code) ? error.code
        : error?.name === 'TimeoutError' ? 'RESOURCE_TIMEOUT'
          : phase === 'manifest' && error instanceof SyntaxError ? 'RESOURCE_MANIFEST_INVALID'
            : 'RESOURCE_OPERATION_FAILED';
    logger.warn('[Resources] preparation failed', { phase, code,
      ...(resourceId ? { resourceId: resourceId.slice(0, 200) } : {}) });
  }

  function publish(patch) {
    state = { ...state, ...patch };
    if (!closed) for (const listener of listeners) {
      try { listener(getState()); } catch { continue; }
    }
    return getState();
  }

  function readIndex() {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (index.version !== 1 || !index.files || typeof index.files !== 'object') return {};
      const valid = entry => entry && /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.size)
        && entry.size > 0 && entry.size <= MAX_ASSET_BYTES;
      return Object.fromEntries(files.flatMap(({ path }) => {
        const entry = index.files[path];
        if (!valid(entry)) return [];
        const previous = entry.previous;
        return [[path, { sha256: entry.sha256, size: entry.size,
          ...(valid(previous) && { previous: { sha256: previous.sha256, size: previous.size } }) }]];
      }));
    } catch { return {}; }
  }

  async function matches(filename, entry) {
    const { signal } = controller;
    signal.throwIfAborted();
    try {
      const { size } = await fs.promises.stat(filename);
      if (size <= 0 || size > MAX_ASSET_BYTES || (entry.size !== undefined && size !== entry.size)) return false;
      const hash = createHash('sha256');
      for await (const chunk of fs.createReadStream(filename, { signal })) hash.update(chunk);
      return hash.digest('hex') === entry.sha256;
    } catch { signal.throwIfAborted(); return false; }
  }

  function wakeAsset(name) {
    const waiter = assetWaiters.get(name);
    if (waiter) {
      assetWaiters.delete(name);
      waiter.resolve();
    }
  }

  function canStillPublish(key) {
    if (blocked.has(key)) return false;
    // Different packages can publish the same immutable object.
    return !downloadingFiles || downloadingFiles.has(key) || downloadingFiles.values().some(object => object === key);
  }

  function markAvailable(file, filename) {
    available.set(file.path, { file, filename, scanId });
    wakeAsset(file.path);
    wakeAsset(objectName(file));
  }

  async function scan(signal) {
    for (const file of files) {
      signal.throwIfAborted();
      const cached = { ...file, ...installed[file.path] };
      const filename = path.join(directory, objectName(cached));
      let valid = await matches(filename, cached);
      // The index can survive a crash between committing a package and exposing its object names.
      if (!valid && installed[file.path] && await matches(`${filename}.pending`, cached)) {
        try {
          await fs.promises.rename(`${filename}.pending`, filename);
          valid = true;
        } catch (error) {
          reportFailure(error, 'publish', file.path);
          blocked.add(file.path);
        }
      }
      if (valid) {
        invalidObjects.delete(filename);
        markAvailable(cached, filename);
      } else {
        invalidObjects.add(filename);
        available.delete(file.path);
        const previous = cached.previous ? { ...file, ...cached.previous } : file;
        const fallback = path.join(directory, objectName(previous));
        if (fallback !== filename && await matches(fallback, previous)) {
          markAvailable(previous, fallback);
        } else if (publicDir && await matches(path.join(publicDir, file.path), file)) {
          markAvailable(file, path.join(publicDir, file.path));
        }
        if (blocked.has(file.path)) wakeAsset(file.path);
        else delete installed[file.path];
      }
    }
  }

  function commit(files, staged) {
    const write = writes.then(async () => {
      const next = { ...installed };
      const promoting = new Set();
      for (const file of files) {
        const filename = path.join(directory, objectName(file));
        const temporary = staged?.get(file.path);
        if (temporary && !promoting.has(filename)) {
          if (temporary !== `${filename}.pending`) await fs.promises.rename(temporary, `${filename}.pending`);
          promoting.add(filename);
        }
        const previous = available.get(file.path)?.file;
        next[file.path] = { sha256: file.sha256, size: file.size,
          ...(previous && previous.sha256 !== file.sha256 && { previous: { sha256: previous.sha256, size: previous.size } }) };
      }
      await atomicWrite(indexPath, JSON.stringify({ version: 1, files: next }));
      installed = next;
      // A public name is always readable history. Only verified private payloads need promotion.
      for (const filename of promoting) await fs.promises.rename(`${filename}.pending`, filename);
      for (const file of files) {
        const filename = path.join(directory, objectName(file));
        invalidObjects.delete(filename);
        markAvailable(file, filename);
      }
    });
    writes = write.catch(() => undefined);
    return write;
  }

  async function fetchWithRateLimit(url, options) {
    const { signal } = options;
    while (true) {
      const now = performance.now();
      requestStarts = requestStarts.filter(started => now - started < 1000);
      // Leave headroom under the CDN's current 10 requests/second setting.
      if (requestStarts.length < 8) {
        // An awaited reservation can expire before its actual fetch starts.
        try { return fetch(url, options); }
        finally { requestStarts.push(performance.now()); }
      }
      await delay(Math.max(1, 1000 - (now - requestStarts[0])), undefined, { signal });
    }
  }

  function initialize({ force = false } = {}) {
    if (closed) return Promise.resolve(getState());
    if (pending) return pending;
    if (checked && !force) return Promise.resolve(getState());
    checked = true;
    scanId++;
    const signal = controller.signal;
    blocked.clear();
    let phase = 'cache';
    pending = (async () => {
      publish({ status: 'checking', total: 0, completed: 0, failed: 0, currentFont: '',
        totalBytes: 0, downloadedBytes: 0, completedAt: '' });
      const keep = new Set(Object.entries(installed).map(([path, file]) => `${objectName({ path, ...file })}.pending`));
      pruneManagedFiles(dataDir, directory, { maxAgeMs: 86400000, keep, matches: name =>
        /^[a-f0-9]{64}\.(?:zip|[a-z0-9]+\.pending)$/.test(name) ||
        /^(?:index\.json|[a-f0-9]{64}\.[a-z0-9]+)\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(name) });
      await scan(signal);
      lastCompletedScan = scanId;
      phase = 'manifest';
      const manifest = await readManifest({ origin, fetch: fetchWithRateLimit, signal, timeoutMs: manifestTimeoutMs });
      const { files: published, downloads } = validateManifest(manifest, sharedFiles);
      phase = 'publish';
      const needsFile = file => {
        const ready = available.get(file.path)?.file;
        return !ready || ready.sha256 !== file.sha256 || ready.size !== file.size;
      };
      // A verified public cache object can outlive its index. Bundled fallback paths cannot.
      const unindexed = published.filter(file => !needsFile(file) && !installed[file.path]
        && available.get(file.path).filename === path.join(directory, objectName(file)));
      const retryIndex = new Set();
      if (unindexed.length) {
        try { await commit(unindexed); }
        catch (error) {
          reportFailure(error, 'publish');
          for (const file of unindexed) retryIndex.add(file.path);
        }
      }
      const missing = [];
      let failedPackages = 0;
      for (const resource of downloads) {
        if (resource.files.some(file => blocked.has(file.path))) {
          failedPackages++;
          continue;
        }
        const changed = resource.files.filter(needsFile);
        const repairs = resource.files.filter(file => retryIndex.has(file.path));
        if (!changed.length) {
          if (repairs.length) failedPackages++;
          continue;
        }
        // A missing member still needs the ZIP. Retry its siblings' index entries with this package's commit.
        const indexFiles = changed.concat(repairs);
        const staged = new Map();
        let complete = true;
        for (const file of changed) {
          const filename = path.join(directory, objectName(file));
          if (await matches(filename, file)) continue;
          const candidate = `${filename}.pending`;
          if (!await matches(candidate, file)) { complete = false; break; }
          staged.set(file.path, candidate);
        }
        if (complete) {
          try { await commit(indexFiles, staged); }
          catch (error) {
            reportFailure(error, 'publish', resource.id);
            failedPackages++;
          }
        } else missing.push({ ...resource, files: changed, indexFiles });
      }
      if (!missing.length) return publish(failedPackages
        ? { status: 'error', total: failedPackages, completed: failedPackages, failed: failedPackages, completedAt: new Date().toISOString() }
        : { status: 'ready' });
      await fs.promises.mkdir(directory, { recursive: true });
      downloadingFiles = new Map(missing.flatMap(resource => resource.files.map(file => [file.path, objectName(file)])));
      for (const key of assetWaiters.keys()) if (!canStillPublish(key)) wakeAsset(key);
      publish({ status: 'downloading', total: missing.length + failedPackages, failed: failedPackages,
        completed: failedPackages, totalBytes: missing.reduce((sum, file) => sum + file.size, 0) });
      let next = 0;
      let finishedBytes = 0;
      let lastProgressAt = 0;
      const active = new Map();
      const byteProgress = () => finishedBytes + [...active.values()].reduce((sum, task) => sum + task.bytes, 0);
      async function worker() {
        while (next < missing.length && !signal.aborted) {
          const file = missing[next++];
          const task = { label: file.label || path.posix.basename(file.path), bytes: 0 };
          active.set(file.id, task);
          publish({ currentFont: task.label });
          let failed = 0;
          let resourcePhase = 'download';
          try {
            const downloaded = await downloadResource(file, { origin, directory, fetch: fetchWithRateLimit, signal, timeoutMs,
              onProgress(bytes) {
                task.bytes = bytes;
                if (Date.now() - lastProgressAt >= 100) {
                  lastProgressAt = Date.now();
                  publish({ downloadedBytes: byteProgress() });
                }
              } });
            const staged = new Map();
            try {
              signal.throwIfAborted();
              resourcePhase = 'extract';
              if (file.archive) await extractResourcePackage(downloaded, file, { directory, signal, staged });
              else staged.set(file.files[0].path, downloaded);
              signal.throwIfAborted();
              resourcePhase = 'publish';
              await commit(file.indexFiles, staged);
            } finally {
              for (const temporary of new Set([downloaded, ...staged.values()]))
                await fs.promises.rm(temporary, { force: true });
            }
            finishedBytes += file.size;
          } catch (error) {
            failed = 1;
            if (!signal.aborted) reportFailure(error, resourcePhase, file.id);
          }
          for (const member of file.files) {
            downloadingFiles.delete(member.path);
            wakeAsset(member.path);
            wakeAsset(objectName(member));
          }
          active.delete(file.id);
          publish({ completed: state.completed + 1, failed: state.failed + failed, downloadedBytes: byteProgress(),
            currentFont: active.values().next().value?.label || '' });
        }
      }
      await Promise.all([worker(), worker()]);
      signal.throwIfAborted();
      return publish({ status: state.failed ? 'error' : 'ready', currentFont: '', completedAt: new Date().toISOString() });
    })().catch(error => {
      const missing = sharedFiles.filter(file => blocked.has(file.path) || !available.has(file.path)).length;
      const failed = missing || Number(phase === 'publish' && !signal.aborted);
      if (!signal.aborted && (failed || state.total)) reportFailure(error, phase);
      return publish({ status: closed ? 'idle' : failed || state.total ? 'error' : 'ready', currentFont: '',
        ...(state.total ? {} : { total: failed, completed: failed, failed }),
        completedAt: state.total || failed ? new Date().toISOString() : '' });
    }).finally(() => {
      pending = null;
      downloadingFiles = null;
      for (const name of assetWaiters.keys()) wakeAsset(name);
    });
    return pending;
  }

  function resolveAsset(name, hash) {
    if (!allowed.has(name)) return null;
    const ready = available.get(name);
    if (!hash || hash === ready?.file.sha256) return ready?.filename || null;
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const object = objectName({ path: name, sha256: hash });
    const filename = path.join(directory, object);
    return !invalidObjects.has(filename) && fs.existsSync(filename) ? filename : null;
  }

  async function waitForAsset(name, hash) {
    if (!allowed.has(name)) return null;
    const current = pending;
    const key = hash ? objectName({ path: name, sha256: hash }) : name;
    while (true) {
      const filename = resolveAsset(name, hash);
      const active = available.get(name);
      const awaitingScan = current && pending === current && lastCompletedScan !== scanId && !active
        && (installed[name] || allowed.get(name)).sha256 === hash;
      if (filename && (!hash || active?.file.sha256 === hash)) {
        if (active.scanId === scanId) return filename;
      } else if (filename && !awaitingScan) {
        // A sibling can publish the requested digest before this path is ready. Verify the public bytes.
        let check = versionChecks.get(filename);
        if (!check) {
          check = matches(filename, { sha256: hash }).catch(error => {
            if (!closed) throw error;
            return false;
          }).finally(() => versionChecks.delete(filename));
          versionChecks.set(filename, check);
        }
        if (await check) return filename;
        const ready = available.get(name);
        if (ready?.file.sha256 === hash && ready.scanId === scanId) return ready.filename;
      }
      if (!current || pending !== current || !canStillPublish(key)) return null;
      // A cached version can become ready before the requested update commits.
      let waiter = assetWaiters.get(key);
      if (!waiter) {
        waiter = Promise.withResolvers();
        assetWaiters.set(key, waiter);
      }
      await waiter.promise;
    }
  }

  async function close() {
    closed = true;
    controller.abort();
    await pending;
    await writes;
    listeners.clear();
  }

  return { initialize, getState, resolveAsset, waitForAsset, close,
    isManaged: name => allowed.has(name),
    assetHash: name => available.get(name)?.file.sha256 || '',
    onStateChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}

async function atomicWrite(filename, bytes) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.promises.rename(temporary, filename);
  } finally { await fs.promises.rm(temporary, { force: true }); }
}

module.exports = { createResourceLibrary };
