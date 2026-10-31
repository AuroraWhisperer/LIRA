import { parseHexColor } from '../shared/color-value.js';

const ART = '/img/overlays/danmaku-spooky/';
const GUARDS = Object.freeze({ 1: '总督', 2: '提督', 3: '舰长' });

// Match color-mix(in srgb), including premultiplied alpha for translucent colors.
function mixColor(first, second, weight) {
  const firstAlpha = first.alpha * weight;
  const secondAlpha = second.alpha * (1 - weight);
  const alpha = firstAlpha + secondAlpha;
  const channel = key => alpha ? (first[key] * firstAlpha + second[key] * secondAlpha) / alpha : 0;
  return { r: channel('r'), g: channel('g'), b: channel('b'), alpha };
}

export function applySpookyColorFallback(document) {
  const view = document.defaultView;
  if (view?.CSS?.supports('color', 'color-mix(in srgb, black, white)') !== false) return;
  const style = view.getComputedStyle(document.body);
  const color = name => parseHexColor(style.getPropertyValue(`--spooky-${name}`).trim());
  const setColor = (name, value, opacity = 1) => document.documentElement.style.setProperty(
    `--spooky-fallback-${name}`, `rgba(${value.r}, ${value.g}, ${value.b}, ${value.alpha * opacity})`,
  );
  const paper = color('paper');
  const accent = color('custom-accent-color');
  const light = accent ? mixColor(accent, parseHexColor('#ffffff'), .55) : color('light');
  const frame = color('custom-frame-color') || color('frame');
  const message = color('custom-message-color') || color('left');
  const messageRight = color('custom-message-color') ? mixColor(message, parseHexColor('#000000'), .65) : color('right');
  const event = color('custom-event-color') || color('alert');
  const frameOpacity = parseFloat(style.getPropertyValue('--spooky-frame-weight')) / 100;
  const messageOpacity = parseFloat(style.getPropertyValue('--spooky-message-weight')) / 100;
  const eventOpacity = parseFloat(style.getPropertyValue('--spooky-event-weight')) / 100;

  setColor('decor-light', light);
  setColor('edge', accent ? mixColor(accent, parseHexColor('#ffffff'), .45) : color('edge'));
  for (const [layer, opacity] of [['frame', frameOpacity], ['message', messageOpacity], ['event', eventOpacity]]) {
    setColor(`${layer}-paper-light`, light, opacity);
    setColor(`${layer}-paper`, paper, opacity);
  }
  setColor('frame-start', mixColor(frame, paper, .92), frameOpacity);
  setColor('frame-end', frame, frameOpacity);
  setColor('message-start', message, messageOpacity);
  setColor('message-end', messageRight, messageOpacity);
  setColor('message-front', mixColor(message, paper, .9), messageOpacity);
  setColor('event', event, eventOpacity);
  setColor('event-front', mixColor(color('custom-event-color') || color('right'), paper, .85), eventOpacity);
}

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function ornament(document, name, className) {
  const image = node(document, 'img', className);
  image.src = `${ART}${name}.svg`;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  return image;
}

function guardLevel(value) {
  const level = Number(value);
  return Object.hasOwn(GUARDS, level) ? level : 0;
}

function portrait(document, item, resolveAvatarUrl) {
  const root = node(document, 'span', 'spooky-portrait');
  root.setAttribute('aria-hidden', 'true');
  const source = item.avatarUrl && resolveAvatarUrl(item.avatarUrl);
  if (source) {
    const image = node(document, 'img', 'spooky-avatar');
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = source;
    root.append(image);
  }
  return root;
}

function shell(document, root, event, guarded) {
  root.classList.add('spooky-item');
  root.dataset.spookyGuard = String(Boolean(guarded));
  if (event) root.classList.add('spooky-event');
  const stack = node(document, 'div', 'spooky-stack');
  const board = node(document, 'div', 'draw-danmaku-body spooky-board');
  board.append(node(document, 'span', 'spooky-front-paper'), node(document, 'span', 'spooky-web'), node(document, 'span', 'spooky-star'));
  stack.append(node(document, 'span', 'spooky-back-paper'), node(document, 'span', 'spooky-bookmark'), board);
  const sticker = ornament(document, event ? 'bat' : guarded ? 'ghost' : 'skull', 'spooky-sticker');
  stack.append(sticker);
  if (guarded && !event) stack.append(node(document, 'span', 'spooky-twinkle'));
  return { stack, board };
}

function eventHeader(document, stack, board, item, eventText, resolveAvatarUrl) {
  const head = node(document, 'div', 'spooky-event-head');
  const copy = typeof eventText === 'string' ? node(document, 'p', 'spooky-event-copy', eventText) : eventText;
  head.append(node(document, 'strong', 'spooky-event-name', String(item.name || '观众')),
    node(document, 'hr', 'spooky-rule'), copy);
  board.append(head);
  const dots = node(document, 'span', 'spooky-event-dots');
  dots.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 4; index += 1) dots.append(node(document, 'i', '', '•'));
  stack.append(node(document, 'span', 'spooky-portrait-paper'), portrait(document, item, resolveAvatarUrl), dots);
}

// Artwork and message composition only; the shared feed owns the queue and layout.
export function createSpookyMessageRenderer(options, render) {
  const { document, classNames } = options;
  const resolveAvatarUrl = options.resolveAvatarUrl || (value => value);
  return (item = {}, index = 0) => {
    if (item.kind === 'superchat') {
      const root = node(document, 'article', `${classNames.item} is-superchat spooky-sc`);
      const price = Number(item.price || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
      root.setAttribute('aria-label', `醒目留言，¥${price}`);
      const { stack, board } = shell(document, root, true, false);
      eventHeader(document, stack, board, item, `醒目留言 ¥${price}`, resolveAvatarUrl);
      board.append(node(document, 'p', 'spooky-sc-copy', String(item.message ?? '')));
      root.append(stack);
      return root;
    }
    const root = render(item, index);
    const originalBody = root.querySelector(`.${classNames.body}`);
    const copy = originalBody.children[1];
    const boughtGuard = item.kind === 'gift' ? guardLevel(item.giftGuardLevel) : 0;
    const roomGuard = guardLevel(item.roomGuardLevel ?? item.guardLevel);
    const gift = item.kind === 'gift';
    const { stack, board } = shell(document, root, gift, roomGuard);
    root.replaceChildren();
    if (gift) {
      if (boughtGuard) {
        const count = Number(item.giftCount);
        const suffix = count > 1 ? ` ×${count}` : '';
        const total = Number(item.giftTotalPrice);
        const amount = total > 0 ? ` · ¥${total.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '';
        copy.textContent = `开通 ${GUARDS[boughtGuard]}${suffix}${amount}`;
      }
      copy.classList.add('spooky-event-copy');
      eventHeader(document, stack, board, item, copy, resolveAvatarUrl);
    } else {
      const identity = node(document, 'div', `${classNames.identity} spooky-identity`);
      identity.append(node(document, 'span', 'spooky-name-dots', '••'),
        node(document, 'strong', 'spooky-name', String(item.name || '观众')));
      if (roomGuard) identity.append(node(document, 'span', 'spooky-role', GUARDS[roomGuard]));
      root.append(identity);
      copy.classList.add('spooky-copy');
      board.append(copy);
      if (['entry', 'system'].includes(item.kind)) root.classList.add('spooky-notice');
    }
    root.append(stack);
    return root;
  };
}
