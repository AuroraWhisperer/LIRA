import { BANNER_HEIGHT, BANNER_GAP, createGiftBanner, fitGiftBannerNames, loadGiftArtworkCatalog } from '../shared/gift-banner.js';
import { createGiftFeedState, giftFeedRowDurationMs, scanTodayGifts, shanghaiToday } from '../shared/gift-feed-state.js';
import { createOverlaySocket } from './socket-client.js';
import { buildGiftCards } from '../shared/gift-card-model.js';

const state = createGiftFeedState();
const stage = document.getElementById('giftFeedStage');
const viewport = document.getElementById('giftFeedViewport');
const status = document.getElementById('giftFeedStatus');
const preview = new URLSearchParams(location.search).get('preview') === '1';
document.body.classList.toggle('gift-feed-preview', preview);
status.hidden = !preview;
let config = { thresholds: [3000, 10000, 100000], visibleRows: 3, scrollSpeed: 25 };
let catalog = [];
let catalogVersion = 0;
let rendered = new Map();
let day = shanghaiToday();
let revision = null;
let pending = null;
let scanning = false;
let dirty = false;
let disposed = false;
let generation = 0;
let controller = null;
let refreshTimer;
let frame = null;
let previousTime = null;
let progress = 0;

async function request(url, signal) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || '本日礼物暂未更新'), { code: result.code });
  return result.data;
}

function render() {
  viewport.style.height = `${config.visibleRows * BANNER_HEIGHT + (config.visibleRows - 1) * BANNER_GAP}px`;
  const next = new Map();
  const added = [];
  for (const [index, item] of state.visible(config.visibleRows, true).entries()) {
    const signature = JSON.stringify([item, config.thresholds, catalogVersion]);
    let row = rendered.get(item.eventId);
    if (row?.signature !== signature) {
      row = { signature, node: createGiftBanner(item, config, catalog) };
      added.push(row.node);
    }
    next.set(item.eventId, row);
    if (stage.children[index] !== row.node) stage.insertBefore(row.node, stage.children[index] || null);
  }
  for (const [id, row] of rendered) {
    if (next.get(id)?.node !== row.node) row.node.remove();
  }
  rendered = next;
  for (const node of added) fitGiftBannerNames(node);
  const scrolling = state.count > config.visibleRows;
  stage.style.willChange = scrolling ? 'transform' : '';
  if (!scrolling) {
    stopScrolling();
    progress = 0;
    stage.style.transform = 'translateY(0)';
  } else if (frame === null && !disposed && !document.hidden) {
    frame = requestAnimationFrame(advance);
  }
}

function stopScrolling() {
  cancelAnimationFrame(frame);
  frame = null;
  previousTime = null;
}

function reset() {
  generation += 1;
  controller?.abort();
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
    if (JSON.stringify(catalog) !== JSON.stringify(nextCatalog)) catalogVersion += 1;
    catalog = nextCatalog;
    render(); // Saved colors also update a single static row.
    const result = await scanTodayGifts({ request, signal: controller.signal, day,
      onRevision(next) {
        if (current !== generation) return;
        if (revision && revision !== next) { state.replace([]); pending = null; render(); }
        revision = next;
      } });
    if (current !== generation) return;
    const profiles = await request(`/api/gifts/card-profiles?${new URLSearchParams({ viewRevision: revision })}`, controller.signal);
    if (current !== generation) return;
    if (profiles.day !== day || profiles.viewRevision !== revision) {
      throw Object.assign(new Error('礼物来源或日期已变更'), { code: 'GIFT_VIEW_STALE' });
    }
    const cards = buildGiftCards(result.items, { day, profiles: profiles.items });
    pending = cards;
    if (state.count <= config.visibleRows || document.hidden) { state.replace(pending); pending = null; render(); }
    status.textContent = '';
  } catch (error) {
    if (current !== generation || disposed) return;
    if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) reset();
    status.textContent = `${error.message}；稍后自动重试。`;
  } finally {
    scanning = false;
    if (dirty) scheduleRefresh();
  }
}

function advance(time) {
  if (disposed || document.hidden) { stopScrolling(); return; }
  if (previousTime !== null) progress += (time - previousTime) / giftFeedRowDurationMs(config.scrollSpeed);
  previousTime = time;
  const steps = Math.floor(progress);
  if (steps > 0) {
    progress -= steps;
    state.advance(steps);
    if (pending) { state.replace(pending); pending = null; }
    render();
  }
  if (frame !== null) {
    stage.style.transform = `translate3d(0, -${progress * (BANNER_HEIGHT + BANNER_GAP)}px, 0)`;
    frame = requestAnimationFrame(advance);
  }
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
const reconcileTimer = setInterval(scheduleRefresh, 30000);
const dayTimer = setInterval(() => {
  const nextDay = shanghaiToday();
  if (day !== nextDay) { day = nextDay; reset(); scheduleRefresh(); }
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopScrolling();
  else { render(); scheduleRefresh(); }
});
window.addEventListener('pagehide', () => {
  disposed = true;
  reset();
  socket.dispose();
  clearInterval(dayTimer); clearInterval(reconcileTimer);
  clearTimeout(refreshTimer);
}, { once: true });
