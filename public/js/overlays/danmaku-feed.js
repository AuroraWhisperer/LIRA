/* global document */

const DEFAULT_CLASSES = Object.freeze({
  item: 'draw-danmaku-item',
  bubble: 'draw-danmaku-bubble',
  avatar: 'draw-danmaku-avatar',
  body: 'draw-danmaku-body',
  identity: 'draw-danmaku-identity',
  badge: 'draw-danmaku-badge',
  guard: 'draw-danmaku-guard',
  medal: 'draw-danmaku-medal',
  empty: 'draw-danmaku-empty'
});

const DEFAULT_MAX_ITEMS = 120;
const DEFAULT_OFFSCREEN_VIEWPORTS = 5;
const DANMAKU_ITEM_SPACING_PX = 11;
const DANMAKU_LINE_CAPACITY = 13;

/**
 * Estimate the visual footprint of a mixed Chinese/Latin message without
 * coupling the component to a particular font or canvas implementation.
 *
 * @param {unknown} message
 * @returns {{ visualLength: number, lines: number, width: number, height: number }}
 */
export function measureDanmakuText(message) {
  const text = String(message || '').trim();
  const visualLength = Math.max(1, Array.from(text).reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.35;
    return total + (/^[\u0000-\u00ff]$/.test(character) ? 0.62 : 1);
  }, 0));
  const lines = Math.max(1, Math.ceil(visualLength / DANMAKU_LINE_CAPACITY));
  const width = Math.min(100, Math.max(52, Math.round(44 + visualLength * 3.8)));
  const height = 52 + (lines - 1) * 17;
  return { visualLength, lines, width, height };
}

/**
 * Build a reusable live-message feed. The game owns data and lifecycle while
 * this component owns the DOM shape and adaptive bubble sizing.
 *
 * @param {HTMLElement} root
 * @param {{maxItems?: number, offscreenViewports?: number, resolveAvatarUrl?: Function, getGuardLabel?: Function, classNames?: object}} options
 * @returns {{render: Function, destroy: Function}}
 */
export function createDanmakuFeed(root, options = {}) {
  if (!root || typeof root.replaceChildren !== 'function') {
    throw new TypeError('弹幕组件需要一个可渲染的根节点。');
  }
  const maxItems = Math.max(1, Math.trunc(Number(options.maxItems)) || DEFAULT_MAX_ITEMS);
  const requestedOffscreenViewports = Number(options.offscreenViewports);
  const offscreenViewports = Number.isFinite(requestedOffscreenViewports)
    ? Math.max(0, requestedOffscreenViewports)
    : DEFAULT_OFFSCREEN_VIEWPORTS;
  const resolveAvatarUrl = typeof options.resolveAvatarUrl === 'function'
    ? options.resolveAvatarUrl
    : value => value;
  const getGuardLabel = typeof options.getGuardLabel === 'function'
    ? options.getGuardLabel
    : () => '';
  const classNames = { ...DEFAULT_CLASSES, ...(options.classNames || {}) };

  function render(items) {
    root.replaceChildren();
    const messages = selectMessages(items);
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = classNames.empty;
      empty.textContent = '等待直播消息…';
      root.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    messages.forEach((item, index) => fragment.append(createBubble(item, index)));
    root.append(fragment);
    root.scrollTop = root.scrollHeight;
  }

  function selectMessages(items) {
    const bounded = Array.isArray(items) ? items.slice(-maxItems) : [];
    const viewportHeight = Number(root.clientHeight);
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0 || bounded.length <= 1) return bounded;

    // Keep the visible viewport plus the configured buffer above it. The
    // estimate avoids creating DOM nodes that are guaranteed to be discarded.
    const maxContentHeight = viewportHeight * (offscreenViewports + 1);
    let contentHeight = 0;
    const retained = [];
    for (let index = bounded.length - 1; index >= 0; index -= 1) {
      const itemHeight = measureDanmakuText(bounded[index]?.message).height + DANMAKU_ITEM_SPACING_PX;
      if (retained.length && contentHeight + itemHeight > maxContentHeight) break;
      retained.unshift(bounded[index]);
      contentHeight += itemHeight;
    }
    return retained;
  }

  function createBubble(item = {}, index = 0) {
    const message = String(item.message || '').trim();
    const metrics = measureDanmakuText(message);
    const bubble = document.createElement('article');
    bubble.className = `${classNames.item} ${classNames.bubble}`;
    bubble.dataset.tone = String(index % 4);
    bubble.style.setProperty('--danmaku-width', `${metrics.width}%`);
    bubble.style.setProperty('--danmaku-height', `${metrics.height}px`);
    bubble.style.setProperty('--danmaku-lines', String(metrics.lines));
    bubble.style.setProperty('--danmaku-delay', `${Math.min(index, 8) * 24}ms`);

    const name = String(item.name || '观众').trim() || '观众';
    const avatar = document.createElement('div');
    avatar.className = classNames.avatar;
    avatar.setAttribute('aria-hidden', 'true');
    if (item.avatarUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = String(resolveAvatarUrl(item.avatarUrl) || '');
      image.addEventListener('error', () => {
        image.remove();
        avatar.textContent = Array.from(name)[0] || '观';
      });
      avatar.append(image);
    } else avatar.textContent = Array.from(name)[0] || '观';

    const body = document.createElement('div');
    body.className = classNames.body;
    const identity = document.createElement('div');
    identity.className = classNames.identity;
    const nameElement = document.createElement('strong');
    nameElement.textContent = name;
    identity.append(nameElement);

    const guard = String(getGuardLabel(item.guardLevel) || '').trim();
    if (guard) identity.append(createBadge(guard, classNames.guard));
    const medalName = String(item.medalName || '').trim();
    if (medalName) {
      const medalLevel = Math.max(0, Math.trunc(Number(item.medalLevel)) || 0);
      identity.append(createBadge(
        medalLevel > 0 ? `${medalName} ${medalLevel}` : medalName,
        classNames.medal
      ));
    }

    const messageElement = document.createElement('p');
    messageElement.textContent = message;
    body.append(identity, messageElement);
    bubble.append(avatar, body);
    return bubble;
  }

  function createBadge(label, variantClass) {
    const badge = document.createElement('span');
    badge.className = `${classNames.badge} ${variantClass}`;
    badge.textContent = label;
    return badge;
  }

  return {
    render,
    destroy() { root.replaceChildren(); }
  };
}
