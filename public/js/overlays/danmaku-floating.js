import { componentEffectBounds } from './component-effect-filters.js';
import { findFloatingDanmakuTop } from './danmaku-floating-position.js';
import { DEFAULT_DANMAKU_CLASSES, createDanmakuMessageRenderer } from './danmaku-message-renderer.js';

// Horizontal travel has its own lifetime: a card leaves only after its trailing edge exits.
export function createFloatingDanmakuFeed(root, options = {}) {
  const classNames = { ...DEFAULT_DANMAKU_CLASSES, ...options.classNames };
  const createMessage = createDanmakuMessageRenderer({
    ...options, document: root.ownerDocument || document, classNames, fullscreen: true, showAvatar: false,
  });
  const now = options.now || (() => Date.now());
  const scheduleTimeout = options.scheduleTimeout || ((callback, delay) => setTimeout(callback, delay));
  const cancelTimeout = options.cancelTimeout || ((timer) => clearTimeout(timer));
  const maxItems = options.maxItems || 50;
  let speed = options.speedPixelsPerSecond || 120;
  let dispersion = options.floatingDispersion ?? 50;
  let pendingTimer = null;
  let entries = [];
  let sequence = 0;
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null;
  observer?.observe(root);
  root.ownerDocument?.defaultView?.addEventListener('lira:effects-updated', layout);

  function stop(entry) {
    if (entry.timer !== null) cancelTimeout(entry.timer);
    entry.timer = null;
    entry.animation?.cancel();
    entry.animation = null;
  }

  function remove(entry, notify = true) {
    stop(entry);
    observer?.unobserve(entry.node);
    entry.node.remove();
    entries = entries.filter((current) => current !== entry);
    if (notify) options.onRemove?.(entry.item);
  }

  function layout() {
    if (pendingTimer !== null) cancelTimeout(pendingTimer);
    pendingTimer = null;
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (!width || !height) return;
    const time = now();
    for (const entry of [...entries]) {
      const { node } = entry;
      node.style.zoom = '1';
      const bounds = componentEffectBounds(node, node.offsetWidth, node.offsetHeight);
      const scale = Math.min(1, width / (bounds.width || 1), height / (bounds.height || 1));
      const cardWidth = bounds.width * scale;
      const cardHeight = bounds.height * scale;
      const trailWidth = parseFloat(node.ownerDocument.defaultView.getComputedStyle(node).getPropertyValue('--danmaku-trail-width')) || 0;
      const travelWidth = cardWidth + trailWidth * scale;
      const geometry = `${width}:${height}:${travelWidth}:${cardHeight}:${speed}`;
      if (entry.geometry === geometry) continue;
      const left = Math.min(width, entry.startedAt === undefined
        ? entry.waitingAt === undefined
          ? width - Math.max(0, time - (Number(entry.item.timestamp) || time)) * speed / 1000 : width
        : entry.left - (time - entry.startedAt) * entry.speed / 1000);
      stop(entry);
      if (left + travelWidth <= 0) {
        remove(entry);
        continue;
      }
      if (entry.topRatio === undefined) {
        const occupied = entries.filter(current => current !== entry && current.startedAt !== undefined)
          .map(current => ({
            left: current.left - (time - current.startedAt) * current.speed / 1000,
            top: current.topRatio * Math.max(0, height - current.cardHeight),
            width: current.travelWidth, height: current.cardHeight,
          })).filter(box => box.left + box.width > 0);
        const top = findFloatingDanmakuTop({ left, width: travelWidth, height: cardHeight }, height, occupied, dispersion);
        if (top === undefined) {
          entry.waitingAt ??= time;
          if (time - entry.waitingAt >= 2000) remove(entry);
          else if (pendingTimer === null) pendingTimer = scheduleTimeout(layout, 100);
          continue;
        }
        entry.topRatio = top / (height - cardHeight || 1);
      }
      entry.cardHeight = cardHeight;
      entry.travelWidth = travelWidth;
      entry.geometry = geometry;
      entry.left = left;
      entry.startedAt = time;
      entry.speed = speed;
      const duration = (left + travelWidth) / speed * 1000;
      node.style.left = '0px';
      node.style.top = `${entry.topRatio * Math.max(0, height - cardHeight) - bounds.y * scale}px`;
      node.style.visibility = 'visible';
      node.style.transformOrigin = 'top left';
      entry.animation = node.animate([
        { transform: `translateX(${left - bounds.x * scale}px) scale(${scale}) var(--component-transform, translate(0px, 0px))` },
        { transform: `translateX(${-travelWidth - bounds.x * scale}px) scale(${scale}) var(--component-transform, translate(0px, 0px))` },
      ], { duration, easing: 'linear', fill: 'forwards' });
      entry.timer = scheduleTimeout(() => { remove(entry); layout(); }, duration);
    }
  }

  function add(item) {
    if (item?.kind === 'superchat') return;
    if (!entries.length) root.replaceChildren();
    const node = createMessage(item, sequence++);
    node.style.visibility = 'hidden';
    const entry = { node, item, timer: null };
    entries.push(entry);
    root.append(node);
    observer?.observe(node);
    while (entries.length > maxItems) remove(entries[0]);
    return true;
  }

  function append(item) {
    if (add(item)) layout();
  }

  function appendBatch(items) {
    let added = false;
    for (const item of items) if (add(item)) added = true;
    if (added) layout();
  }

  function clear() {
    if (pendingTimer !== null) cancelTimeout(pendingTimer);
    pendingTimer = null;
    for (const entry of [...entries]) remove(entry, false);
    root.replaceChildren();
  }

  return {
    append,
    appendBatch,
    render(items) {
      clear();
      appendBatch((Array.isArray(items) ? items : []).filter((item) => item?.kind !== 'superchat').slice(-maxItems));
    },
    setSpeedPixelsPerSecond(value) {
      speed = value;
      layout();
    },
    setFloatingDispersion(value) {
      dispersion = value;
    },
    destroy() {
      observer?.disconnect();
      root.ownerDocument?.defaultView?.removeEventListener('lira:effects-updated', layout);
      clear();
    },
  };
}
