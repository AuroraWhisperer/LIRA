'use strict';

export function createNativeOutput(audio, { bridge, onFault, AudioContextClass = globalThis.AudioContext,
  WorkletNodeClass = globalThis.AudioWorkletNode } = {}) {
  let context;
  let node;
  let source;
  let graph;
  let selectedId = '';
  let stream = 0;
  let epoch = 0;
  let opening;
  let sending = false;
  let disposed = false;
  let naturallyEnded = false;
  let endTimer;
  const packets = [];
  audio.crossOrigin = 'anonymous';

  function route() { node?.port.postMessage({ native: Boolean(selectedId), stream }); }
  function invalidate() {
    epoch++;
    stream = 0;
    opening = null;
    packets.length = 0;
    route();
  }
  function fail(error) {
    if (disposed) return;
    stop();
    audio.pause();
    onFault(error || '音频输出中断，请重新选择输出设备。');
  }
  async function sendPackets() {
    if (sending) return;
    sending = true;
    try {
      while (packets.length && !disposed) {
        const packet = packets.shift();
        const result = await bridge.invoke({ op: 'write', value: packet });
        if (packet.stream === stream && !result.ok) { fail(result.error); break; }
      }
    } catch { fail(); }
    finally { sending = false; }
  }
  async function ensureGraph() {
    if (graph) return graph;
    graph = (async () => {
      context = new AudioContextClass({ sampleRate: 48000 });
      await context.audioWorklet.addModule('/js/playback/features/output-worklet.js');
      if (disposed) return;
      node = new WorkletNodeClass(context, 'lira-playback-output', { outputChannelCount: [2], channelCount: 2 });
      node.port.onmessage = ({ data }) => {
        if (!stream || data.stream !== stream || disposed) return;
        if (packets.length >= 4) { fail('音频发送拥堵，播放已暂停，请重新选择输出设备。'); return; }
        packets.push(data);
        void sendPackets();
      };
      node.onprocessorerror = () => fail();
      source = context.createMediaElementSource(audio);
      source.connect(node);
      node.connect(context.destination);
      route();
    })();
    try { await graph; }
    catch (error) {
      if (!source) { await context?.close(); context = null; graph = null; }
      throw error;
    }
  }
  async function start() {
    if (!selectedId || stream || disposed) return;
    if (opening) return opening;
    const request = epoch;
    opening = (async () => {
      await ensureGraph();
      if (request !== epoch || disposed) return;
      await context.setSinkId('');
      if (request !== epoch || disposed) return;
      await context.resume();
      if (request !== epoch || disposed) return;
      const result = await bridge.invoke({ op: 'open', value: { deviceId: selectedId } });
      if (request !== epoch || disposed) return;
      if (!result.ok) throw new Error(result.error);
      stream = result.data.stream;
      route();
    })();
    try { await opening; }
    finally { if (request === epoch) opening = null; }
  }
  function stop() {
    clearTimeout(endTimer);
    const active = stream || opening;
    invalidate();
    if (selectedId && active) void bridge.invoke({ op: 'stop' });
  }
  const events = {
    playing() {
      naturallyEnded = false;
      clearTimeout(endTimer);
      if (selectedId) void start().catch(error => fail(error.message));
    },
    pause() { if (!audio.ended) stop(); },
    seeking() { stop(); },
    seeked() { if (!audio.paused && selectedId) void start().catch(error => fail(error.message)); },
    emptied() { if (!naturallyEnded) stop(); },
    ended() {
      naturallyEnded = true;
      // Let already decoded samples drain; an automatically queued next song keeps the stream.
      endTimer = setTimeout(() => { if (audio.paused) stop(); }, 300);
    },
  };
  for (const [name, listener] of Object.entries(events)) audio.addEventListener(name, listener);
  const unsubscribe = bridge.onFault(fault => { if (fault.stream === stream) fail(fault.error); });

  return {
    get currentId() { return selectedId && stream ? selectedId : ''; },
    async enumerate() {
      const result = await bridge.invoke({ op: 'list' });
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    async select(deviceId) {
      stop();
      selectedId = deviceId;
      route();
      if (deviceId) {
        await start();
        if (audio.paused) stop();
      }
    },
    async browser(deviceId) {
      stop();
      selectedId = '';
      if (context && node) {
        await context.setSinkId(deviceId);
        route();
        await context.resume();
      } else await audio.setSinkId(deviceId);
    },
    async prepare() { if (selectedId) await start(); },
    dispose() {
      disposed = true;
      stop();
      unsubscribe();
      for (const [name, listener] of Object.entries(events)) audio.removeEventListener(name, listener);
      if (node) { node.port.onmessage = null; node.disconnect(); node.port.close(); }
      source?.disconnect();
      void context?.close();
    },
  };
}
