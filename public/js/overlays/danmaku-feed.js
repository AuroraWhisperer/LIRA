/* global document */
import { componentEffectBounds } from './component-effect-filters.js';
import { createFloatingDanmakuFeed } from './danmaku-floating.js';
import { FULLSCREEN_SAFE_INSET_PX, findRandomDanmakuPosition } from './danmaku-random-position.js';
import {
  DEFAULT_DANMAKU_CLASSES,
  createDanmakuMessageRenderer,
  measureDanmakuText,
} from './danmaku-message-renderer.js';

export { measureDanmakuText };

const DEFAULT_MAX_ITEMS = 120;
const DEFAULT_OFFSCREEN_VIEWPORTS = 5;
const DANMAKU_ITEM_SPACING_PX = 11;
const FULLSCREEN_LAYOUT = 'fullscreen-random';
const FADE_DURATION_MS = 400;
// Fixed-feed moves take 420ms plus the travel in px (about 520ms for a moonlit chat row), capped.
const LAYOUT_MOVE_BASE_MS = 420;
const LAYOUT_MOVE_MAX_MS = 760;
// cubic-bezier control points: a short ramp-up instead of starting at peak speed.
const LAYOUT_MOVE_CURVE = Object.freeze([0.3, 0.1, 0.2, 1]);

/**
 * Build a reusable live-message feed. The game owns data and lifecycle while
 * this component owns message timing, layout, and removal.
 *
 * @param {HTMLElement} root
 * @param {{maxItems?: number, offscreenViewports?: number, autoScroll?: boolean, layout?: string, showAvatar?: boolean, showGiftTotal?: boolean, itemLifetimeMs?: number, expireItems?: boolean, now?: Function, scheduleTimeout?: Function, cancelTimeout?: Function, resolveAvatarUrl?: Function, resolveEmoteUrl?: Function, getGuardLabel?: Function, classNames?: object}} options
 * @returns {{render: Function, append: Function, destroy: Function}}
 */
export function createDanmakuFeed(root, options = {}) {
  if (options.layout === 'floating') return createFloatingDanmakuFeed(root, options);
  if (!root || typeof root.replaceChildren !== 'function') {
    throw new TypeError('弹幕组件需要一个可渲染的根节点。');
  }
  const maxItems = Math.max(1, Math.trunc(Number(options.maxItems)) || DEFAULT_MAX_ITEMS);
  const requestedOffscreenViewports = Number(options.offscreenViewports);
  const offscreenViewports =
    Number.isFinite(requestedOffscreenViewports) || requestedOffscreenViewports === Number.POSITIVE_INFINITY
      ? Math.max(0, requestedOffscreenViewports)
      : DEFAULT_OFFSCREEN_VIEWPORTS;
  const classNames = {
    ...DEFAULT_DANMAKU_CLASSES,
    ...(options.classNames || {}),
  };
  const autoScroll = options.autoScroll !== false;
  const fullscreen = options.layout === FULLSCREEN_LAYOUT;
  const createBubble = createDanmakuMessageRenderer({
    document,
    classNames,
    fullscreen,
    style: options.style,
    showAvatar: options.showAvatar,
    showGiftTotal: options.showGiftTotal,
    resolveAvatarUrl: options.resolveAvatarUrl,
    resolveEmoteUrl: options.resolveEmoteUrl,
    resolveGiftImageUrl: options.resolveGiftImageUrl,
    getGuardLabel: options.getGuardLabel,
  });
  const fitViewport = !fullscreen && offscreenViewports === 0;
  const smoothLayout = fitViewport && typeof root.animate === 'function';
  if (smoothLayout) root.dataset.smoothLayout = 'true';
  const requestedLifetime = Number(options.itemLifetimeMs);
  const itemLifetimeMs = Number.isFinite(requestedLifetime) && requestedLifetime > 0 ? requestedLifetime : 0;
  const expireItems = options.expireItems !== false;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const scheduleTimeout =
    typeof options.scheduleTimeout === 'function'
      ? options.scheduleTimeout
      : (callback, delay) =>
          typeof globalThis.setTimeout === 'function' ? globalThis.setTimeout(callback, delay) : null;
  const cancelTimeout =
    typeof options.cancelTimeout === 'function'
      ? options.cancelTimeout
      : (timer) => {
          if (typeof globalThis.clearTimeout === 'function') globalThis.clearTimeout(timer);
        };
  let renderedSequence = 0;
  let viewportHeight = 0;
  let renderedContentHeight = 0;
  let renderedEntries = [];
  let lastFullscreenPosition = null;
  let randomPlacement = { centerBias: options.centerBias, dispersion: options.dispersion };
  let layoutFrame = null;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          updateViewportHeight();
          if (smoothLayout) {
            if (layoutFrame !== null) globalThis.cancelAnimationFrame?.(layoutFrame);
            layoutFrame = null;
            updateLayout();
          } else if (fullscreen || fitViewport) scheduleLayout();
          else pruneOldMessages();
        })
      : null;
  resizeObserver?.observe(root);
  root.ownerDocument?.defaultView?.addEventListener('lira:effects-updated', scheduleLayout);
  reducedMotion?.addEventListener?.('change', finishMotion);

  function cancelAnimations(entry) {
    entry.fade?.cancel();
    entry.fade = null;
    if (entry.motion) {
      entry.motion.onfinish = null;
      entry.motion.cancel();
      entry.motion = null;
    }
  }

  function finishMotion() {
    if (reducedMotion?.matches) {
      renderedEntries.forEach(cancelAnimations);
      if (smoothLayout) scheduleLayout();
    }
  }

  function render(items) {
    const showingEmptyState = root.children.length === 1 && root.children[0].className === classNames.empty;
    clearExpirationTimers();
    renderedEntries.forEach(({ node }) => resizeObserver?.unobserve?.(node));
    updateViewportHeight();
    root.replaceChildren();
    renderedContentHeight = 0;
    renderedEntries = [];
    lastFullscreenPosition = null;
    const messages = selectMessages(items, showingEmptyState);
    renderedSequence = messages.length;
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = classNames.empty;
      empty.textContent = '等待直播消息…';
      root.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    messages.forEach((item, index) => {
      const node = createBubble(item, index);
      const height = estimateItemHeight(item);
      fragment.append(node);
      renderedEntries.push({ node, height, item, timer: null });
      renderedContentHeight += height;
    });
    root.append(fragment);
    if (fullscreen || fitViewport) renderedEntries.forEach(({ node }) => resizeObserver?.observe(node));
    if (fullscreen) {
      [...renderedEntries].forEach(scheduleExpiration);
    }
    if (fullscreen || fitViewport) scheduleLayout();
    scrollToLatest();
  }

  function append(item) {
    if (fullscreen && item?.kind === 'superchat') return;
    if (root.children.length === 1 && root.children[0].className === classNames.empty) {
      root.replaceChildren();
    }
    const node = createBubble(item, renderedSequence);
    const height = estimateItemHeight(item);
    root.append(node);
    const entry = { node, height, item, timer: null, entering: smoothLayout };
    renderedEntries.push(entry);
    renderedContentHeight += height;
    renderedSequence += 1;
    if (fullscreen || fitViewport) resizeObserver?.observe(node);
    if (fullscreen) {
      scheduleExpiration(entry);
      pruneMaxItems();
    } else if (!fitViewport) pruneOldMessages();
    if (fullscreen || fitViewport) scheduleLayout();
    scrollToLatest();
  }

  function updateViewportHeight() {
    const nextHeight = Number(root.clientHeight);
    if (Number.isFinite(nextHeight) && nextHeight > 0) viewportHeight = nextHeight;
  }

  function scheduleLayout() {
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      updateLayout();
      return;
    }
    if (layoutFrame !== null) return;
    layoutFrame = globalThis.requestAnimationFrame(() => {
      layoutFrame = null;
      updateLayout();
    });
  }

  function updateLayout() {
    updateViewportHeight();
    if (fullscreen) {
      repositionFullscreenItems();
      return;
    }
    const styles = globalThis.getComputedStyle?.(root);
    const gap = Number.parseFloat(styles?.rowGap) || 0;
    const padding = (Number.parseFloat(styles?.paddingTop) || 0) + (Number.parseFloat(styles?.paddingBottom) || 0);
    if (viewportHeight > padding) renderedEntries.forEach((entry) => fitItem(entry, root.clientWidth, viewportHeight - padding));
    renderedContentHeight = renderedEntries.reduce((total, entry) => {
      const zoom = Number.parseFloat(globalThis.getComputedStyle?.(entry.node)?.zoom) || 1;
      const measured = componentEffectBounds(entry.node, entry.node.offsetWidth, entry.node.offsetHeight).height * zoom;
      entry.height = measured > 0 ? measured : estimateItemHeight(entry.item);
      return total + entry.height;
    }, 0);
    if (smoothLayout) animateFixedLayout(gap, styles?.flexDirection === 'column-reverse' ? -1 : 1);
    // Moving messages can still be visible even when their destination is clipped.
    // Keep them until the move finishes; the item limit still bounds a busy feed.
    // Layout heights ignore entrance transforms and work in either scroll direction.
    while (
      renderedEntries.length > 1 &&
      (renderedEntries.length > maxItems ||
        (!renderedEntries[0].motion && viewportHeight > 0 && renderedContentHeight - renderedEntries[0].height +
          gap * (renderedEntries.length - 1) + padding >= viewportHeight))
    ) {
      removeEntry(renderedEntries[0]);
    }
  }

  function animateFixedLayout(gap, direction) {
    // Relative positioning keeps the font rasterization stable during movement.
    // Read before writing and continue from the visible offset on interrupted moves.
    let previousOffset;
    const positions = renderedEntries.map((entry) => {
      const styles = globalThis.getComputedStyle?.(entry.node);
      const zoom = Number.parseFloat(styles?.zoom) || 1;
      const offset = Number.parseFloat(styles?.top) || 0;
      const rect = entry.node.getBoundingClientRect();
      const scale = rect.width / entry.node.offsetWidth || 1;
      const top = rect.top - offset * scale;
      const dy = entry.entering
        ? (previousOffset ?? direction * (entry.height + gap) * scale / zoom) / scale
        : ((entry.top ?? top) - top) / scale;
      const from = entry.entering ? dy : dy + offset;
      previousOffset = from * scale;
      return { entry, top, dy, from };
    });
    // One duration and curve per pass keeps rows in step; taller arrivals glide a little longer.
    const distance = Math.max(0, ...positions.map(({ from }) => Math.abs(from)));
    const duration = Math.round(Math.min(LAYOUT_MOVE_MAX_MS, LAYOUT_MOVE_BASE_MS + distance));
    // An arrival during a move starts the new curve at the current speed instead of jolting the rows.
    const running = renderedEntries.find((entry) => entry.motion && entry.move);
    const reference = positions.find(({ dy }) => Math.abs(dy) >= 0.01)?.from;
    const [x1, y1, x2, y2] = LAYOUT_MOVE_CURVE;
    let startY = y1;
    if (running && reference) {
      const { from: runningFrom, duration: runningDuration, curve } = running.move;
      const elapsed = Math.min(1, (Number(running.motion.currentTime) || 0) / runningDuration);
      const speed = runningFrom * curveSlope(curve, elapsed) / runningDuration;
      startY = Math.min(1, Math.max(y1, speed * duration / reference * x1));
    }
    const curve = [x1, startY, x2, y2];
    const easing = `cubic-bezier(${curve.map((value) => Number(value.toFixed(4))).join(', ')})`;
    for (const { entry, top, dy, from } of positions) {
      entry.top = top;
      entry.entering = false;
      if (Math.abs(dy) < 0.01) continue;
      cancelAnimations(entry);
      if (reducedMotion?.matches || typeof entry.node.animate !== 'function') continue;
      const motion = entry.node.animate([
        { top: `${from}px` },
        { top: '0px' },
      ], { duration, easing });
      entry.motion = motion;
      entry.move = { from, duration, curve };
      motion.onfinish = () => {
        motion.cancel();
        if (entry.motion === motion) entry.motion = null;
        scheduleLayout();
      };
    }
  }

  function fitItem(entry, availableWidth, availableHeight) {
    const node = entry.node;
    node.style.setProperty('width', '');
    node.style.setProperty('zoom', '');
    const zoom = Number.parseFloat(globalThis.getComputedStyle?.(node)?.zoom) || 1;
    const width = Number(node.offsetWidth) || 0;
    const height = Number(node.offsetHeight) || 0;
    const bounds = componentEffectBounds(node, width, height);
    // Computed zoom is rounded; an exact fit can appear a fraction of a pixel wider.
    const scale = Math.min(
      1,
      bounds.width * zoom > availableWidth + 0.01 && availableWidth > 0 ? (availableWidth - 1) / (bounds.width * zoom) : 1,
      bounds.height * zoom > availableHeight && availableHeight > 0 ? (availableHeight - 1) / (bounds.height * zoom) : 1,
    );
    if (scale < 1) {
      // Freeze the natural line breaks before zoom changes the containing width.
      node.style.setProperty('width', `${width}px`);
      node.style.setProperty('zoom', String(zoom * scale));
    }
    if (!fullscreen && (bounds.x || bounds.y || bounds.height !== height)) {
      entry.effectLayout ||= ['margin-top', 'margin-bottom', 'translate'].map(key => [key, node.style.getPropertyValue(key)]);
      node.style.setProperty('margin-top', -bounds.y + 'px');
      node.style.setProperty('margin-bottom', (bounds.height + bounds.y - height) + 'px');
      node.style.setProperty('translate', -bounds.x + 'px 0px');
    } else if (entry.effectLayout) {
      for (const [key, value] of entry.effectLayout) node.style.setProperty(key, value);
      entry.effectLayout = null;
    }
    return { width: bounds.width * zoom * scale, height: bounds.height * zoom * scale,
      x: bounds.x, y: bounds.y, zoom: zoom * scale };
  }

  function pruneOldMessages() {
    const maxContentHeight = viewportHeight > 0 ? viewportHeight * (offscreenViewports + 1) : Number.POSITIVE_INFINITY;
    while (
      renderedEntries.length > 1 &&
      (renderedEntries.length > maxItems || renderedContentHeight > maxContentHeight)
    ) {
      removeEntry(renderedEntries[0]);
    }
  }

  function pruneMaxItems() {
    while (renderedEntries.length > maxItems) removeEntry(renderedEntries[0]);
  }

  function removeEntry(entry) {
    const index = renderedEntries.indexOf(entry);
    if (index < 0) return false;
    if (entry.timer !== null) {
      cancelTimeout(entry.timer);
      entry.timer = null;
    }
    renderedEntries.splice(index, 1);
    cancelAnimations(entry);
    resizeObserver?.unobserve?.(entry.node);
    renderedContentHeight = Math.max(0, renderedContentHeight - entry.height);
    if (entry.node.parentNode === root || Array.from(root.children || []).includes(entry.node)) {
      root.removeChild(entry.node);
    }
    return true;
  }

  function clearExpirationTimers() {
    renderedEntries.forEach((entry) => {
      if (entry.timer !== null) cancelTimeout(entry.timer);
      entry.timer = null;
      cancelAnimations(entry);
    });
  }

  function scheduleExpiration(entry) {
    if (!fullscreen || !expireItems || !itemLifetimeMs) return;
    const currentTime = Number(now());
    const itemTimestamp = Number(entry.item?.timestamp);
    const timestamp = Number.isFinite(itemTimestamp) && itemTimestamp > 0 ? itemTimestamp : currentTime;
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const remaining = timestamp + itemLifetimeMs - currentTime;
    if (!Number.isFinite(remaining) || remaining <= 0) {
      removeEntry(entry);
      return;
    }
    const expire = () => {
      entry.timer = null;
      removeEntry(entry);
    };
    if (reducedMotion?.matches || typeof entry.node.animate !== 'function') {
      entry.timer = scheduleTimeout(expire, remaining);
      return;
    }
    entry.timer = scheduleTimeout(() => {
      const fadeMs = Math.max(0, timestamp + itemLifetimeMs - Number(now()));
      if (!fadeMs) return expire();
      if (!reducedMotion?.matches) {
        entry.fade = entry.node.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: fadeMs,
          easing: 'cubic-bezier(0.4, 0, 1, 1)',
          fill: 'forwards',
        });
      }
      entry.timer = scheduleTimeout(expire, fadeMs);
    }, Math.max(0, remaining - FADE_DURATION_MS));
  }

  function repositionFullscreenItems() {
    if (!fullscreen) return;
    const width = Number(root.clientWidth) || 0;
    const height = Number(root.clientHeight) || 0;
    if (width <= 0 || height <= 0) return;
    const occupied = [];
    const measured = renderedEntries.map((entry) => ({
      entry,
      ...fitItem(entry, width - FULLSCREEN_SAFE_INSET_PX * 2, height - FULLSCREEN_SAFE_INSET_PX * 2),
    }));
    for (const item of measured) {
      if (item.width > width - FULLSCREEN_SAFE_INSET_PX * 2 || item.height > height - FULLSCREEN_SAFE_INSET_PX * 2) {
        removeEntry(item.entry);
        continue;
      }
      if (!item.entry.center) item.entry.previousPosition = lastFullscreenPosition;
      let position = findRandomDanmakuPosition(item, width, height, occupied, randomPlacement);
      while (!position && occupied.length) {
        removeEntry(occupied.shift().entry);
        position = findRandomDanmakuPosition(item, width, height, occupied, randomPlacement);
      }
      if (!position) {
        removeEntry(item.entry);
        continue;
      }
      if (!item.entry.center) {
        item.entry.center = {};
        lastFullscreenPosition = item.entry.center;
      }
      Object.assign(item.entry.center, { x: position.left + item.width / 2, y: position.top + item.height / 2 });
      item.entry.position = position;
      item.entry.node.style.setProperty('left', `${position.left / item.zoom - item.x}px`);
      item.entry.node.style.setProperty('top', `${position.top / item.zoom - item.y}px`);
      item.entry.node.style.setProperty('visibility', 'visible');
      occupied.push({ ...item, ...position });
    }
  }

  function scrollToLatest() {
    if (autoScroll) root.scrollTop = root.scrollHeight;
  }

  function selectMessages(items, bypassViewportPruning = false) {
    const bounded = Array.isArray(items)
      ? items.filter((item) => !fullscreen || item?.kind !== 'superchat').slice(-maxItems) : [];
    if (fullscreen || fitViewport || bypassViewportPruning || viewportHeight <= 0 || bounded.length <= 1)
      return bounded;

    // Keep the visible viewport plus the configured buffer above it. The
    // estimate avoids creating DOM nodes that are guaranteed to be discarded.
    const maxContentHeight = viewportHeight * (offscreenViewports + 1);
    let contentHeight = 0;
    const retained = [];
    for (let index = bounded.length - 1; index >= 0; index -= 1) {
      const itemHeight = estimateItemHeight(bounded[index]);
      if (retained.length && contentHeight + itemHeight > maxContentHeight) break;
      retained.unshift(bounded[index]);
      contentHeight += itemHeight;
    }
    return retained;
  }

  function estimateItemHeight(item) {
    return measureDanmakuText(item?.message).height + DANMAKU_ITEM_SPACING_PX;
  }

  return {
    render,
    append,
    setRandomPlacement(value) {
      randomPlacement = { centerBias: value.centerBias, dispersion: value.dispersion };
    },
    destroy() {
      if (layoutFrame !== null) globalThis.cancelAnimationFrame?.(layoutFrame);
      layoutFrame = null;
      resizeObserver?.disconnect();
      root.ownerDocument?.defaultView?.removeEventListener('lira:effects-updated', scheduleLayout);
      reducedMotion?.removeEventListener?.('change', finishMotion);
      clearExpirationTimers();
      if (smoothLayout) delete root.dataset.smoothLayout;
      renderedSequence = 0;
      viewportHeight = 0;
      renderedContentHeight = 0;
      renderedEntries = [];
      lastFullscreenPosition = null;
      root.replaceChildren();
    },
  };
}

// Slope of a cubic-bezier easing (progress per unit time) at normalized time `time`.
function curveSlope([x1, y1, x2, y2], time) {
  const point = (a, b, u) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  const slope = (a, b, u) => 3 * a * (1 - u) ** 2 + 6 * (b - a) * u * (1 - u) + 3 * (1 - b) * u * u;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (point(x1, x2, middle) < time) low = middle;
    else high = middle;
  }
  const u = (low + high) / 2;
  const dx = slope(x1, x2, u);
  return dx > 1e-6 ? slope(y1, y2, u) / dx : 0;
}
