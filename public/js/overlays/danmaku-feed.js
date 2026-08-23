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
  emote: 'draw-danmaku-emote',
  text: 'draw-danmaku-text',
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
 * @param {{maxItems?: number, offscreenViewports?: number, autoScroll?: boolean, resolveAvatarUrl?: Function, resolveEmoteUrl?: Function, getGuardLabel?: Function, classNames?: object}} options
 * @returns {{render: Function, append: Function, destroy: Function}}
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
  const resolveEmoteUrl = typeof options.resolveEmoteUrl === 'function'
    ? options.resolveEmoteUrl
    : value => value;
  const getGuardLabel = typeof options.getGuardLabel === 'function'
    ? options.getGuardLabel
    : () => '';
  const classNames = { ...DEFAULT_CLASSES, ...(options.classNames || {}) };
  const autoScroll = options.autoScroll !== false;
  let renderedSequence = 0;
  let viewportHeight = 0;
  let renderedContentHeight = 0;
  let renderedEntries = [];
  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        updateViewportHeight();
        pruneOldMessages();
      })
    : null;
  resizeObserver?.observe(root);

  function render(items) {
    const showingEmptyState = root.children.length === 1
      && root.children[0].className === classNames.empty;
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
      renderedEntries.push({ node, height });
      renderedContentHeight += height;
    });
    root.append(fragment);
    scrollToLatest();
  }

  function append(item) {
    if (root.children.length === 1 && root.children[0].className === classNames.empty) {
      root.replaceChildren();
    }
    const node = createBubble(item, renderedSequence);
    const height = estimateItemHeight(item);
    root.append(node);
    renderedEntries.push({ node, height });
    renderedContentHeight += height;
    renderedSequence += 1;
    pruneOldMessages();
    scrollToLatest();
  }

  function updateViewportHeight() {
    const nextHeight = Number(root.clientHeight);
    if (Number.isFinite(nextHeight) && nextHeight > 0) viewportHeight = nextHeight;
  }

  function pruneOldMessages() {
    const maxContentHeight = viewportHeight > 0
      ? viewportHeight * (offscreenViewports + 1)
      : Number.POSITIVE_INFINITY;
    while (
      renderedEntries.length > 1 &&
      (renderedEntries.length > maxItems || renderedContentHeight > maxContentHeight)
    ) {
      const oldest = renderedEntries.shift();
      renderedContentHeight = Math.max(0, renderedContentHeight - oldest.height);
      root.removeChild(oldest.node);
    }
  }

  function scrollToLatest() {
    if (autoScroll) root.scrollTop = root.scrollHeight;
  }

  function selectMessages(items, bypassViewportPruning = false) {
    const bounded = Array.isArray(items) ? items.slice(-maxItems) : [];
    if (bypassViewportPruning || viewportHeight <= 0 || bounded.length <= 1) return bounded;

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

  function createBubble(item = {}, index = 0) {
    const message = String(item.message || '').trim();
    const metrics = measureDanmakuText(message);
    const bubble = document.createElement('article');
    bubble.className = `${classNames.item} ${classNames.bubble}`;
    bubble.dataset.tone = String(index % 4);
    bubble.dataset.identity = identityVariant(item.guardLevel, item.medalName);
    bubble.style.setProperty('--danmaku-width', `${metrics.width}%`);
    bubble.style.setProperty('--danmaku-height', `${metrics.height}px`);
    bubble.style.setProperty('--danmaku-lines', String(metrics.lines));
    bubble.style.setProperty('--danmaku-delay', `${Math.min(index, 8) * 24}ms`);
    if (isEmoteOnlyMessage(message, item.emotes)) bubble.className += ' is-emote-only';

    const name = String(item.name || '观众').trim() || '观众';
    const avatar = document.createElement('div');
    avatar.className = classNames.avatar;
    avatar.setAttribute('aria-hidden', 'true');
    if (item.avatarUrl) {
      const image = document.createElement('img');
      image.alt = '';
      const source = String(resolveAvatarUrl(item.avatarUrl) || '');
      if (source) {
        image.src = source;
        image.addEventListener('error', () => {
          image.remove();
          avatar.textContent = Array.from(name)[0] || '观';
        });
        avatar.append(image);
      } else avatar.textContent = Array.from(name)[0] || '观';
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
    appendMessageContent(messageElement, message, item.emotes);
    body.append(identity, messageElement);
    bubble.append(avatar, body);
    return bubble;
  }

  function appendMessageContent(rootElement, message, emotes) {
    const tokens = normalizeRenderableEmotes(emotes);
    if (!tokens.length) {
      rootElement.textContent = message;
      return;
    }
    let cursor = 0;
    while (cursor < message.length) {
      const match = findNextEmote(message, cursor, tokens);
      if (!match) {
        appendText(rootElement, message.slice(cursor));
        break;
      }
      if (match.index > cursor) appendText(rootElement, message.slice(cursor, match.index));
      rootElement.append(createEmoteImage(match.emote));
      cursor = match.index + match.emote.text.length;
    }
  }

  function appendText(rootElement, text) {
    if (!text) return;
    const span = document.createElement('span');
    span.className = classNames.text;
    span.textContent = text;
    rootElement.append(span);
  }

  function createEmoteImage(emote) {
    const source = String(resolveEmoteUrl(emote.url) || '');
    if (!source) return createTextNode(emote.text);
    const image = document.createElement('img');
    image.className = classNames.emote;
    image.alt = emote.text;
    image.src = source;
    image.loading = 'eager';
    image.decoding = 'async';
    if (emote.width > 0 && emote.height > 0) {
      image.style.setProperty('--danmaku-emote-ratio', `${emote.width} / ${emote.height}`);
    }
    image.addEventListener('error', () => {
      image.replaceWith(createTextNode(emote.text));
    });
    return image;
  }

  function createTextNode(text) {
    const fallback = document.createElement('span');
    fallback.className = classNames.text;
    fallback.textContent = text;
    return fallback;
  }

  function createBadge(label, variantClass) {
    const badge = document.createElement('span');
    badge.className = `${classNames.badge} ${variantClass}`;
    badge.textContent = label;
    return badge;
  }

  return {
    render,
    append,
    destroy() {
      resizeObserver?.disconnect();
      renderedSequence = 0;
      viewportHeight = 0;
      renderedContentHeight = 0;
      renderedEntries = [];
      root.replaceChildren();
    }
  };
}

function normalizeRenderableEmotes(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tokens = [];
  for (const item of value) {
    const text = String(item && item.text || '').trim();
    const url = String(item && item.url || '').trim();
    if (!text || !url || seen.has(text)) continue;
    seen.add(text);
    tokens.push({
      text,
      url,
      width: Math.max(0, Math.trunc(Number(item.width)) || 0),
      height: Math.max(0, Math.trunc(Number(item.height)) || 0)
    });
  }
  return tokens.sort((left, right) => right.text.length - left.text.length);
}

function findNextEmote(message, cursor, emotes) {
  let next = null;
  for (const emote of emotes) {
    const index = message.indexOf(emote.text, cursor);
    if (index < 0) continue;
    if (!next || index < next.index || (index === next.index && emote.text.length > next.emote.text.length)) {
      next = { index, emote };
    }
  }
  return next;
}

function isEmoteOnlyMessage(message, emotes) {
  const tokens = normalizeRenderableEmotes(emotes);
  return tokens.length === 1 && tokens[0].text === message;
}

function identityVariant(guardLevel, medalName) {
  if (Number(guardLevel) === 3) return 'captain';
  if (Number(guardLevel) === 2) return 'admiral';
  if (Number(guardLevel) === 1) return 'governor';
  return String(medalName || '').trim() ? 'fan' : 'viewer';
}
