import {
  BANNER_HEIGHT,
  BANNER_GAP,
  createGiftBanner,
  updateGiftBanner,
  fitGiftBannerNames,
  loadGiftArtworkCatalog,
} from '../shared/gift-banner.js';
import {
  createGiftFeedState,
  giftFeedRowDurationMs,
  scanTodayGifts,
  shanghaiToday,
} from '../shared/gift-feed-state.js';
import { createOverlaySocket } from './socket-client.js';
import { buildGiftCards } from '../shared/gift-card-model.js';

const state = createGiftFeedState();
const stage = document.getElementById('giftFeedStage');
const viewport = document.getElementById('giftFeedViewport');
const status = document.getElementById('giftFeedStatus');
const preview = new URLSearchParams(location.search).get('preview') === '1';
document.body.classList.toggle('gift-feed-preview', preview);
status.hidden = !preview;
let config = { thresholds: [3000, 10000, 100000], visibleRows: 3, scrollSpeed: 25, minGiftAmountCents: 0 };
let catalog = [];
let catalogVersion = 0;
let rendered = new Map();
let day = shanghaiToday();
let revision = null;
let pending = null;
let scanning = false;
let dirty = false;
let settingsDirty = true;
let catalogDirty = true;
let disposed = false;
let generation = 0;
let controller = null;
let refreshTimer;
let frame = null;
let previousTime = null;
let progress = 0;

async function request(url, signal) {
  // Browser sources may use a Chromium version without AbortSignal.any/timeout.
  const requestController = new AbortController();
  const abort = () => requestController.abort();
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 10000);
  try {
    const response = await fetch(url, { signal: requestController.signal });
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw Object.assign(new Error(result.error || '本日礼物暂未更新'), { code: result.code });
    return result.data;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

function render(retryAvatars = false) {
  const height = `${config.visibleRows * BANNER_HEIGHT + (config.visibleRows - 1) * BANNER_GAP}px`;
  if (viewport.style.height !== height) viewport.style.height = height;
  const next = new Map();
  const fit = [];
  for (const item of state.visible(config.visibleRows, true)) {
    const signature = JSON.stringify([item, config.thresholds, catalogVersion]);
    let row = rendered.get(item.eventId);
    const avatar = retryAvatars ? row?.node.querySelector('.gift-banner-avatar') : null;
    const retryAvatar = Boolean(avatar && item.gift.avatarUrl && avatar.getAttribute('src') !== avatar.dataset.source);
    if (!row) {
      row = { signature, node: createGiftBanner(item, config, catalog) };
      fit.push(row.node);
    } else if (row.signature !== signature || retryAvatar) {
      if (updateGiftBanner(row.node, item, config, catalog, retryAvatar)) fit.push(row.node);
      row.signature = signature;
    }
    next.set(item.eventId, row);
  }
  for (const [id, row] of rendered) {
    if (!next.has(id)) row.node.remove();
  }
  for (const [index, row] of [...next.values()].entries()) {
    if (stage.children[index] !== row.node) stage.insertBefore(row.node, stage.children[index] || null);
  }
  rendered = next;
  for (const node of fit) fitGiftBannerNames(node);
  const scrolling = state.count > config.visibleRows;
  const willChange = scrolling ? 'transform' : '';
  if (stage.style.willChange !== willChange) stage.style.willChange = willChange;
  if (!scrolling) {
    stopScrolling();
    progress = 0;
    if (stage.style.transform !== 'translateY(0)') stage.style.transform = 'translateY(0)';
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
  settingsDirty = true;
  catalogDirty = true;
  state.replace([]);
  render();
}

function scheduleRefresh({ settings = false, catalog = false } = {}) {
  if (disposed) return;
  settingsDirty ||= settings;
  catalogDirty ||= catalog;
  if (scanning) {
    dirty = true;
    return;
  }
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refresh();
  }, 500);
}

async function refresh() {
  if (disposed || scanning) return;
  scanning = true;
  dirty = false;
  const readSettings = settingsDirty;
  const readCatalog = catalogDirty;
  settingsDirty = false;
  catalogDirty = false;
  const current = generation;
  controller = new AbortController();
  try {
    const [nextConfig, nextCatalog] = await Promise.all([
      readSettings ? request('/api/gifts/display-settings', controller.signal) : config,
      readCatalog
        ? loadGiftArtworkCatalog(controller.signal).catch(() => {
            catalogDirty = true;
            return catalog;
          })
        : catalog,
    ]);
    if (current !== generation) return;
    config = nextConfig;
    if (catalog !== nextCatalog && JSON.stringify(catalog) !== JSON.stringify(nextCatalog)) catalogVersion += 1;
    catalog = nextCatalog;
    render(true); // Refresh failed avatars as well as saved colors on static rows.
    const result = await scanTodayGifts({
      request,
      signal: controller.signal,
      day,
      onRevision(next) {
        if (current !== generation) return;
        if (revision && revision !== next) {
          state.replace([]);
          pending = null;
          render();
        }
        revision = next;
      },
    });
    if (current !== generation) return;
    const profiles = await request(
      `/api/gifts/card-profiles?${new URLSearchParams({ viewRevision: revision })}`,
      controller.signal,
    );
    if (current !== generation) return;
    if (profiles.day !== day || profiles.viewRevision !== revision) {
      throw Object.assign(new Error('礼物来源或日期已变更'), { code: 'GIFT_VIEW_STALE' });
    }
    const cards = buildGiftCards(result.items, { day, profiles: profiles.items });
    const minimumCents = BigInt(config.minGiftAmountCents ?? 0);
    pending =
      minimumCents === 0n
        ? cards
        : cards.filter((item) => {
            const totalCents =
              item.cardTotalCents === undefined
                ? BigInt(Math.round(item.gift.unitPrice * 100)) * BigInt(item.gift.num)
                : BigInt(item.cardTotalCents);
            return totalCents > minimumCents;
          });
    if (state.count <= config.visibleRows || document.hidden) {
      state.replace(pending);
      pending = null;
      render();
    }
    if (status.textContent) status.textContent = '';
  } catch (error) {
    if (current !== generation || disposed) return;
    settingsDirty ||= readSettings;
    catalogDirty ||= readCatalog;
    if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) reset();
    status.textContent = `${error.message}；稍后自动重试。`;
  } finally {
    scanning = false;
    if (dirty) scheduleRefresh();
  }
}

function advance(time) {
  if (disposed || document.hidden) {
    stopScrolling();
    return;
  }
  if (previousTime !== null) progress += (time - previousTime) / giftFeedRowDurationMs(config.scrollSpeed);
  previousTime = time;
  const steps = Math.floor(progress);
  if (steps > 0) {
    progress -= steps;
    state.advance(steps);
    if (pending) {
      state.replace(pending);
      pending = null;
    }
    render();
  }
  if (frame !== null) {
    stage.style.transform = `translate3d(0, -${progress * (BANNER_HEIGHT + BANNER_GAP)}px, 0)`;
    frame = requestAnimationFrame(advance);
  }
}

const socket = createOverlaySocket({
  onOpen: () => scheduleRefresh({ settings: true, catalog: true }),
  onMessage(payload) {
    if (payload.type !== 'snapshot' && payload.type !== 'gift-catalog:update') return;
    const next = payload.state?.gifts?.viewRevision;
    const sourceChanged = next !== undefined && next !== revision;
    if (sourceChanged) reset();
    const reason = payload.reason || '';
    if (sourceChanged || payload.type === 'gift-catalog:update' || /gift|settings|connect/.test(reason)) {
      scheduleRefresh({
        settings: sourceChanged || /settings|connect/.test(reason),
        catalog: sourceChanged || payload.type === 'gift-catalog:update' || /connect/.test(reason),
      });
    }
  },
});
socket.start();
scheduleRefresh();
const reconcileTimer = setInterval(() => scheduleRefresh({ settings: true, catalog: true }), 30000);
const dayTimer = setInterval(() => {
  const nextDay = shanghaiToday();
  if (day !== nextDay) {
    day = nextDay;
    reset();
    scheduleRefresh();
  }
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopScrolling();
  else {
    render();
    scheduleRefresh({ settings: true, catalog: true });
  }
});
window.addEventListener(
  'pagehide',
  () => {
    disposed = true;
    reset();
    socket.dispose();
    clearInterval(dayTimer);
    clearInterval(reconcileTimer);
    clearTimeout(refreshTimer);
  },
  { once: true },
);
