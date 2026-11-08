import { isHarborGiftVisible } from './danmaku-harbor.js';
/* global document */
import { componentEffectBounds } from './component-effect-filters.js';
import { createFloatingDanmakuFeed } from './danmaku-floating.js';
import { createSinkingDanmakuFeed } from './danmaku-sinking-feed.js';
import { FULLSCREEN_SAFE_INSET_PX, findRandomDanmakuPosition } from './danmaku-random-position.js';
import { DANMAKU_STYLE_OPTIONS } from '../shared/danmaku-style-options.js';
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
 * @returns {{render: Function, append: Function, remove: Function, destroy: Function}}
 */
export function createDanmakuFeed(root, options = {}) {
  if (options.style === 'sinking') return createSinkingDanmakuFeed(root, options);
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
  const horizontal = !fullscreen && (options.flowAxis === 'horizontal' || options.layout === 'horizontal');
  const axis = horizontal
    ? { size: 'width', clientSize: 'clientWidth', position: 'left', end: 'right', paddingStart: 'paddingLeft', paddingEnd: 'paddingRight', gap: 'columnGap', reverse: 'row-reverse' }
    : { size: 'height', clientSize: 'clientHeight', position: 'top', end: 'bottom', paddingStart: 'paddingTop', paddingEnd: 'paddingBottom', gap: 'rowGap', reverse: 'column-reverse' };
  const showSuperchat = !fullscreen || ['mist', 'comic', 'window', 'stardust'].includes(options.style)
    || DANMAKU_STYLE_OPTIONS[options.style]?.fullscreenSuperchat === true;
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
  const hasEntrance = smoothLayout && Boolean(globalThis.getComputedStyle?.(root)
    ?.getPropertyValue?.('--danmaku-enter-animation')?.trim());
  let expirationOptions = options;
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
  let viewportExtent = 0;
  let renderedContentExtent = 0;
  let layoutGap = 0;
  let layoutPadding = 0;
  let renderedEntries = [];
  let lastFullscreenPosition = null;
  let randomPlacement = { centerBias: options.centerBias, dispersion: options.dispersion, clearCenter: options.clearCenter };
  let layoutFrame = null;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          updateViewportExtent();
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
  if (hasEntrance) root.addEventListener?.('animationend', finishEntrance);

  function finishEntrance(event) {
    if (!event.pseudoElement && event.target?.parentNode === root) delete event.target.dataset.liveEntry;
  }

  function cancelAnimations(entry, keepFade = false) {
    if (!keepFade) {
      entry.fade?.cancel();
      if (entry.fade) entry.node.style.opacity = '';
      entry.fade = null;
    }
    if (entry.motion) {
      entry.motion.onfinish = null;
      entry.motion.cancel();
      entry.motion = null;
    }
  }

  function finishMotion() {
    if (reducedMotion?.matches) {
      renderedEntries.forEach(entry => cancelAnimations(entry));
      if (hasEntrance || fullscreen) renderedEntries.forEach((entry) => {
        delete entry.node.dataset.liveEntry;
        entry.live = false;
      });
      if (smoothLayout) scheduleLayout();
    }
  }

  function render(items) {
    const showingEmptyState = root.children.length === 1 && root.children[0].className === classNames.empty;
    clearExpirationTimers();
    renderedEntries.forEach(({ node }) => resizeObserver?.unobserve?.(node));
    updateViewportExtent();
    root.replaceChildren();
    renderedContentExtent = 0;
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
      const extent = estimateItemHeight(item);
      fragment.append(node);
      renderedEntries.push({ node, extent, item, timer: null });
      renderedContentExtent += extent;
    });
    root.append(fragment);
    if (fullscreen || fitViewport) renderedEntries.forEach(({ node }) => resizeObserver?.observe(node));
    if (fullscreen || options.expireFixedItems) {
      [...renderedEntries].forEach(scheduleExpiration);
    }
    if (fullscreen || fitViewport) scheduleLayout();
    scrollToLatest();
  }

  function append(item) {
    if (options.style === 'harbor' && !isHarborGiftVisible(item, options.minGiftAmount)) return;
    if (!showSuperchat && item?.kind === 'superchat') return;
    if (root.children.length === 1 && root.children[0].className === classNames.empty) {
      root.replaceChildren();
    }
    const live = hasEntrance && !reducedMotion?.matches;
    const node = createBubble(item, renderedSequence, { live, now: now() });
    const extent = estimateItemHeight(item);
    if (live) node.dataset.liveEntry = 'true';
    root.append(node);
    const entry = { node, extent, item, timer: null, entering: smoothLayout, live: fullscreen && !reducedMotion?.matches };
    renderedEntries.push(entry);
    renderedContentExtent += extent;
    renderedSequence += 1;
    if (fullscreen || fitViewport) resizeObserver?.observe(node);
    if (fullscreen) {
      scheduleExpiration(entry);
      pruneMaxItems();
    } else if (!fitViewport) pruneOldMessages();
    if (!fullscreen && options.expireFixedItems) scheduleExpiration(entry);
    if (fullscreen || fitViewport) scheduleLayout();
    scrollToLatest();
  }

  function remove(ids) {
    const removed = new Set(ids);
    const matches = renderedEntries.filter((entry) => removed.has(entry.item.id));
    for (const entry of matches) removeEntry(entry);
    if (matches.length && (fullscreen || fitViewport)) scheduleLayout();
  }

  function updateViewportExtent() {
    const nextHeight = Number(root[axis.clientSize]);
    if (Number.isFinite(nextHeight) && nextHeight > 0) viewportExtent = nextHeight;
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
    updateViewportExtent();
    if (fullscreen) {
      repositionFullscreenItems();
      return;
    }
    const styles = globalThis.getComputedStyle?.(root);
    const gap = Number.parseFloat(styles?.[axis.gap]) || 0;
    const padding = (Number.parseFloat(styles?.[axis.paddingStart]) || 0) + (Number.parseFloat(styles?.[axis.paddingEnd]) || 0);
    layoutGap = gap;
    layoutPadding = padding;
    if (viewportExtent > padding) renderedEntries.forEach((entry) => fitItem(entry,
      horizontal && options.fitWidth === false ? 0 : horizontal ? viewportExtent - padding : root.clientWidth,
      horizontal ? root.clientHeight - (Number.parseFloat(styles?.paddingTop) || 0) - (Number.parseFloat(styles?.paddingBottom) || 0) : viewportExtent - padding));
    renderedContentExtent = renderedEntries.reduce((total, entry) => {
      const zoom = Number.parseFloat(globalThis.getComputedStyle?.(entry.node)?.zoom) || 1;
      const measured = componentEffectBounds(entry.node, entry.node.offsetWidth, entry.node.offsetHeight)[axis.size] * zoom;
      entry.extent = measured > 0 ? measured : estimateItemHeight(entry.item);
      return total + entry.extent;
    }, 0);
    root.dataset.flowOverflow = String(renderedContentExtent + gap * Math.max(0, renderedEntries.length - 1) + padding > viewportExtent);
    if (smoothLayout) animateFixedLayout(gap, styles?.flexDirection === axis.reverse ? -1 : 1, styles);
    pruneFixedLayout();
  }

  function pruneFixedLayout() {
    // Moving messages can still be visible even when their destination is clipped.
    // Keep them until the move finishes; the item limit still bounds a busy feed.
    // Cached extents ignore entrance transforms and work in either flow axis/direction.
    while (
      renderedEntries.length > 1 &&
      (renderedEntries.length > maxItems ||
        (!renderedEntries[0].motion && viewportExtent > 0 && renderedContentExtent - renderedEntries[0].extent +
          layoutGap * (renderedEntries.length - 1) + layoutPadding >= viewportExtent))
    ) {
      removeEntry(renderedEntries[0]);
    }
  }

  function animateFixedLayout(gap, direction, feedStyles) {
    // Relative positioning keeps the font rasterization stable during movement.
    // Read before writing and continue from the visible offset on interrupted moves.
    const viewport = root.getBoundingClientRect();
    const viewportScale = viewportExtent > 0 ? viewport[axis.size] / viewportExtent : 1;
    const entryOffset = Number.parseFloat(feedStyles?.getPropertyValue('--danmaku-enter-offset'));
    let previousOffset;
    const positions = renderedEntries.map((entry) => {
      const styles = globalThis.getComputedStyle?.(entry.node);
      const zoom = Number.parseFloat(styles?.zoom) || 1;
      const offset = Number.parseFloat(styles?.[axis.position]) || 0;
      const rect = entry.node.getBoundingClientRect();
      // A left/top offset moves in feed coordinates, independently of rounded card widths or rotation.
      const scale = viewportScale * zoom || 1;
      const top = rect[axis.position] - offset * scale;
      const dy = entry.entering
        ? (previousOffset ?? (Number.isFinite(entryOffset) ? entryOffset * scale : direction * (entry.extent + gap) * scale / zoom)) / scale
        : ((entry.top ?? top) - top) / scale;
      const from = entry.entering ? dy : dy + offset;
      previousOffset = from * scale;
      const padding = Math.max(0, entry.extent * viewportScale - rect[axis.size]) + gap * viewportScale;
      const exited = viewport[axis.size] > 0 && !entry.entering && (direction > 0
        ? Math.max(top, top + from * scale) + rect[axis.size] + padding <= viewport[axis.position]
        : Math.min(top, top + from * scale) - padding >= viewport[axis.end]);
      return { entry, top, dy, from, exited };
    });
    // Busy feeds may never finish a move. Release only rows already past the exit
    // at both their visible and target positions, including decorative clearance.
    while (positions.length > 1 && positions[0].exited) removeEntry(positions.shift().entry);
    // One duration and curve per pass keeps rows in step; taller arrivals glide a little longer.
    const distance = Math.max(0, ...positions.map(({ from }) => Math.abs(from)));
    const baseMs = Number.parseFloat(feedStyles?.getPropertyValue?.('--danmaku-move-base-ms')) || LAYOUT_MOVE_BASE_MS;
    const maxMs = Number.parseFloat(feedStyles?.getPropertyValue?.('--danmaku-move-max-ms')) || LAYOUT_MOVE_MAX_MS;
    const duration = Math.round(Math.min(maxMs, baseMs + distance));
    // An arrival during a move starts the new curve at the current speed instead of jolting the rows.
    const running = renderedEntries.find((entry) => entry.motion && entry.move);
    const reference = positions.find(({ dy }) => Math.abs(dy) >= 0.01)?.from;
    const styleCurve = feedStyles?.getPropertyValue?.('--danmaku-move-curve')?.split(',').map(Number);
    const [x1, y1, x2, y2] = styleCurve?.length === 4 && styleCurve.every(Number.isFinite)
      ? styleCurve : LAYOUT_MOVE_CURVE;
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
      cancelAnimations(entry, true);
      if (reducedMotion?.matches || typeof entry.node.animate !== 'function') continue;
      const motion = entry.node.animate([
        { [axis.position]: `${from}px` },
        { [axis.position]: '0px' },
      ], { duration, easing });
      entry.motion = motion;
      entry.move = { from, duration, curve };
      motion.onfinish = () => {
        motion.cancel();
        if (entry.motion === motion) entry.motion = null;
        // A pending append/resize must measure first; otherwise only cleanup remains.
        if (layoutFrame === null) pruneFixedLayout();
      };
    }
  }

  function fitItem(entry, availableWidth, availableHeight) {
    const node = entry.node;
    node.style.setProperty('width', '');
    node.style.setProperty('zoom', '');
    if (['prismatic', 'snowfox'].includes(options.style) && (entry.item.kind === 'superchat' ||
      (entry.item.kind === 'gift' && [1, 2, 3].includes(entry.item.giftGuardLevel)))) {
      // Full-width cards reflow at a smaller type size instead of narrowing the panel.
      node.style.setProperty('font-size', '');
      node.style.setProperty('--danmaku-font-size', '');
      if (availableHeight > 0 && node.offsetHeight > availableHeight) {
        const computed = globalThis.getComputedStyle?.(node);
        const baseSize = Number.parseFloat(computed?.fontSize) || 0;
        const bodySize = Number.parseFloat(computed?.getPropertyValue('--danmaku-font-size')) || baseSize;
        let low = 0;
        let high = baseSize;
        for (let attempt = 0; attempt < 8 && high > 0; attempt += 1) {
          const size = (low + high) / 2;
          node.style.setProperty('font-size', `${size}px`);
          node.style.setProperty('--danmaku-font-size', `${bodySize * size / baseSize}px`);
          if (node.offsetHeight <= availableHeight - 1) low = size;
          else high = size;
        }
        node.style.setProperty('font-size', `${low}px`);
        if (baseSize > 0) node.style.setProperty('--danmaku-font-size', `${bodySize * low / baseSize}px`);
      }
    }
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
    const start = horizontal ? bounds.x : bounds.y;
    const naturalExtent = horizontal ? width : height;
    if (!fullscreen && (bounds.x || bounds.y || bounds[axis.size] !== naturalExtent)) {
      entry.effectLayout ||= [`margin-${axis.position}`, `margin-${axis.end}`, 'translate'].map(key => [key, node.style.getPropertyValue(key)]);
      node.style.setProperty(`margin-${axis.position}`, -start + 'px');
      node.style.setProperty(`margin-${axis.end}`, (bounds[axis.size] + start - naturalExtent) + 'px');
      node.style.setProperty('translate', horizontal
        ? `var(--danmaku-enter-x, 0px) ${-bounds.y}px`
        : `calc(${-bounds.x}px + var(--danmaku-enter-x, 0px)) 0px`);
    } else if (entry.effectLayout) {
      for (const [key, value] of entry.effectLayout) node.style.setProperty(key, value);
      entry.effectLayout = null;
    }
    return { width: bounds.width * zoom * scale, height: bounds.height * zoom * scale,
      x: bounds.x, y: bounds.y, zoom: zoom * scale };
  }

  function pruneOldMessages() {
    const maxContentHeight = viewportExtent > 0 ? viewportExtent * (offscreenViewports + 1) : Number.POSITIVE_INFINITY;
    while (
      renderedEntries.length > 1 &&
      (renderedEntries.length > maxItems || renderedContentExtent > maxContentHeight)
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
    renderedContentExtent = Math.max(0, renderedContentExtent - entry.extent);
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
    // Capture timing per message. Editing the next message's settings must not
    // restart a current fade, move its deadline, or rebuild the visible feed.
    const { exitAnimation = 'fade', exitDurationMs = FADE_DURATION_MS } = expirationOptions;
    const event = ['gift', 'superchat'].includes(entry.item?.kind);
    const itemLifetimeMs = Number(expirationOptions.itemLifetimeMs)
      + (event ? DANMAKU_STYLE_OPTIONS[options.style]?.eventDurationExtraMs || 0 : 0);
    if ((!fullscreen && !options.expireFixedItems) || !expireItems || !Number.isFinite(itemLifetimeMs) || itemLifetimeMs <= 0) return;
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
      if (fitViewport) scheduleLayout();
    };
    if (exitAnimation === 'none' || reducedMotion?.matches || typeof entry.node.animate !== 'function') {
      entry.timer = scheduleTimeout(expire, remaining);
      return;
    }
    entry.timer = scheduleTimeout(() => {
      const fadeMs = Math.max(0, timestamp + itemLifetimeMs - Number(now()));
      if (!fadeMs) return expire();
      if (!reducedMotion?.matches) {
        // Keep text painted at the canvas scale during expiration as well as entry.
        entry.node.style.opacity = 'var(--danmaku-exit-opacity)';
        entry.fade = entry.node.animate([{ '--danmaku-exit-opacity': 1 }, { '--danmaku-exit-opacity': 0 }], {
          duration: fadeMs,
          easing: 'cubic-bezier(0.4, 0, 1, 1)',
          fill: 'forwards',
        });
      }
      entry.timer = scheduleTimeout(expire, fadeMs);
    }, Math.max(0, remaining - exitDurationMs));
  }

  function repositionFullscreenItems() {
    if (!fullscreen) return;
    const width = Number(root.clientWidth) || 0;
    const height = Number(root.clientHeight) || 0;
    if (width <= 0 || height <= 0) return;
    const occupied = [];
    const measured = renderedEntries.map((entry) => ({
      entry,
      anchor: options.style === 'stardust' ? entry.node.dataset.stardustAnchor : undefined,
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
      if (item.entry.live) {
        item.entry.node.dataset.liveEntry = 'true';
        item.entry.live = false;
      }
      occupied.push({ ...item, ...position });
    }
  }

  function scrollToLatest() {
    if (autoScroll) root[horizontal ? 'scrollLeft' : 'scrollTop'] = root[horizontal ? 'scrollWidth' : 'scrollHeight'];
  }

  function selectMessages(items, bypassViewportPruning = false) {
    const bounded = Array.isArray(items)
      ? items.filter((item) => (showSuperchat || item?.kind !== 'superchat')
        && (options.style !== 'harbor' || isHarborGiftVisible(item, options.minGiftAmount))).slice(-maxItems) : [];
    if (fullscreen || fitViewport || bypassViewportPruning || viewportExtent <= 0 || bounded.length <= 1)
      return bounded;

    // Keep the visible viewport plus the configured buffer above it. The
    // estimate avoids creating DOM nodes that are guaranteed to be discarded.
    const maxContentHeight = viewportExtent * (offscreenViewports + 1);
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
    remove,
    setRandomPlacement(value) {
      randomPlacement = { centerBias: value.centerBias, dispersion: value.dispersion, clearCenter: value.clearCenter };
    },
    setExpirationOptions(value) {
      expirationOptions = value;
    },
    destroy() {
      if (layoutFrame !== null) globalThis.cancelAnimationFrame?.(layoutFrame);
      layoutFrame = null;
      resizeObserver?.disconnect();
      root.ownerDocument?.defaultView?.removeEventListener('lira:effects-updated', scheduleLayout);
      reducedMotion?.removeEventListener?.('change', finishMotion);
      if (hasEntrance) root.removeEventListener?.('animationend', finishEntrance);
      clearExpirationTimers();
      if (smoothLayout) delete root.dataset.smoothLayout;
      delete root.dataset.flowOverflow;
      renderedSequence = 0;
      viewportExtent = 0;
      renderedContentExtent = 0;
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
