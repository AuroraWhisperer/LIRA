import { applyCanvas } from './danmaku-canvas.js';
import { createSceneDanmakuDisplay } from './scene-danmaku-display.js';
import { watchComponentOutputSize } from './component-output-size.js';

export function initDanmakuComponentSource({ configure, clear, append, status, getStyle, dispose }) {
  const host = document.getElementById('danmakuCanvasHost');
  const display = createSceneDanmakuDisplay({ clear, append, status, getStyle });
  let configuration = null;
  let configKey = '';
  let epoch = '';
  let cursor = 0;
  let stopped = false;
  let timer;
  let request;
  let outputSize = null;
  const fit = () => {
    if (!configuration) return;
    const { layout, style } = configuration;
    const outputLayout = outputSize ? { ...layout, canvas: outputSize,
      regions: { ...layout.regions, [style]: { x: 0, y: 0, ...outputSize } } } : layout;
    applyCanvas(document, outputLayout, style, host.clientWidth, host.clientHeight);
  };
  const stopOutputSize = watchComponentOutputSize('danmaku', (size) => { outputSize = size; fit(); });
  const observer = new ResizeObserver(fit);
  observer.observe(host);
  async function poll() {
    request = new AbortController();
    const timeout = setTimeout(() => request?.abort(), 8000);
    try {
      const query = new URLSearchParams({ epoch, cursor });
      const response = await fetch(`/api/danmaku/display?${query}`, {
        credentials: 'omit', cache: 'no-store', signal: request.signal,
        headers: { Authorization: `Bearer ${window.__API_TOKEN__}` },
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error('弹幕组件尚未就绪');
      if (stopped) return;
      const { config, data } = payload.data;
      const nextKey = JSON.stringify(config);
      if (nextKey !== configKey) {
        configKey = nextKey;
        configuration = config;
        clear();
        if (config) { configure(config); fit(); }
      }
      display.update(data);
      epoch = data.epoch;
      cursor = data.nextCursor;
    } catch {
      if (!stopped) display.update({ status: 'offline', epoch: null, reset: true, events: [] });
      epoch = '';
      cursor = 0;
    } finally {
      clearTimeout(timeout);
      request = null;
      if (!stopped) timer = setTimeout(poll, 750);
    }
  }
  window.addEventListener('pagehide', () => {
    stopped = true;
    clearTimeout(timer);
    request?.abort();
    observer.disconnect();
    stopOutputSize();
    dispose();
  }, { once: true });
  status('等待直播数据', false);
  void poll();
}
