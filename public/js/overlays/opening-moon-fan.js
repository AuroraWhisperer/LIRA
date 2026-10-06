import { WIDTH, HEIGHT, createMoonMaterials, paintMoonFan } from './opening-moon-fan-art.js';
import { resolveComponentResource } from './component-resources.js';

const ASSET_ROOT = '/img/overlays/opening-moon-fan/';
const ASSET_FILES = Object.freeze({
  landscape: 'landscape', fan: 'fan', title: 'title', silk: 'silk',
  flowersNw: 'flowers-nw', flowersNe: 'flowers-ne',
  flowersSw: 'flowers-sw', flowersSe: 'flowers-se',
  craneBody: 'crane-body', craneNear: 'crane-wing-near', craneFar: 'crane-wing-far',
  jewelLeft: 'jewel-left',
});

async function loadMoonAssets() {
  const entries = await Promise.all(Object.entries(ASSET_FILES).map(async ([key, file]) => {
    const image = new Image();
    image.src = resolveComponentResource(`${ASSET_ROOT}${file}.webp`);
    await image.decode();
    return [key, image];
  }));
  return Object.fromEntries(entries);
}

function createMoonFanOpening(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let config = { active: false };
  let assets = null;
  let materials = null;
  let loading = false;
  let disposed = false;
  let failed = false;
  let request = null;
  let elapsed = 0;
  let previousTime = null;
  let lastPaint = -Infinity;

  const draw = () => {
    if (!assets || disposed) return;
    const width = config.quality === 'low' ? 1280 : WIDTH;
    if (canvas.width !== width) {
      canvas.width = width;
      canvas.height = width * HEIGHT / WIDTH;
    }
    ctx.setTransform(width / WIDTH, 0, 0, width / WIDTH, 0, 0);
    paintMoonFan(ctx, assets, materials, elapsed / 1000, config);
  };
  const stop = () => {
    if (request !== null) cancelAnimationFrame(request);
    request = null;
    previousTime = null;
  };
  const tick = now => {
    request = null;
    if (disposed || !config.active || config.paused || config.reducedMotion || !assets) return;
    if (previousTime !== null) elapsed += Math.max(0, now - previousTime);
    previousTime = now;
    const interval = 1000 / (config.quality === 'high' ? 60 : config.quality === 'low' ? 20 : 30);
    if (now - lastPaint >= interval - 0.5) {
      draw();
      lastPaint = now;
    }
    request = requestAnimationFrame(tick);
  };
  const start = () => {
    if (disposed || !assets || !config.active || config.paused) return;
    if (config.reducedMotion) draw();
    else if (request === null) request = requestAnimationFrame(tick);
  };
  const prepare = async () => {
    if (loading || assets || failed || disposed) return;
    loading = true;
    canvas.dataset.ready = 'loading';
    try {
      const loaded = await loadMoonAssets();
      if (disposed) return;
      assets = loaded;
      materials = createMoonMaterials();
      canvas.dataset.ready = 'true';
      draw();
      start();
    } catch {
      if (disposed) return;
      failed = true;
      canvas.dataset.ready = 'error';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#f0f4fa';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#334765';
      ctx.font = '28px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('开播画面素材加载失败，请刷新重试', canvas.width / 2, canvas.height / 2);
      ctx.textAlign = 'start';
    } finally {
      loading = false;
    }
  };

  return {
    update(next) {
      if (disposed) return;
      const wasActive = config.active;
      config = next;
      if (!next.active) {
        stop();
        elapsed = 0;
        lastPaint = -Infinity;
        return;
      }
      if (!wasActive) {
        elapsed = 0;
        lastPaint = -Infinity;
      }
      canvas.setAttribute('aria-label', `${config.title ?? '月渡花汀'}，${config.subtitle ?? '直播即将开始'}`);
      if (next.paused || next.reducedMotion) stop();
      void prepare();
      draw();
      start();
    },
    dispose() {
      disposed = true;
      stop();
      assets = materials = null;
    },
  };
}

export { ASSET_FILES, loadMoonAssets, createMoonFanOpening };
