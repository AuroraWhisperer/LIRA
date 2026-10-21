'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function createAudioAssistant({ executable, dataDir, spawnProcess = spawn, exists = fs.existsSync, onState = () => {}, getProcessIds = () => [], getPlaybackProcessId = () => null }) {
  let child = null;
  let launching = null;
  let closing = null;
  let sequence = 0;
  let state = { ready: false, running: false, starting: false, status: '电音助手尚未启动。' };
  const requests = new Map();

  function publish(next) {
    const internalSource = next.ready === true && Number.isInteger(next.sourceProcessId) && getProcessIds().includes(next.sourceProcessId);
    state = { ...next, internalSource, revision: (state.revision || 0) + 1 };
    onState(state);
  }

  function launch() {
    if (closing) return Promise.reject(new Error('电音助手正在关闭。'));
    if (child && state.ready) return Promise.resolve();
    if (launching) return launching;
    if (!exists(executable)) return Promise.reject(new Error('音频组件未就绪，请重新安装完整客户端；开发环境请先运行 npm run build:audio-assistant。'));
    const { promise, resolve, reject } = Promise.withResolvers();
    launching = promise;
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
      const message = error?.message || errorText.trim() || '音频组件已退出；如有原声路由，恢复助手会继续还原。';
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
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(new Error('音频操作超时，可关闭当前歌曲处理后重试。'));
        // Closing stdin also reaches the existing route guard if the worker stalls.
        if (child) child.stdin.end();
      }, 45000);
      requests.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, op, value, playbackProcessId: getPlaybackProcessId() }) + '\n');
      return await promise;
    } catch (error) {
      return { ok: false, error: error.message, state };
    }
  }

  function dispose() {
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
