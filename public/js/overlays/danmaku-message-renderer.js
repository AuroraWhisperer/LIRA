import { decorateSketchMessage } from './danmaku-sketch.js';
import { createSuperChatCard } from './danmaku-superchat-renderer.js';
import { decorateMoonlitMessage } from './danmaku-moonlit.js';
import { createPrismaticIdentity, decoratePrismaticMessage } from './danmaku-prismatic.js';

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
  const width = Math.min(100, Math.max(52, Math.round(44 + visualLength * 3.8)));
  const height = 52 + (lines - 1) * 17;
  return { visualLength, lines, width, height };
}

// Rendering owns no message queue, timers, observers, or layout scheduling.
export function createDanmakuMessageRenderer({
  document,
  classNames,
  fullscreen,
  style = 'ranked',
  showAvatar = !fullscreen,
  showGiftTotal = false,
  ...options
}) {
  const resolveAvatarUrl = typeof options.resolveAvatarUrl === 'function' ? options.resolveAvatarUrl : (value) => value;
  const resolveEmoteUrl = typeof options.resolveEmoteUrl === 'function' ? options.resolveEmoteUrl : (value) => value;
  const getGuardLabel = typeof options.getGuardLabel === 'function' ? options.getGuardLabel : () => '';

  function createBubble(item = {}, index = 0) {
    if (item.kind === 'superchat') {
      return createSuperChatCard(document, item, style === 'prismatic' ? 'ranked' : style, resolveAvatarUrl, classNames);
    }
    const message = String(item.message || '').trim();
    const metrics = measureDanmakuText(message);
    const bubble = document.createElement('article');
    bubble.className = `${classNames.item} ${classNames.bubble}`;
    if (item.kind === 'gift') bubble.className += ' is-gift';
    bubble.dataset.tone = String(index % 4);
    if (style === 'starveil') {
      // Stable per-message randomness survives re-rendering and ignores viewer rank.
      const seed = [item.id, item.uid, item.timestamp, item.name, item.message].join('|');
      let hash = 2166136261;
      for (const character of seed) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
      bubble.dataset.palette = String((hash >>> 0) % 6);
    }
    bubble.dataset.identity = identityVariant(item.guardLevel, item.medalName);
    if (style === 'prismatic') decoratePrismaticMessage(bubble, item);
    if (item.isStreamer === true) bubble.dataset.streamer = 'true';
    if (fullscreen) bubble.style.setProperty('visibility', 'hidden');
    bubble.style.setProperty('--danmaku-width', `${metrics.width}%`);
    bubble.style.setProperty('--danmaku-height', `${metrics.height}px`);
    bubble.style.setProperty('--danmaku-lines', String(metrics.lines));
    bubble.style.setProperty('--danmaku-delay', `${Math.min(index, 8) * 24}ms`);
    if (isEmoteOnlyMessage(message, item.emotes, style === 'prismatic')) bubble.className += ' is-emote-only';

    const name = String(item.name || '观众').trim() || '观众';
    const avatar = style === 'prismatic' && item.kind === 'gift' ? null : createAvatar(item, name, bubble);

    const body = document.createElement('div');
    body.className = classNames.body;
    const identity = createIdentity(item, name);

    const messageElement = document.createElement('p');
    if (item.kind === 'gift') appendGiftContent(messageElement, item);
    else appendMessageContent(messageElement, message, item.emotes);
    body.append(identity, messageElement);
    if (avatar) bubble.append(avatar);
    bubble.append(body);
    if (style === 'moonlit') {
      decorateMoonlitMessage(document, bubble, item, { avatar, body, identity, message: messageElement });
    }
    if (style === 'sketch') decorateSketchMessage(document, bubble, item);
    return bubble;
  }

  function appendGiftContent(rootElement, item) {
    rootElement.className = 'draw-danmaku-gift';
    const art = document.createElement('span');
    art.className = 'draw-danmaku-gift-art';
    art.setAttribute('aria-hidden', 'true');
    const giftSource = style === 'prismatic' ? '' : options.resolveGiftImageUrl?.(item.giftImageUrl);
    if (giftSource) {
      const image = document.createElement('img');
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      image.hidden = true;
      image.addEventListener('load', () => {
        image.hidden = false;
        // Styles that tint their artwork through a mask must not clip the real gift.
        art.className = 'draw-danmaku-gift-art has-image';
        art.style.setProperty('background-image', 'none');
      });
      image.addEventListener('error', () => {
        image.remove();
        art.className = 'draw-danmaku-gift-art';
        art.style.setProperty('background-image', '');
      });
      image.src = giftSource;
      art.append(image);
    }
    const copy = document.createElement('span');
    copy.className = 'draw-danmaku-gift-copy';
    const action = document.createElement('span');
    action.className = 'draw-danmaku-gift-action';
    action.textContent = style === 'prismatic' ? '赠送了' : style === 'starlight' ? '赠送' : '送出';
    const name = document.createElement('strong');
    name.className = 'draw-danmaku-gift-name';
    name.textContent = String(item.giftName || '礼物');
    const count = document.createElement('b');
    count.className = 'draw-danmaku-gift-count';
    count.textContent = style === 'starlight' ? `x${item.giftCount}` : `× ${item.giftCount}`;
    copy.append(action, name);
    if (showGiftTotal || style === 'prismatic') {
      const amount = document.createElement('b');
      amount.className = 'draw-danmaku-gift-amount';
      const total = Number.isFinite(item.giftTotalPrice) && item.giftTotalPrice >= 0
        ? item.giftTotalPrice.toLocaleString('zh-CN', { minimumFractionDigits: style === 'sketch' ? 2 : 0, maximumFractionDigits: 2 }) : null;
      amount.textContent = total === null ? '—' : ['whiteframe', 'sketch'].includes(style) ? `${total}¥` : `¥${total}`;
      if (style !== 'prismatic' || Number(item.giftCount) > 1) copy.append(count);
      if (style !== 'prismatic') rootElement.append(art);
      rootElement.append(copy, amount);
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
    if (style === 'prismatic') return createPrismaticIdentity(document, item, name, classNames, resolveEmoteUrl);
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
        const medalLevel = Math.max(0, Math.trunc(Number(item.medalLevel)) || 0);
        const medal = createBadge('', classNames.medal);
        const medalNameElement = document.createElement('span');
        medalNameElement.className = 'draw-danmaku-medal-name';
        medalNameElement.textContent = medalLevel > 0 ? `${medalName} ` : medalName;
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
      if (match.index > cursor) appendText(rootElement, message.slice(cursor, match.index));
      rootElement.append(createEmoteImage(match.emote));
      cursor = match.index + match.emote.text.length;
    }
  }

  function appendText(rootElement, text) {
    if (!text) return;
    rootElement.append(createTextSpan(text));
  }

  function createEmoteImage(emote) {
    const source = String(resolveEmoteUrl(emote.url) || '');
    if (!source) return createTextSpan(emote.text);
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
      image.replaceWith(createTextSpan(emote.text));
    });
    return image;
  }

  function createTextSpan(text) {
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
      kind: item.kind === 'inline' || item.kind === 'sticker' ? item.kind : undefined,
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
    if (!next || index < next.index || (index === next.index && emote.text.length > next.emote.text.length)) {
      next = { index, emote };
    }
  }
  return next;
}

function isEmoteOnlyMessage(message, emotes, requireSticker = false) {
  const tokens = normalizeRenderableEmotes(emotes);
  return tokens.length === 1 && tokens[0].text === message
    && (requireSticker ? tokens[0].kind === 'sticker' : tokens[0].kind !== 'inline');
}

function identityVariant(guardLevel, medalName) {
  if (Number(guardLevel) === 3) return 'captain';
  if (Number(guardLevel) === 2) return 'admiral';
  if (Number(guardLevel) === 1) return 'governor';
  return String(medalName || '').trim() ? 'fan' : 'viewer';
}
