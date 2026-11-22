'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function createAudioAssistant({ executable, getExecutable, dataDir, spawnProcess = spawn, exists = fs.existsSync, onState = () => {}, getProcessIds = () => [], getPlaybackProcessId = () => null }) {
  let child = null;
  let launching = null;
  let closing = null;
  let closed = false;
  let sequence = 0;
  let state = { ready: false, running: false, starting: false, status: '电音助手尚未启动。' };
  const requests = new Map();

  function publish(next) {
    const internalSource = next.ready === true && Number.isInteger(next.sourceProcessId) && getProcessIds().includes(next.sourceProcessId);
    state = { ...next, internalSource, revision: (state.revision || 0) + 1 };
    onState(state);
  }

  function launch() {
    if (closed) return Promise.reject(new Error('电音助手正在关闭。'));
    if (child && state.ready) return Promise.resolve();
    if (launching) return launching;
    const pending = Promise.resolve().then(() => getExecutable ? getExecutable() : executable).then(filename => {
      if (closed) throw new Error('电音助手正在关闭。');
      return launchWorker(filename);
    }).catch(error => { if (launching === pending) launching = null; throw error; });
    launching = pending;
    return launching;
  }

  function launchWorker(executable) {
    if (!exists(executable)) return Promise.reject(new Error('找不到音频组件，请重启 LIRA 以重新检查组件文件。'));
    const { promise, resolve, reject } = Promise.withResolvers();
    let settled = false;
    const timer = setTimeout(() => {
      reject(new Error('音频组件启动超时，请重试。'));
      processHandle.kill();
    }, 15000);
    const processHandle = spawnProcess(executable, ['--bridge'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LIRA_AUDIO_DATA_DIR: path.join(dataDir, 'audio-assistant') },
    });
    child = processHandle;
    const lines = createInterface({ input: processHandle.stdout });
    let errorText = '';
    processHandle.stderr.on('data', (chunk) => { errorText = (errorText + chunk.toString()).slice(-4096); });
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.type === 'state') {
        publish(message.state);
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
      }
      const pending = requests.get(message.id);
      if (pending) {
        requests.delete(message.id);
        clearTimeout(pending.timer);
        pending.resolve({ ...message, state });
      }
    });
    function ended(error) {
      if (child !== processHandle) return;
      child = null;
      launching = null;
      clearTimeout(timer);
      lines.close();
      const message = error?.message || errorText.trim() || '音频组件已退出。如果播放器没有声音，请点击「恢复原声」。';
      if (!settled) reject(new Error(message));
      for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
      requests.clear();
      publish({ ...state, ready: false, running: false, starting: false, status: message });
    }
    processHandle.once('error', ended);
    processHandle.once('exit', () => ended());
    processHandle.stdin.on('error', ended);
    return promise;
  }

  async function invoke(op, value) {
    if (op === 'stop' && !child) return { ok: true, state };
    try {
      await launch();
      const id = ++sequence;
      const { promise, resolve, reject } = Promise.withResolvers();
      const worker = child;
      const pending = { resolve, reject, timer: setTimeout(onTimeout, 45000) };
      async function onTimeout() {
        // A paused player can leave Start awaiting a stream. The bridge still answers Get.
        if (op === 'start' && state.starting && state.sourceProcessId && child === worker && !closed) {
          const health = await invoke('get');
          if (!requests.has(id)) return;
          if (health.ok && health.state.starting) {
            pending.timer = setTimeout(onTimeout, 45000);
            return;
          }
        }
        requests.delete(id);
        reject(new Error('音频操作超时，可关闭当前歌曲处理后重试。'));
        if (child === worker && !worker.stdin.writableEnded) worker.stdin.end();
      }
      requests.set(id, pending);
      worker.stdin.write(JSON.stringify({ id, op, value, playbackProcessId: getPlaybackProcessId() }) + '\n');
      return await promise;
    } catch (error) {
      return { ok: false, error: error.message, state };
    }
  }

  function dispose() {
    closed = true;
    if (closing) return closing;
    if (!child) return Promise.resolve();
    const processHandle = child;
    closing = new Promise((resolve) => {
      const timer = setTimeout(() => { processHandle.kill(); resolve(); }, 3500);
      processHandle.once('exit', () => { clearTimeout(timer); resolve(); });
      // EOF is the worker's shutdown signal. Its guard retains recovery ownership.
      processHandle.stdin.end();
    });
    return closing;
  }

  return { invoke, dispose, getState: () => state };
}

module.exports = { createAudioAssistant };
