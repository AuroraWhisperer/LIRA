'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function createPlaybackOutput({ executable, dataDir, onFault = () => {}, spawnProcess = spawn, exists = fs.existsSync }) {
  let child = null;
  let launching = null;
  let closing = null;
  let closed = false;
  let commandId = 0;
  let generation = 0;
  let activeStream = 0;
  let activeBackend = '';
  let packetSequence = 0;
  let queued = 0;
  let chain = Promise.resolve();
  const requests = new Map();

  function launch() {
    if (closed) return Promise.reject(new Error('播放输出正在关闭。'));
    if (launching) return launching;
    if (!exists(executable)) return Promise.reject(new Error('原生音频组件未就绪，请重新安装完整客户端。'));
    launching = new Promise((resolve, reject) => {
      const worker = spawnProcess(executable, ['--playback-output'], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LIRA_AUDIO_DATA_DIR: path.join(dataDir, 'playback-output') },
      });
      child = worker;
      const lines = createInterface({ input: worker.stdout });
      const timeout = setTimeout(() => { reject(new Error('播放输出启动超时。')); worker.kill(); }, 15000);
      lines.on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.type === 'ready') { clearTimeout(timeout); resolve(); }
        if (message.type === 'fault' && message.stream === activeStream) {
          activeStream = 0;
          onFault({ stream: message.stream, error: '输出设备不可用，请检查连接并重新选择。' });
        }
        const pending = requests.get(message.id);
        if (pending) { requests.delete(message.id); clearTimeout(pending.timer); pending.resolve(message); }
      });
      // Drain stderr without exposing native paths or accumulating unlimited logs.
      worker.stderr.on('data', () => {});
      const ended = () => {
        if (child !== worker) return;
        child = null;
        launching = null;
        clearTimeout(timeout);
        lines.close();
        const error = new Error('播放输出组件已退出，请重新选择输出设备。');
        reject(error);
        for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
        requests.clear();
        if (activeStream) onFault({ stream: activeStream, error: error.message });
        activeStream = 0;
      };
      worker.once('error', ended);
      worker.once('exit', ended);
      worker.stdin.on('error', ended);
    });
    return launching;
  }

  function request(op, value) {
    const id = ++commandId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(new Error('音频输出超时，播放已停止。'));
        child?.kill();
      }, 5000);
      requests.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, op, value }) + '\n', (error) => {
        if (error && requests.delete(id)) { clearTimeout(timer); reject(error); }
      });
    });
  }

  function invoke(op, value) {
    if (closed) return Promise.resolve({ ok: false, error: '播放输出正在关闭。' });
    if (queued >= 4) return Promise.resolve({ ok: false, error: '音频发送拥堵，播放已暂停，请重试。' });
    const epoch = op === 'open' || op === 'stop' ? ++generation : generation;
    if (op === 'open' || op === 'stop') activeStream = 0;
    queued++;
    const work = chain.then(async () => {
      if (op === 'stop' && !child) return { ok: true };
      if (op === 'write' && (!activeStream || value.stream !== activeStream)) return { ok: true, stale: true };
      await launch();
      let argument = value;
      if (op === 'open') argument = { deviceId: value.deviceId, stream: epoch };
      if (op === 'write') argument = {
        stream: value.stream, sequence: ++packetSequence, pcm: Buffer.from(value.pcm).toString('base64'),
      };
      const response = await request(op, argument);
      if (op === 'open' && response.ok && epoch === generation) {
        activeStream = epoch;
        activeBackend = response.data.backend;
        packetSequence = 0;
      }
      if (!response.ok && op === 'write' && value.stream === activeStream) {
        activeStream = 0;
        onFault({ stream: value.stream, error: '音频输出中断，请重新选择输出设备。' });
      }
      return response;
    }).catch(() => ({ ok: false, error: '音频输出失败，请检查设备连接后重新选择。' }))
      .finally(() => { queued--; });
    chain = work;
    return work;
  }

  function dispose() {
    if (closing) return closing;
    closed = true;
    generation++;
    activeStream = 0;
    const worker = child;
    if (!worker) return Promise.resolve();
    closing = new Promise((resolve) => {
      const timer = setTimeout(() => { worker.kill(); resolve(); }, 2500);
      worker.once('exit', () => { clearTimeout(timer); resolve(); });
      worker.stdin.end();
    });
    return closing;
  }

  return { invoke, dispose, getProcessId: () => child?.pid || null,
    getCaptureProcessId: () => activeStream && activeBackend !== 'asio' ? child?.pid || null : null };
}

module.exports = { createPlaybackOutput };
