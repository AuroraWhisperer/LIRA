const ART = '/img/overlays/danmaku-notebook/';
const GUARDS = { 1: ['governor', '总督'], 2: ['admiral', '提督'], 3: ['captain', '舰长'] };

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function guard(value) {
  return GUARDS[Number(value)] || ['ordinary', ''];
}

function portrait(document, avatar) {
  const float = node(document, 'div', 'notebook-portrait-float');
  const sway = node(document, 'div', 'notebook-portrait-sway');
  const enter = node(document, 'div', 'notebook-portrait-enter');
  const pulse = node(document, 'div', 'notebook-portrait-pulse');
  avatar.classList.add('notebook-avatar');
  const frame = node(document, 'span', 'notebook-avatar-frame');
  frame.setAttribute('aria-hidden', 'true');
  pulse.append(avatar, frame);
  enter.append(pulse);
  sway.append(enter);
  float.append(sway);
  return float;
}

function amount(document, value) {
  if (!Number.isFinite(value) || value < 0) return null;
  return node(document, 'span', 'notebook-amount', `CN¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: value < 1000 ? 1 : 0, maximumFractionDigits: 2,
  })}`);
}

function superchatAvatar(document, item, options) {
  if (!(options.showAvatar ?? !options.fullscreen)) return null;
  const avatar = node(document, 'div', options.classNames.avatar);
  const source = item.avatarUrl && (options.resolveAvatarUrl ? options.resolveAvatarUrl(item.avatarUrl) : item.avatarUrl);
  if (source) {
    const image = node(document, 'img', '');
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = source;
    avatar.append(image);
  }
  return avatar;
}

// Recompose safe content from the shared renderer; this module owns no feed or timers.
export function createNotebookMessageRenderer(options, render) {
  const { document, classNames } = options;
  return (item = {}, index = 0) => {
    const roomGuard = Number(item.roomGuardLevel);
    const boughtGuard = item.kind === 'gift' && GUARDS[Number(item.giftGuardLevel)] ? Number(item.giftGuardLevel) : 0;
    const sc = item.kind === 'superchat';
    const gift = item.kind === 'gift';
    const [role, label] = guard(boughtGuard || roomGuard);
    const medalLevel = Number(item.roomMedal?.level);
    const hasMedal = Number.isSafeInteger(medalLevel) && medalLevel > 0;
    const root = render({ ...item, guardLevel: GUARDS[roomGuard] ? roomGuard : 0,
      medalName: hasMedal ? String(item.roomMedal.name || '') : '', medalLevel: hasMedal ? medalLevel : 0 }, index);
    const originalBody = sc ? null : root.querySelector(`.${classNames.body}`);
    const copy = sc ? node(document, 'p', 'sc-copy', String(item.message ?? '')) : originalBody.children[1];
    const originalIdentity = sc ? null : originalBody.children[0];
    const avatar = sc ? superchatAvatar(document, item, options) : root.querySelector(`.${classNames.avatar}`);
    const identity = node(document, 'div', `${classNames.identity} notebook-heading`);
    const name = node(document, 'strong', 'notebook-name', String(item.name || '观众').trim() || '观众');
    identity.append(name);
    root.classList.add('notebook-item');
    root.dataset.notebookRole = gift && !boughtGuard ? 'ordinary' : role;
    root.dataset.notebookKind = sc ? 'sc' : boughtGuard ? 'member' : gift ? 'gift' : 'chat';
    root.style.setProperty('--danmaku-delay', '0ms');

    if (!gift && !sc) {
      const medal = originalIdentity.querySelector(`.${classNames.medal}`);
      if (medal) identity.append(medal);
    }
    if (label && !sc && (!gift || boughtGuard)) {
      const image = node(document, 'img', 'notebook-guard');
      image.alt = label;
      image.src = `${ART}badge-${role}.png`;
      identity.append(image);
    }
    if (boughtGuard) {
      const count = Number(item.giftCount);
      const action = item.guardAction === 'open' ? '感谢开通' : item.guardAction === 'renew' ? '感谢续费' : '感谢支持';
      copy.textContent = `${action}${label}${count > 1 ? ` ×${count}` : ''}`;
    } else if (gift) {
      copy.querySelector('.draw-danmaku-gift-art')?.remove();
      copy.querySelector('.draw-danmaku-gift-amount')?.remove();
      const action = copy.querySelector('.draw-danmaku-gift-action');
      const count = copy.querySelector('.draw-danmaku-gift-count');
      if (action) action.textContent = '投喂 ';
      if (count) count.textContent = `x${item.giftCount}`;
    }
    if (sc || gift && (!boughtGuard || options.showGiftTotal)) {
      const price = amount(document, sc ? Number(item.price) : item.giftTotalPrice);
      if (price) identity.append(price);
    }

    copy.classList.add('notebook-copy');
    const body = node(document, 'div', `${classNames.body} notebook-content`);
    body.append(identity, copy);
    const paperFloat = node(document, 'div', 'notebook-paper-float');
    const paper = node(document, 'div', 'notebook-paper');
    const base = node(document, 'span', 'notebook-paper-base');
    const tape = node(document, 'span', 'notebook-tape');
    base.setAttribute('aria-hidden', 'true');
    tape.setAttribute('aria-hidden', 'true');
    paper.append(base, tape, body);
    paperFloat.append(paper);
    root.replaceChildren();
    if (avatar && (options.showAvatar ?? !options.fullscreen)) root.append(portrait(document, avatar));
    else root.classList.add('notebook-no-avatar');
    root.append(paperFloat);
    return root;
  };
}
