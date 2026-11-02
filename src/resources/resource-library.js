'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { resolveDataPaths } = require('../shared/data-paths');
const { resolveCdnOrigin, readManifest, validateManifest, objectName, downloadResource } = require('./resource-download');
const { extractResourcePackage } = require('./resource-archive');
const catalog = require('./catalog.json');

function createResourceLibrary({ dataDir, publicDir, files = catalog.files, fetch = globalThis.fetch,
  cdnBaseUrl, timeoutMs, manifestTimeoutMs } = {}) {
  const origin = resolveCdnOrigin(cdnBaseUrl);
  const directory = path.join(resolveDataPaths(dataDir).cacheDir, 'resources');
  const indexPath = path.join(directory, 'index.json');
  const allowed = new Map(files.map(file => [file.path, file]));
  const available = new Map();
  const listeners = new Set();
  let installed = readIndex();
  let pending = null;
  let controller = null;
  let checked = false;
  let closed = false;
  let writes = Promise.resolve();
  let requestStarts = [];
  let state = { status: 'idle', total: 0, completed: 0, failed: 0, currentFont: '',
    totalBytes: 0, downloadedBytes: 0, completedAt: '' };

  const getState = () => ({ ...state });
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
      return Object.fromEntries(files.filter(file => {
        const entry = index.files[file.path];
        return entry && /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.size)
          && entry.size > 0 && entry.size <= 128 * 1024 * 1024;
      }).map(file => [file.path, { sha256: index.files[file.path].sha256, size: index.files[file.path].size }]));
    } catch { return {}; }
  }

  async function matches(filename, entry) {
    try {
      if ((await fs.promises.stat(filename)).size !== entry.size) return false;
      const hash = createHash('sha256');
      for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
      return hash.digest('hex') === entry.sha256;
    } catch { return false; }
  }

  async function scan(signal) {
    for (const file of files) {
      signal.throwIfAborted();
      const cached = { ...file, ...installed[file.path] };
      const filename = path.join(directory, objectName(cached));
      if (await matches(filename, cached)) available.set(file.path, { file: cached, filename });
      else {
        available.delete(file.path);
        delete installed[file.path];
        if (publicDir) {
          const source = path.join(publicDir, file.path);
          if (await matches(source, file)) available.set(file.path, { file, filename: source });
        }
      }
    }
  }

  function commit(files) {
    const write = writes.then(async () => {
      const next = { ...installed };
      for (const file of files) next[file.path] = { sha256: file.sha256, size: file.size };
      await atomicWrite(indexPath, JSON.stringify({ version: 1, files: next }));
      installed = next;
      for (const file of files) available.set(file.path, { file, filename: path.join(directory, objectName(file)) });
    });
    writes = write.catch(() => undefined);
    return write;
  }

  async function requestSlot(signal) {
    while (true) {
      const now = Date.now();
      requestStarts = requestStarts.filter(started => now - started < 1000);
      // Leave headroom under the CDN's current 10 requests/second setting.
      if (requestStarts.length < 8) { requestStarts.push(now); return; }
      await delay(Math.max(1, 1000 - (now - requestStarts[0])), undefined, { signal });
    }
  }

  function initialize({ force = false } = {}) {
    if (closed) return Promise.resolve(getState());
    if (pending) return pending;
    if (checked && !force) return Promise.resolve(getState());
    checked = true;
    controller = new AbortController();
    const signal = controller.signal;
    pending = (async () => {
      publish({ status: 'checking', total: 0, completed: 0, failed: 0, currentFont: '',
        totalBytes: 0, downloadedBytes: 0, completedAt: '' });
      await scan(signal);
      await requestSlot(signal);
      const manifest = await readManifest({ origin, fetch, signal, timeoutMs: manifestTimeoutMs });
      const { downloads } = validateManifest(manifest, files);
      const needsFile = file => {
        const ready = available.get(file.path)?.file;
        return !ready || ready.sha256 !== file.sha256 || ready.size !== file.size;
      };
      for (const resource of downloads) {
        const changed = resource.files.filter(needsFile);
        if (!changed.length) continue;
        let complete = true;
        for (const file of changed) {
          if (!await matches(path.join(directory, objectName(file)), file)) { complete = false; break; }
        }
        if (complete) await commit(changed);
      }
      const missing = downloads.map(resource => ({ ...resource, files: resource.files.filter(needsFile) }))
        .filter(resource => resource.files.length);
      if (!missing.length) return publish({ status: 'ready' });
      await fs.promises.mkdir(directory, { recursive: true });
      publish({ status: 'downloading', total: missing.length, totalBytes: missing.reduce((sum, file) => sum + file.size, 0) });
      let next = 0;
      let finishedBytes = 0;
      let lastProgressAt = 0;
      const activeBytes = new Map();
      const byteProgress = () => finishedBytes + [...activeBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
      async function worker() {
        while (next < missing.length && !signal.aborted) {
          const file = missing[next++];
          publish({ currentFont: file.label || path.posix.basename(file.path) });
          let failed = 0;
          try {
            await requestSlot(signal);
            const downloaded = await downloadResource(file, { origin, directory, fetch, signal, timeoutMs,
              onProgress(bytes) {
                activeBytes.set(file.id, bytes);
                if (Date.now() - lastProgressAt >= 100) {
                  lastProgressAt = Date.now();
                  publish({ downloadedBytes: byteProgress() });
                }
              } });
            try {
              signal.throwIfAborted();
              if (file.archive) await extractResourcePackage(downloaded, file, { directory, signal });
              signal.throwIfAborted();
              await commit(file.files);
            } finally {
              if (file.archive) await fs.promises.rm(downloaded, { force: true });
            }
            finishedBytes += file.size;
          } catch { failed = 1; }
          activeBytes.delete(file.id);
          publish({ completed: state.completed + 1, failed: state.failed + failed, downloadedBytes: byteProgress() });
        }
      }
      await Promise.all([worker(), worker()]);
      signal.throwIfAborted();
      return publish({ status: state.failed ? 'error' : 'ready', currentFont: '', completedAt: new Date().toISOString() });
    })().catch(() => {
      const missing = files.filter(file => !available.has(file.path)).length;
      return publish({ status: closed ? 'idle' : missing || state.total ? 'error' : 'ready', currentFont: '',
        ...(state.total ? {} : { total: missing, completed: missing, failed: missing }),
        completedAt: state.total || missing ? new Date().toISOString() : '' });
    }).finally(() => { pending = null; controller = null; });
    return pending;
  }

  function resolveAsset(name, hash) {
    if (!allowed.has(name)) return null;
    const ready = available.get(name);
    if (!hash || hash === ready?.file.sha256) return ready?.filename || null;
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const filename = path.join(directory, objectName({ path: name, sha256: hash }));
    return fs.existsSync(filename) ? filename : null;
  }

  async function waitForAsset(name, hash) {
    const filename = resolveAsset(name, hash);
    if (filename || !allowed.has(name)) return filename;
    await pending;
    return resolveAsset(name, hash);
  }

  async function close() {
    closed = true;
    controller?.abort();
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
