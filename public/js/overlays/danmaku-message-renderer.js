export const DEFAULT_DANMAKU_CLASSES = Object.freeze({
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
  empty: 'draw-danmaku-empty',
});

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
  const visualLength = Math.max(
    1,
    Array.from(text).reduce((total, character) => {
      if (/\s/.test(character)) return total + 0.35;
      return total + (/^[\u0000-\u00ff]$/.test(character) ? 0.62 : 1);
    }, 0),
  );
  const lines = Math.max(1, Math.ceil(visualLength / DANMAKU_LINE_CAPACITY));
  const width = Math.min(
    100,
    Math.max(52, Math.round(44 + visualLength * 3.8)),
  );
  const height = 52 + (lines - 1) * 17;
  return { visualLength, lines, width, height };
}

// Rendering owns no message queue, timers, observers, or layout scheduling.
export function createDanmakuMessageRenderer({
  document,
  classNames,
  fullscreen,
  showAvatar = !fullscreen,
  showGiftTotal = false,
  ...options
}) {
  const resolveAvatarUrl =
    typeof options.resolveAvatarUrl === 'function'
      ? options.resolveAvatarUrl
      : (value) => value;
  const resolveEmoteUrl =
    typeof options.resolveEmoteUrl === 'function'
      ? options.resolveEmoteUrl
      : (value) => value;
  const getGuardLabel =
    typeof options.getGuardLabel === 'function'
      ? options.getGuardLabel
      : () => '';

  function createBubble(item = {}, index = 0) {
    const message = String(item.message || '').trim();
    const metrics = measureDanmakuText(message);
    const bubble = document.createElement('article');
    bubble.className = `${classNames.item} ${classNames.bubble}`;
    if (item.kind === 'gift') bubble.className += ' is-gift';
    bubble.dataset.tone = String(index % 4);
    bubble.dataset.identity = identityVariant(item.guardLevel, item.medalName);
    if (item.isStreamer === true) bubble.dataset.streamer = 'true';
    if (fullscreen) bubble.style.setProperty('visibility', 'hidden');
    bubble.style.setProperty('--danmaku-width', `${metrics.width}%`);
    bubble.style.setProperty('--danmaku-height', `${metrics.height}px`);
    bubble.style.setProperty('--danmaku-lines', String(metrics.lines));
    bubble.style.setProperty('--danmaku-delay', `${Math.min(index, 8) * 24}ms`);
    if (isEmoteOnlyMessage(message, item.emotes))
      bubble.className += ' is-emote-only';

    const name = String(item.name || '观众').trim() || '观众';
    const avatar = createAvatar(item, name, bubble);

    const body = document.createElement('div');
    body.className = classNames.body;
    const identity = createIdentity(item, name);

    const messageElement = document.createElement('p');
    if (item.kind === 'gift') appendGiftContent(messageElement, item);
    else appendMessageContent(messageElement, message, item.emotes);
    body.append(identity, messageElement);
    if (avatar) bubble.append(avatar);
    bubble.append(body);
    return bubble;
  }

  function appendGiftContent(rootElement, item) {
    rootElement.className = 'draw-danmaku-gift';
    const art = document.createElement('span');
    art.className = 'draw-danmaku-gift-art';
    art.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'draw-danmaku-gift-copy';
    const action = document.createElement('span');
    action.className = 'draw-danmaku-gift-action';
    action.textContent = '送出';
    const name = document.createElement('strong');
    name.className = 'draw-danmaku-gift-name';
    name.textContent = String(item.giftName || '礼物');
    const count = document.createElement('b');
    count.className = 'draw-danmaku-gift-count';
    count.textContent = `× ${item.giftCount}`;
    copy.append(action, name);
    if (showGiftTotal) {
      const amount = document.createElement('b');
      amount.className = 'draw-danmaku-gift-amount';
      amount.textContent = Number.isFinite(item.giftTotalPrice) && item.giftTotalPrice >= 0
        ? `¥${item.giftTotalPrice.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '—';
      copy.append(count);
      rootElement.append(art, copy, amount);
    } else rootElement.append(art, copy, count);
  }

  function createAvatar(item, name, bubble) {
    if (!showAvatar) return null;
    const avatar = document.createElement('div');
    avatar.className = classNames.avatar;
    avatar.setAttribute('aria-hidden', 'true');
    const medalLevel = Number(item.medalLevel);
    if (Number.isSafeInteger(medalLevel) && medalLevel > 0) {
      avatar.dataset.medalLevel = String(medalLevel);
    }
    if (item.avatarUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      const source = String(resolveAvatarUrl(item.avatarUrl) || '');
      if (source) {
        image.addEventListener('load', () => {
          bubble.style.setProperty('--danmaku-avatar-image', `url(${JSON.stringify(source)})`);
        });
        image.src = source;
        image.addEventListener('error', () => {
          image.remove();
          avatar.textContent = Array.from(name)[0] || '观';
        });
        avatar.append(image);
      } else avatar.textContent = Array.from(name)[0] || '观';
    } else avatar.textContent = Array.from(name)[0] || '观';

    return avatar;
  }

  function createIdentity(item, name) {
    const identity = document.createElement('div');
    identity.className = classNames.identity;
    const nameElement = document.createElement('strong');
    nameElement.textContent = name;
    identity.append(nameElement);

    if (!fullscreen) {
      const guard = String(getGuardLabel(item.guardLevel) || '').trim();
      if (guard) identity.append(createBadge(guard, classNames.guard));
      const medalName = String(item.medalName || '').trim();
      if (medalName) {
        const medalLevel = Math.max(
          0,
          Math.trunc(Number(item.medalLevel)) || 0,
        );
        const medal = createBadge('', classNames.medal);
        const medalNameElement = document.createElement('span');
        medalNameElement.className = 'draw-danmaku-medal-name';
        medalNameElement.textContent =
          medalLevel > 0 ? `${medalName} ` : medalName;
        medal.append(medalNameElement);
        if (medalLevel > 0) {
          const medalLevelElement = document.createElement('b');
          medalLevelElement.className = 'draw-danmaku-medal-level';
          medalLevelElement.textContent = String(medalLevel);
          medal.append(medalLevelElement);
        }
        identity.append(medal);
      }
    }

    return identity;
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
      if (match.index > cursor)
        appendText(rootElement, message.slice(cursor, match.index));
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
      image.style.setProperty(
        '--danmaku-emote-ratio',
        `${emote.width} / ${emote.height}`,
      );
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

  return createBubble;
}

function normalizeRenderableEmotes(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tokens = [];
  for (const item of value) {
    const text = String((item && item.text) || '').trim();
    const url = String((item && item.url) || '').trim();
    if (!text || !url || seen.has(text)) continue;
    seen.add(text);
    tokens.push({
      text,
      url,
      width: Math.max(0, Math.trunc(Number(item.width)) || 0),
      height: Math.max(0, Math.trunc(Number(item.height)) || 0),
    });
  }
  return tokens.sort((left, right) => right.text.length - left.text.length);
}

function findNextEmote(message, cursor, emotes) {
  let next = null;
  for (const emote of emotes) {
    const index = message.indexOf(emote.text, cursor);
    if (index < 0) continue;
    if (
      !next ||
      index < next.index ||
      (index === next.index && emote.text.length > next.emote.text.length)
    ) {
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
