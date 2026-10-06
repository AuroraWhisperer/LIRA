/* global document */
import {
  DEFAULT_DANMAKU_CLASSES,
  createDanmakuMessageRenderer,
  measureDanmakuText,
} from './danmaku-message-renderer.js';

export { measureDanmakuText };

const DEFAULT_MAX_ITEMS = 120;
const DEFAULT_OFFSCREEN_VIEWPORTS = 5;
const DANMAKU_ITEM_SPACING_PX = 11;
const FULLSCREEN_SAFE_INSET_PX = 16;
const FULLSCREEN_ITEM_GAP_PX = 10;
const FULLSCREEN_LAYOUT = 'fullscreen-random';
const FADE_DURATION_MS = 400;

/**
 * Build a reusable live-message feed. The game owns data and lifecycle while
 * this component owns message timing, layout, and removal.
 *
 * @param {HTMLElement} root
 * @param {{maxItems?: number, offscreenViewports?: number, autoScroll?: boolean, layout?: string, showAvatar?: boolean, showGiftTotal?: boolean, itemLifetimeMs?: number, expireItems?: boolean, now?: Function, scheduleTimeout?: Function, cancelTimeout?: Function, resolveAvatarUrl?: Function, resolveEmoteUrl?: Function, getGuardLabel?: Function, classNames?: object}} options
 * @returns {{render: Function, append: Function, destroy: Function}}
 */
export function createDanmakuFeed(root, options = {}) {
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
  const smoothMoonlit = fitViewport && options.style === 'moonlit';
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
  let layoutFrame = null;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          updateViewportHeight();
          if (smoothMoonlit) {
            if (layoutFrame !== null) globalThis.cancelAnimationFrame?.(layoutFrame);
            layoutFrame = null;
            updateLayout();
          } else if (fullscreen || fitViewport) scheduleLayout();
          else pruneOldMessages();
        })
      : null;
  resizeObserver?.observe(root);
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
    if (reducedMotion?.matches) renderedEntries.forEach(cancelAnimations);
  }

  function render(items) {
    const showingEmptyState = root.children.length === 1 && root.children[0].className === classNames.empty;
    clearExpirationTimers();
    renderedEntries.forEach(({ node }) => resizeObserver?.unobserve?.(node));
    updateViewportHeight();
    root.replaceChildren();
    renderedContentHeight = 0;
    renderedEntries = [];
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
    const entry = { node, height, item, timer: null, entering: smoothMoonlit };
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
      const measured = Number(entry.node.offsetHeight) * zoom;
      entry.height = measured > 0 ? measured : estimateItemHeight(entry.item);
      return total + entry.height;
    }, 0);
    // Keep the boundary message while any part is visible; CSS clips the rest.
    // Layout heights ignore entrance transforms and work in either scroll direction.
    while (
      renderedEntries.length > 1 &&
      (renderedEntries.length > maxItems ||
        (viewportHeight > 0 && renderedContentHeight - renderedEntries[0].height +
          gap * (renderedEntries.length - 1) + padding >= viewportHeight))
    ) {
      removeEntry(renderedEntries[0]);
    }
    if (smoothMoonlit) animateMoonlitLayout(gap, styles?.flexDirection === 'column-reverse' ? -1 : 1);
  }

  function animateMoonlitLayout(gap, direction) {
    // Read all final positions before writing. Keep the visible transform when
    // another gift arrives during a move, so the feed never snaps back.
    const positions = renderedEntries.map((entry) => {
      const top = entry.node.offsetTop;
      const zoom = Number.parseFloat(globalThis.getComputedStyle?.(entry.node)?.zoom) || 1;
      const dy = entry.entering ? direction * (entry.height + gap) / zoom : (entry.top ?? top) - top;
      const transform = dy ? globalThis.getComputedStyle?.(entry.node)?.transform : null;
      return { entry, top, dy, transform };
    });
    for (const { entry, top, dy, transform } of positions) {
      entry.top = top;
      entry.entering = false;
      if (!dy) continue;
      cancelAnimations(entry);
      if (reducedMotion?.matches || typeof entry.node.animate !== 'function') continue;
      const motion = entry.node.animate([
        { transform: `translateY(${dy}px) ${transform && transform !== 'none' ? transform : ''}` },
        { transform: 'none' },
      ], { duration: 520, easing: 'cubic-bezier(.22, .61, .36, 1)' });
      entry.motion = motion;
      motion.onfinish = () => {
        motion.cancel();
        if (entry.motion === motion) entry.motion = null;
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
    // Computed zoom is rounded; an exact fit can appear a fraction of a pixel wider.
    const scale = Math.min(
      1,
      width * zoom > availableWidth + 0.01 && availableWidth > 0 ? (availableWidth - 1) / (width * zoom) : 1,
      height * zoom > availableHeight && availableHeight > 0 ? (availableHeight - 1) / (height * zoom) : 1,
    );
    if (scale < 1) {
      // Freeze the natural line breaks before zoom changes the containing width.
      node.style.setProperty('width', `${width}px`);
      node.style.setProperty('zoom', String(zoom * scale));
    }
    return { width: width * zoom * scale, height: height * zoom * scale, zoom: zoom * scale };
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
      let position = findFullscreenPosition(item, width, height, occupied);
      while (!position && occupied.length) {
        removeEntry(occupied.shift().entry);
        position = findFullscreenPosition(item, width, height, occupied);
      }
      if (!position) {
        removeEntry(item.entry);
        continue;
      }
      item.entry.position = position;
      item.entry.node.style.setProperty('left', `${position.left / item.zoom}px`);
      item.entry.node.style.setProperty('top', `${position.top / item.zoom}px`);
      item.entry.node.style.setProperty('visibility', 'visible');
      occupied.push({ ...item, ...position });
    }
  }

  function findFullscreenPosition(item, width, height, occupied) {
    const inset = Math.min(FULLSCREEN_SAFE_INSET_PX, Math.floor(Math.min(width, height) / 2));
    const maxLeft = width - item.width - inset;
    const maxTop = height - item.height - inset;
    const [leftRatio, topRatio] = fullscreenPositionRatios(item.entry.item);
    const candidates = [
      item.entry.position,
      {
        left: inset + (maxLeft - inset) * leftRatio,
        top: inset + (maxTop - inset) * topRatio,
      },
      { left: inset, top: inset },
      { left: maxLeft, top: inset },
      { left: inset, top: maxTop },
      { left: maxLeft, top: maxTop },
    ];
    for (const box of occupied) {
      candidates.push(
        {
          left: box.left + box.width + FULLSCREEN_ITEM_GAP_PX,
          top: box.top,
        },
        {
          left: box.left,
          top: box.top + box.height + FULLSCREEN_ITEM_GAP_PX,
        },
        {
          left: box.left - item.width - FULLSCREEN_ITEM_GAP_PX,
          top: box.top,
        },
        {
          left: box.left,
          top: box.top - item.height - FULLSCREEN_ITEM_GAP_PX,
        },
      );
    }
    return candidates.find(
      (point) =>
        point &&
        point.left >= inset &&
        point.top >= inset &&
        point.left <= maxLeft &&
        point.top <= maxTop &&
        occupied.every(
          (box) =>
            point.left >= box.left + box.width + FULLSCREEN_ITEM_GAP_PX ||
            point.left + item.width + FULLSCREEN_ITEM_GAP_PX <= box.left ||
            point.top >= box.top + box.height + FULLSCREEN_ITEM_GAP_PX ||
            point.top + item.height + FULLSCREEN_ITEM_GAP_PX <= box.top,
        ),
    );
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
    destroy() {
      if (layoutFrame !== null) globalThis.cancelAnimationFrame?.(layoutFrame);
      layoutFrame = null;
      resizeObserver?.disconnect();
      reducedMotion?.removeEventListener?.('change', finishMotion);
      clearExpirationTimers();
      renderedSequence = 0;
      viewportHeight = 0;
      renderedContentHeight = 0;
      renderedEntries = [];
      root.replaceChildren();
    },
  };
}

function fullscreenPositionRatios(item = {}) {
  const seed = [item.id, item.uid, item.timestamp, item.name, item.message]
    .map((value) => String(value ?? ''))
    .join('|');
  const first = stableHash(seed);
  const second = stableHash(`${seed}|top`);
  return [first / 4294967295, second / 4294967295];
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
