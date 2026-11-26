'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const manifestDefault = require('./audio-component-manifest.json');
const { resolveCdnOrigin, writeResource } = require('../resources/resource-download');
const { ensureAudioRoot, verifyAudioDirectory, extractAudioComponent, tryPublishAudioDirectory,
  audioImageBusy, pruneObsoleteAudioVersions, pruneAudioPreparations } = require('./audio-component-files');

function createAudioComponentManager({ dataDir, bundledDirectory, manifest = manifestDefault,
  fetch: fetchImpl = globalThis.fetch, cdnBaseUrl, canDownload = () => true, onState = () => {},
  platform = process.platform, arch = process.arch } = {}) {
  const root = path.join(dataDir, 'components', 'audio');
  const directory = path.join(root, manifest.id);
  const origin = resolveCdnOrigin(cdnBaseUrl);
  const controller = new AbortController();
  let task = null;
  let obsoleteCleanup = null;
  let executable = '';
  let failure = null;
  let state = { status: 'idle', totalBytes: 0, downloadedBytes: 0, revision: 0 };

  function publish(patch) { state = { ...state, ...patch, revision: state.revision + 1 }; onState({ ...state }); }

  async function prepare() {
    const { signal } = controller;
    signal.throwIfAborted();
    if (platform !== manifest.platform || arch !== manifest.arch) throw new Error('AUDIO_PLATFORM_UNSUPPORTED');
    publish({ status: 'checking', error: '', totalBytes: 0, downloadedBytes: 0 });
    await ensureAudioRoot(dataDir);
    await pruneAudioPreparations(dataDir, root, manifest.entry, signal).catch(() => {});
    if (await verifyAudioDirectory(directory, manifest, signal)) return path.join(directory, manifest.entry);
    const legacy = path.join(root, 'legacy');
    if (await verifyAudioDirectory(legacy, manifest, signal)) {
      // A verified legacy image remains usable in place while either path is busy.
      if (!await audioImageBusy(legacy, manifest.entry) && await tryPublishAudioDirectory(legacy, directory, manifest.entry)) {
        return path.join(directory, manifest.entry);
      }
      return path.join(legacy, manifest.entry);
    }
    if (bundledDirectory && await verifyAudioDirectory(bundledDirectory, manifest, signal))
      return path.join(bundledDirectory, manifest.entry);
    if (!canDownload()) throw new Error('AUDIO_AUTHORIZATION_REQUIRED');
    if (await audioImageBusy(directory, manifest.entry)) throw new Error('AUDIO_COMPONENT_IN_USE');
    const staging = await fs.mkdtemp(path.join(root, '.prepare-'));
    const stalled = new AbortController();
    const startIdleTimer = () => setTimeout(() => stalled.abort(), 300000);
    let idleTimer = startIdleTimer();
    try {
      publish({ status: 'downloading', totalBytes: manifest.archive.size, downloadedBytes: 0 });
      const attempt = AbortSignal.any([signal, stalled.signal]);
      const response = await fetchImpl(`${origin}/${manifest.archive.path}`, {
        signal: attempt, credentials: 'omit', redirect: 'error',
      });
      if (!response.ok || Number(response.headers.get('content-length')) > manifest.archive.size) {
        await response.body?.cancel();
        throw new Error('AUDIO_DOWNLOAD_FAILED');
      }
      let lastProgress = 0;
      let lastSize = 0;
      const archive = await writeResource(manifest.archive, response.body, {
        directory: staging, signal: attempt, onProgress: downloadedBytes => {
          if (downloadedBytes <= lastSize) return;
          lastSize = downloadedBytes;
          clearTimeout(idleTimer);
          idleTimer = startIdleTimer();
          if (Date.now() - lastProgress < 200 && downloadedBytes !== manifest.archive.size) return;
          lastProgress = Date.now();
          publish({ downloadedBytes });
        },
      });
      clearTimeout(idleTimer);
      publish({ status: 'installing', downloadedBytes: manifest.archive.size });
      const unpacked = path.join(staging, 'unpacked');
      await fs.mkdir(unpacked);
      await extractAudioComponent(archive, manifest, unpacked, signal);
      signal.throwIfAborted();
      if (!await tryPublishAudioDirectory(unpacked, directory, manifest.entry)) throw new Error('AUDIO_COMPONENT_IN_USE');
      return path.join(directory, manifest.entry);
    } finally {
      clearTimeout(idleTimer);
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  function preparationErrorMessage(error) {
    if (controller.signal.aborted) return '音频组件已关闭，请重新打开 LIRA。';
    if (error.message === 'AUDIO_AUTHORIZATION_REQUIRED') return '下载音频组件需要 LIRA 账号授权，请确认授权后重试。';
    if (error.message === 'AUDIO_PLATFORM_UNSUPPORTED') return '这台设备不支持音频组件。';
    if (error.message === 'AUDIO_COMPONENT_IN_USE') return '音频组件暂时无法替换。请在播放或原声恢复结束后，到「系统与关于」重试。';
    return '音频组件准备失败。请打开「百宝箱 → 设置 → 系统与关于」，在音频组件下载任务旁点击「重试」。';
  }

  function initialize({ retry = false } = {}) {
    if (controller.signal.aborted) return Promise.reject(new Error('AUDIO_COMPONENT_CLOSED'));
    if (executable) return Promise.resolve(executable);
    if (task) return task;
    if (failure && !retry) return Promise.reject(failure);
    failure = null;
    task = prepare().then(filename => {
      controller.signal.throwIfAborted();
      executable = filename;
      publish({ status: 'ready', error: '' });
      obsoleteCleanup ??= pruneObsoleteAudioVersions(dataDir, root, manifest, path.dirname(filename), controller.signal).catch(() => {});
      return filename;
    }).catch(error => {
      failure = error.message === 'AUDIO_AUTHORIZATION_REQUIRED' ? null : error;
      const hasRetryTask = failure && !controller.signal.aborted && error.message !== 'AUDIO_PLATFORM_UNSUPPORTED';
      publish({ status: hasRetryTask ? 'error' : 'idle', error: preparationErrorMessage(error) });
      throw error;
    }).finally(() => { task = null; });
    return task;
  }

  async function getExecutable() {
    // A new worker can start long after background preparation finished.
    if (!task) executable = '';
    try { return await initialize(); }
    catch (cause) {
      throw new Error(preparationErrorMessage(cause), { cause });
    }
  }

  function retry() {
    if (task) return task;
    executable = '';
    return initialize({ retry: true });
  }

  return { initialize, getExecutable, retry, getState: () => ({ ...state }),
    async close() { controller.abort(); await task?.catch(() => {}); await obsoleteCleanup; } };
}

module.exports = { createAudioComponentManager };
