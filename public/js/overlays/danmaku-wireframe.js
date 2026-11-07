import { setGuardIcon } from '../shared/bilibili-guard-icons.js';

const ROLES = Object.freeze({ 1: 'governor', 2: 'admiral', 3: 'captain' });
const LABELS = Object.freeze({ 1: '总督', 2: '提督', 3: '舰长' });
const RANKS = Object.freeze({ 1: 'I', 2: 'II', 3: 'III' });

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function decoration(document, className) {
  const element = node(document, 'span', className);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function star(document, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M10 0 13 7 20 10 13 13 10 20 7 13 0 10 7 7Z');
  svg.append(path);
  return svg;
}

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `CN¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}` : '—';
}

function guardIcon(document, level) {
  const image = node(document, 'img', 'wireframe-guard');
  image.alt = LABELS[level];
  setGuardIcon(image, level);
  return image;
}

export function createWireframeMessageRenderer(options, render) {
  const { document, classNames } = options;
  return (item = {}, index = 0) => {
    if (item.kind === 'superchat') return render(item, index);
    // Reuse the common safe text/emote and avatar builders, then compose this layout.
    const root = render({ ...item, kind: 'danmaku' }, index);
    const copy = root.querySelector(`.${classNames.body}`).children[1];
    const avatar = root.querySelector(`.${classNames.avatar}`);
    return decorate(document, root, item, copy, avatar, classNames);
  };
}

export function createWireframeSuperChat(document, root, item, copy, avatar, classNames) {
  return decorate(document, root, item, copy, avatar, classNames);
}

function decorate(document, root, item, copy, avatar, classNames) {
  const sc = item.kind === 'superchat';
  const gift = item.kind === 'gift';
  const bought = gift && Object.hasOwn(ROLES, item.giftGuardLevel);
  const level = bought ? item.giftGuardLevel : item.roomGuardLevel;
  const kind = sc ? 'superchat' : bought ? 'member' : gift ? 'gift'
    : ['entry', 'system'].includes(item.kind) ? 'notice' : 'chat';
  const role = (gift || sc) && !bought ? 'viewer'
    : ROLES[level] || (item.isStreamer === true ? 'streamer' : 'viewer');
  const name = String(item.name || '观众').trim() || '观众';
  const emoteOnly = root.classList.contains('is-emote-only');
  root.className = `${classNames.item} wireframe-item${sc ? ' is-superchat' : ''}${emoteOnly ? ' is-emote-only' : ''}`;
  root.dataset.wireframeKind = kind;
  root.dataset.role = role;
  root.dataset.wireframeEntrance = document.body?.dataset.wireframeEntrance || 'traced';
  root.style.setProperty('--wireframe-entry-factor', String(Number(document.body?.dataset.wireframeEntranceMs || 700) / 700));
  root.style.setProperty('--danmaku-delay', '0ms');

  const portrait = node(document, 'div', 'wireframe-avatar');
  if (avatar) {
    avatar.className = 'wireframe-face';
    portrait.append(avatar);
  }
  portrait.append(decoration(document, 'wireframe-orbit'));
  const body = node(document, 'div', `${classNames.body} wireframe-body`);
  body.append(decoration(document, 'wireframe-surface'), decoration(document, 'wireframe-frame'));
  const identity = node(document, 'div', `${classNames.identity} wireframe-identity`);
  const sender = node(document, 'strong', 'wireframe-name', name);
  sender.title = name;
  identity.append(sender);
  copy.className = `wireframe-copy${sc ? ' sc-copy' : ''}`;

  if (bought) {
    const action = ({ open: '开通', renew: '续费' })[item.guardAction] || '支持';
    root.setAttribute('aria-label', `${name}${action}${LABELS[level]} × ${item.giftCount ?? 1}`);
    body.append(decoration(document, 'wireframe-wings wireframe-wings--left'),
      decoration(document, 'wireframe-wings wireframe-wings--right'));
    for (const side of ['left', 'right']) {
      body.append(node(document, 'span', `wireframe-member-rank wireframe-member-rank--${side}`, RANKS[level]));
    }
    copy.replaceChildren(star(document, 'wireframe-star'),
      node(document, 'span', 'wireframe-member-label', `${LABELS[level]}已入列`), star(document, 'wireframe-star'));
    body.append(portrait, identity, guardIcon(document, level), copy);
    root.replaceChildren(body);
    return root;
  }

  if (gift || sc) {
    const price = amount(sc ? item.price : item.giftTotalPrice);
    identity.replaceChildren(portrait, sender, node(document, 'span', 'wireframe-amount', price));
    if (sc) root.setAttribute('aria-label', `醒目留言，${price}`);
    else copy.textContent = `投喂 ${item.giftName || '礼物'}x${item.giftCount ?? 1}`;
    body.append(identity, decoration(document, 'wireframe-divider'), copy);
    root.replaceChildren(body);
    return root;
  }

  if (ROLES[level]) {
    const rank = node(document, 'span', 'wireframe-rank');
    rank.setAttribute('aria-label', LABELS[level]);
    if (role === 'governor') rank.append(star(document, 'wireframe-star'));
    rank.append(node(document, 'span', 'wireframe-rank-number', RANKS[level]));
    if (role === 'governor') rank.append(star(document, 'wireframe-star'));
    identity.append(guardIcon(document, level), rank);
  } else if (item.isStreamer === true) {
    identity.append(node(document, 'span', 'wireframe-medal', '主播'));
  } else if (Number.isSafeInteger(item.roomMedal?.level) && item.roomMedal.level > 0) {
    identity.append(node(document, 'span', 'wireframe-medal', `${item.roomMedal.name || '粉丝团'} ${item.roomMedal.level}`));
  }
  body.append(identity, copy);
  if (role === 'governor') {
    body.append(star(document, 'wireframe-corner wireframe-corner--start'), star(document, 'wireframe-corner wireframe-corner--end'));
  }
  if (role === 'admiral') body.append(decoration(document, 'wireframe-ticks'));
  if (kind === 'notice') {
    body.replaceChildren(copy);
    root.replaceChildren(body);
  } else root.replaceChildren(portrait, body);
  return root;
}
