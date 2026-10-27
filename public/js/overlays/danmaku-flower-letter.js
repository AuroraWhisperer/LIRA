import { setGuardIcon } from '../shared/bilibili-guard-icons.js';

const ART = '/img/overlays/danmaku-flower-letter/';
const GUARDS = Object.freeze({ 1: ['governor', '总督'], 2: ['admiral', '提督'], 3: ['captain', '舰长'] });
const HEIGHTS = Object.freeze({ ordinary: 218, letter: 226, gift: 252, superchat: 207, 'small-gift': 106 });
const CLOCK = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function image(document, source, className) {
  const element = node(document, 'img', className);
  element.alt = '';
  if (source) element.src = source;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function portrait(document, item, resolveAvatarUrl, event) {
  const root = node(document, 'span', event ? 'flower-crest-avatar' : 'flower-avatar');
  root.setAttribute('aria-hidden', 'true');
  root.append(node(document, 'span', 'flower-avatar-fallback', Array.from(String(item.name || '观众'))[0]));
  const source = item.avatarUrl && resolveAvatarUrl(item.avatarUrl);
  if (source) {
    const avatar = image(document, source, 'flower-avatar-image');
    avatar.referrerPolicy = 'no-referrer';
    avatar.decoding = 'async';
    avatar.addEventListener('error', () => avatar.remove(), { once: true });
    root.append(avatar);
  }
  return root;
}

function identity(document, root, item, level, salutation) {
  const date = new Date(item.timestamp ?? NaN);
  if (Number.isFinite(date.getTime())) root.append(node(document, 'time', 'flower-time', CLOCK.format(date)));
  if (salutation) root.append(node(document, 'span', 'flower-salutation', salutation));
  const name = node(document, 'span', 'flower-nickname', item.name || '观众');
  root.append(name);
  const medal = item.roomMedal?.level;
  if (Number.isInteger(medal) && medal > 0) root.append(node(document, 'span', 'flower-medal', `lv.${medal}`));
  if (GUARDS[level]) {
    const icon = image(document, '', 'flower-guard-icon');
    icon.alt = GUARDS[level][1];
    setGuardIcon(icon, level);
    root.append(icon);
  }
  return name;
}

function amountText(value) {
  return Number.isFinite(value) && value >= 0
    ? `CN¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '';
}

// Composition only. Safe text/emote rendering and the feed lifecycle stay with their existing owners.
export function createFlowerLetterMessageRenderer(options, render) {
  const { document } = options;
  const resolveAvatarUrl = options.resolveAvatarUrl || (value => value);
  return (item = {}, index = 0) => {
    const bought = item.kind === 'gift' ? GUARDS[item.giftGuardLevel] : null;
    const guard = GUARDS[item.roomGuardLevel];
    const role = bought?.[0] || guard?.[0] || (item.roomMedal?.level > 0 ? 'fan' : 'ordinary');
    const kind = bought ? 'join' : item.kind === 'superchat' ? 'superchat'
      : item.kind === 'gift' ? (item.giftTotalPrice === 0 ? 'small-gift' : 'gift')
        : role === 'ordinary' ? 'ordinary' : 'letter';
    const variant = kind === 'join' ? `${role}-join` : kind === 'letter' ? role : kind;
    const height = kind === 'join' ? (role === 'captain' ? 380 : 314) : HEIGHTS[kind];
    // Render the message as plain chat to reuse the canonical token/emote renderer, including SC.
    const root = render({ ...item, kind: 'danmaku' }, index);
    const copy = root.querySelector(`.${options.classNames.body}`).children[1];
    root.replaceChildren();
    root.classList.add('flower-letter-item', `flower-${kind}`);
    if (['gift', 'small-gift', 'join'].includes(kind)) root.classList.add('is-gift');
    if (kind === 'superchat') root.classList.add('is-superchat');
    root.dataset.flowerRole = role;
    root.style.setProperty('--flower-base-height', `${height}px`);
    root.style.setProperty('--flower-bottom-height', `${height - 60}px`);
    for (const part of ['top', 'middle', 'bottom']) {
      root.append(image(document, `${ART}${variant}-paper-${part}.svg`, `flower-paper flower-paper-${part}`));
    }
    const decoration = image(document, `${ART}${variant}-decoration.svg`, 'flower-decoration');
    decoration.style.setProperty('height', `${height}px`);
    root.append(decoration);
    const content = node(document, 'div', `${options.classNames.body} flower-content`);
    copy.classList.add('flower-copy');
    if (kind === 'join') {
      const member = node(document, 'div', 'flower-member-name');
      identity(document, member, { name: item.name }, item.giftGuardLevel);
      content.append(member);
      const action = item.guardAction === 'open' ? '开通了' : item.guardAction === 'renew' ? '续费了' : '感谢支持';
      copy.textContent = `${action}${bought[1]}${role === 'captain' ? '' : '哦'}`;
      if (Number(item.giftCount) > 1) copy.textContent += ` ×${item.giftCount}`;
    } else if (kind === 'gift' || kind === 'small-gift' || kind === 'superchat') {
      if (kind !== 'superchat') {
        copy.replaceChildren();
        if (kind === 'small-gift') copy.append(node(document, 'span', 'flower-nickname', item.name || '观众'));
        const gift = node(document, 'span', 'flower-gift-description');
        gift.append(node(document, 'span', 'flower-gift-action', '赠送 '),
          node(document, 'span', 'flower-gift-name', item.giftName || '礼物'),
          node(document, 'span', 'flower-gift-count', `×${item.giftCount}`));
        copy.append(gift);
      }
      if (kind !== 'small-gift') {
        const from = node(document, 'div', 'flower-from');
        from.append(node(document, 'span', '', 'from '), node(document, 'span', 'flower-nickname', item.name || '观众'));
        content.append(from, node(document, 'div', 'flower-price', amountText(kind === 'superchat' ? item.price : item.giftTotalPrice)));
      }
    } else {
      const greeting = node(document, 'div', 'flower-greeting');
      const signature = node(document, 'div', 'flower-signature');
      if (kind === 'ordinary') {
        identity(document, greeting, item, 0, 'from');
        signature.textContent = 'To my Dear';
      } else {
        greeting.textContent = 'My Dear,';
        identity(document, signature, item, item.roomGuardLevel, 'Yours,');
      }
      const brush = node(document, 'span', 'flower-brush');
      brush.setAttribute('aria-hidden', 'true');
      copy.append(brush);
      content.append(greeting, signature);
    }
    if (kind !== 'small-gift') content.append(portrait(document, item, resolveAvatarUrl, ['gift', 'superchat', 'join'].includes(kind)));
    content.append(copy);
    root.append(content);
    return root;
  };
}
