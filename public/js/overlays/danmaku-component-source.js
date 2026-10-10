import { applyCanvas } from './danmaku-canvas.js';
import { createSceneDanmakuDisplay } from './scene-danmaku-display.js';
import { watchComponentOutputSize } from './component-output-size.js';
import { createDisplaySource } from './display-source.js';

export function initDanmakuComponentSource({ configure, clear, append, remove, status, getStyle, showEntryMessages, dispose }) {
  const host = document.getElementById('danmakuCanvasHost');
  const display = createSceneDanmakuDisplay({ clear, append, remove, status, getStyle, showEntryMessages });
  let configuration = null;
  let configKey = '';
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
  const source = createDisplaySource({
    outputPath: '/api/danmaku/display', eventsPath: '/api/danmaku/events',
    token: window.__API_TOKEN__, query: () => new URLSearchParams(),
    getCursor: (output) => output.data,
    renderer: {
      update({ config, data }) {
        const nextKey = JSON.stringify(config);
        if (nextKey !== configKey) {
          configKey = nextKey;
          configuration = config;
          clear();
          if (config) { configure(config); fit(); }
        }
        display.update(data);
      },
      revoke() { configuration = null; configKey = ''; },
      disconnect() { display.update({ status: 'offline', epoch: null, reset: true, events: [] }); },
    },
  });
  window.addEventListener('pagehide', () => {
    source.dispose();
    observer.disconnect();
    stopOutputSize();
    dispose();
  }, { once: true });
  status('等待直播数据', false);
  source.start();
}
