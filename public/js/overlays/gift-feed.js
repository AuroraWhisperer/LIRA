import { createGiftBanner, loadGiftArtworkCatalog } from '../shared/gift-banner.js';
import { createGiftFeedState, scanTodayGifts, shanghaiToday } from '../shared/gift-feed-state.js';
import { createOverlaySocket } from './socket-client.js';

const state = createGiftFeedState();
const stage = document.getElementById('giftFeedStage');
const viewport = document.getElementById('giftFeedViewport');
const status = document.getElementById('giftFeedStatus');
const preview = new URLSearchParams(location.search).get('preview') === '1';
document.body.classList.toggle('gift-feed-preview', preview);
status.hidden = !preview;
let config = { thresholds: [10000, 50000, 100000], visibleRows: 3, intervalSeconds: 4, paused: false, lowPower: false };
let catalog = [];
let day = shanghaiToday();
let revision = null;
let pending = null;
let scanning = false;
let dirty = false;
let disposed = false;
let generation = 0;
let controller = null;
let refreshTimer;
let playTimer;
let animation;

async function request(url, signal) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || '本日礼物暂未更新'), { code: result.code });
  return result.data;
}

function render() {
  viewport.style.height = `${config.visibleRows * 96 + (config.visibleRows - 1) * 8}px`;
  stage.replaceChildren(...state.visible(config.visibleRows, !config.lowPower).map((item) => createGiftBanner(item, config, catalog)));
}

function reset() {
  generation += 1;
  controller?.abort();
  animation?.cancel();
  animation = null;
  pending = null;
  revision = null;
  state.replace([]);
  render();
}

function scheduleRefresh() {
  if (disposed) return;
  if (scanning) { dirty = true; return; }
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, 500);
}

async function refresh() {
  if (disposed || scanning) return;
  scanning = true;
  dirty = false;
  const current = generation;
  controller = new AbortController();
  try {
    const [nextConfig, nextCatalog] = await Promise.all([
      request('/api/gifts/display-settings', controller.signal),
      loadGiftArtworkCatalog(controller.signal).catch(() => catalog),
    ]);
    if (current !== generation) return;
    config = nextConfig;
    catalog = nextCatalog;
    animation?.cancel();
    animation = null;
    render(); // Saved colors also update a single static row.
    const result = await scanTodayGifts({ request, signal: controller.signal, day,
      onRevision(next) {
        if (current !== generation) return;
        if (revision && revision !== next) { state.replace([]); pending = null; render(); }
        revision = next;
      } });
    if (current !== generation) return;
    pending = result.items;
    if (state.count <= config.visibleRows || config.paused) { state.replace(pending); pending = null; render(); }
    status.textContent = `${day}（北京时间）· ${result.items.length ? `${result.items.length} 条${result.partial ? '已同步礼物，仍可能补齐' : '礼物'}` : '今天暂无礼物'}`;
  } catch (error) {
    if (current !== generation || disposed) return;
    if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) reset();
    status.textContent = `${error.message}；稍后自动重试。`;
  } finally {
    scanning = false;
    if (dirty) scheduleRefresh();
  }
}

async function advance() {
  try {
    if (!config.paused && state.count > config.visibleRows) {
      if (!config.lowPower) {
        animation = stage.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-104px)' }], { duration: 400, easing: 'ease-in-out' });
        await animation.finished.catch(() => {});
        if (!animation || disposed) return;
        animation = null;
      }
      state.advance(config.lowPower ? config.visibleRows : 1);
    }
    if (pending) { state.replace(pending); pending = null; }
    render();
  } finally { if (!disposed) playTimer = setTimeout(advance, config.intervalSeconds * 1000); }
}

const socket = createOverlaySocket({
  onOpen: scheduleRefresh,
  onMessage(payload) {
    if (payload.type !== 'snapshot' && payload.type !== 'gift-catalog:update') return;
    const next = payload.state?.gifts?.viewRevision;
    const sourceChanged = next !== undefined && next !== revision;
    if (sourceChanged) reset();
    if (sourceChanged || payload.type === 'gift-catalog:update' || /gift|settings|connect/.test(payload.reason || '')) scheduleRefresh();
  },
});
socket.start();
scheduleRefresh();
playTimer = setTimeout(advance, config.intervalSeconds * 1000);
const reconcileTimer = setInterval(scheduleRefresh, 30000);
const dayTimer = setInterval(() => {
  const nextDay = shanghaiToday();
  if (day !== nextDay) { day = nextDay; reset(); scheduleRefresh(); }
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRefresh(); });
window.addEventListener('pagehide', () => {
  disposed = true;
  reset();
  socket.dispose();
  clearInterval(dayTimer); clearInterval(reconcileTimer);
  clearTimeout(refreshTimer); clearTimeout(playTimer);
}, { once: true });
