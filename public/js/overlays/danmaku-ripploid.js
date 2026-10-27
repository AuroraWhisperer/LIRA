const SVG_NS = 'http://www.w3.org/2000/svg';
const GUARD_LABELS = Object.freeze({ 1: '总督', 2: '提督', 3: '舰长' });
const GUARD_SCRIPT = Object.freeze({ 1: 'Governor', 2: 'Admiral', 3: 'Captain' });
const GUARD_COLOR = Object.freeze({ 1: 'governor', 2: 'admiral', 3: 'captain' });
const PRICE_TIERS = Object.freeze([0, 50, 100, 500, 1000, 2000]);
let scTransitionSequence = 0;
const DEFAULT_CLASS_NAMES = Object.freeze({
  identity: 'draw-danmaku-identity',
  badge: 'draw-danmaku-badge',
  medal: 'draw-danmaku-medal',
  guard: 'draw-danmaku-guard',
});

function node(document, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function ornament(document, className) {
  return node(document, 'span', className);
}

function hidden(element) {
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function svgNode(document, tagName, attributes) {
  const element = document.createElementNS(SVG_NS, tagName);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function createGuardAnchor(document) {
  const anchor = svgNode(document, 'svg', {
    class: 'ripploid-anchor',
    viewBox: '0 0 10 10',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  anchor.append(
    svgNode(document, 'circle', { cx: '5', cy: '1.8', r: '1.15' }),
    svgNode(document, 'path', {
      d: 'M5 3 V8.6 M2.4 4.2 H7.6 M1.2 6.2 C1.4 8.1 2.8 9.1 5 9.1 C7.2 9.1 8.6 8.1 8.8 6.2 M1.2 6.2 L2.5 6.8 M8.8 6.2 L7.5 6.8',
    }),
  );
  return anchor;
}

function createAccentArrow(document) {
  const arrow = svgNode(document, 'svg', {
    class: 'ripploid-accent-arrow',
    viewBox: '0 0 10 16',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  arrow.append(
    svgNode(document, 'path', { class: 'ripploid-arrow-border', d: 'M1.5 1.5 L8 8 L1.5 14.5 Z' }),
    svgNode(document, 'path', { class: 'ripploid-arrow-shape', d: 'M1.5 3 L7 8 L1.5 13 Z' }),
  );
  return arrow;
}

// Pure artwork is reusable by other RIPPLOID event cards without their identity or copy.
export function createRipploidDecorations(document) {
  const decoration = hidden(node(document, 'div', 'ripploid-decoration'));
  const rules = node(document, 'div', 'ripploid-rules');
  for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    rules.append(ornament(document, `ripploid-stable-rule ripploid-stable-${position}`));
  }
  for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    rules.append(ornament(document, `ripploid-sweep-rule ripploid-sweep-${position}`));
  }
  for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    rules.append(ornament(document, `ripploid-rule-cap ripploid-cap-${position}`));
  }
  const accent = node(document, 'div', 'ripploid-accent');
  accent.append(ornament(document, 'ripploid-accent-stem'), createAccentArrow(document));
  decoration.append(rules, accent);
  return decoration;
}

function createUsernameStack(document, name) {
  const stack = node(document, 'div', 'ripploid-username-stack');
  const username = node(document, 'strong', 'ripploid-username ripploid-username-base', name);
  const reveal = node(document, 'strong', 'ripploid-username ripploid-username-reveal', name);
  reveal.setAttribute('aria-hidden', 'true');
  stack.append(username, reveal);
  return stack;
}

function createMedalBadge(document, medal, classNames) {
  const medalName = String(medal?.name || '').trim();
  if (!medalName || !Number.isSafeInteger(medal?.level) || medal.level <= 0) return null;
  const badge = ornament(document, `${classNames.badge} ${classNames.medal}`);
  badge.setAttribute('title', `当前直播间灯牌：${medalName} ${medal.level}级`);
  const name = ornament(document, 'draw-danmaku-medal-name');
  name.textContent = medalName;
  const separator = hidden(ornament(document, 'ripploid-medal-separator'));
  separator.textContent = '·';
  const level = node(document, 'b', 'draw-danmaku-medal-level', String(medal.level));
  badge.append(name, separator, level);
  return badge;
}

function createGuardBadge(document, guardLevel, classNames) {
  const label = GUARD_SCRIPT[Number(guardLevel)]?.toUpperCase();
  if (!label) return null;
  const badge = ornament(document, `${classNames.badge} ${classNames.guard}`);
  badge.setAttribute('title', `当前直播间大航海：${GUARD_LABELS[Number(guardLevel)]}`);
  const text = ornament(document, 'ripploid-guard-label');
  text.textContent = label;
  badge.append(createGuardAnchor(document), text);
  return badge;
}

function createHonorBadge(document, honorLevel, classNames) {
  if (!Number.isSafeInteger(honorLevel) || honorLevel <= 0) return null;
  const badge = ornament(document, `${classNames.badge} ripploid-honor-badge`);
  badge.setAttribute('title', `荣耀等级 ${honorLevel}`);
  badge.append(node(document, 'span', 'ripploid-honor-label', `UL${honorLevel}`));
  return badge;
}

export function createRipploidIdentity(document, item, name, classNames = DEFAULT_CLASS_NAMES) {
  const identity = node(document, 'div', classNames.identity);
  if (item.kind !== 'gift') {
    const badges = node(document, 'div', 'ripploid-badges');
    const medal = createMedalBadge(document, item.roomMedal, classNames);
    const honor = createHonorBadge(document, item.honorLevel, classNames);
    const guard = createGuardBadge(document, item.roomGuardLevel, classNames);
    if (medal) badges.append(medal);
    if (honor) badges.append(honor);
    if (guard) badges.append(guard);
    if (badges.children.length) identity.append(badges);
  }
  const username = String(name || '观众').trim() || '观众';
  identity.append(createUsernameStack(document, username));
  return identity;
}

function priceTier(value) {
  const amount = Number(value);
  const normalized = Number.isFinite(amount) && amount >= 0 ? amount : 0;
  return PRICE_TIERS.findLast((minimum) => normalized >= minimum) || 0;
}

function setEventAccent(element, kind, item) {
  const variable = kind === 'guard'
    ? `--ripploid-guard-color-${GUARD_COLOR[Number(item.giftGuardLevel)]}`
    : `--ripploid-${kind}-color${priceTier(kind === 'superchat' ? item.price : item.giftTotalPrice)}`;
  element.style.setProperty('--ripploid-event-accent', `var(${variable})`);
}

function formatAmount(value) {
  return Number.isFinite(value) && value >= 0
    ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    : '—';
}

function createEventWipe(document) {
  return hidden(ornament(document, 'ripploid-event-wipe'));
}

function createGiftPriceIcon(document) {
  const icon = hidden(svgNode(document, 'svg', { class: 'ripploid-gift-price-icon', viewBox: '0 0 12 12' }));
  icon.append(
    svgNode(document, 'rect', { width: '12', height: '12', fill: 'currentColor' }),
    svgNode(document, 'path', { d: 'M2.2 6.9 C3.1 4.7 5.7 5.8 6.1 3.4 C8.1 2.5 10.1 3.7 9.1 5.9 C8.2 8.1 4.5 9.8 2.2 6.9 Z', fill: '#262522' }),
  );
  return icon;
}

function createGiftFooterMarks(document) {
  const marks = hidden(svgNode(document, 'svg', { class: 'ripploid-gift-more', viewBox: '0 0 26 12' }));
  marks.append(
    svgNode(document, 'path', { d: 'M6 1.5 L8.8 3 L7.1 3.9 M9.3 4.5 L9.2 7.8 L7.5 7 M6.6 9.5 L3.5 9.4 L4 7.8 M2.1 7.3 L1.9 4.2 L3.6 4.8 M3.2 2.3 L6.1 1.2 L6.1 3', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linejoin': 'round' }),
    svgNode(document, 'circle', { cx: '20', cy: '6', r: '4.1', fill: 'none', stroke: 'currentColor', 'stroke-width': '.8' }),
    svgNode(document, 'path', { d: 'M20 1.9 A4.1 4.1 0 0 0 20 10.1 Z', fill: 'currentColor' }),
  );
  return marks;
}

function createTicketBarcode(document) {
  const barcode = hidden(node(document, 'div', 'ripploid-ticket-barcode'));
  const artwork = svgNode(document, 'svg', { viewBox: '0 0 100 24', preserveAspectRatio: 'none' });
  const widths = [2, 1, 1, 2, 3, 1, 1, 1, 2, 2, 1, 1, 3, 2, 1, 1, 2, 1, 1, 2, 3, 1, 2, 1, 1, 1, 3, 2, 2, 1, 1, 2, 1, 1, 3, 1, 2, 2, 1, 1, 2, 1, 3, 1, 1, 2, 2, 1, 1, 1, 2, 1, 3, 1, 1, 1, 2, 1, 1, 2, 3];
  let x = 0;
  widths.forEach((width, index) => {
    if (index % 2 === 0) artwork.append(svgNode(document, 'rect', { x: String(x), width: String(width), height: '24', fill: 'currentColor' }));
    x += width;
  });
  artwork.setAttribute('viewBox', `0 0 ${x} 24`);
  barcode.append(artwork);
  return barcode;
}

function decorateRipploidSystem(document, bubble, item, { body, message }) {
  bubble.classList.add('ripploid-system');
  const label = node(document, 'span', 'ripploid-system-label', item.kind === 'entry' ? `[进房]：${item.name || '观众'} ` : '[系统]：');
  const copy = node(document, 'div', 'ripploid-system-copy');
  copy.append(label, message);
  body.replaceChildren(copy);
  bubble.append(hidden(ornament(document, 'ripploid-system-wipe')));
}

function decorateRipploidGift(document, bubble, item, { body }) {
  const name = String(item.name || '观众').trim() || '观众';
  const giftName = String(item.giftName || '礼物').trim() || '礼物';
  const giftCount = String(item.giftCount ?? '').trim();
  bubble.classList.add('ripploid-event-root', 'ripploid-gift');
  setEventAccent(bubble, 'gift', item);
  body.classList.add('ripploid-event-stage', 'ripploid-wipe-stage', 'ripploid-gift-stage');

  const main = node(document, 'div', 'ripploid-gift-main');
  main.append(node(document, 'strong', 'ripploid-gift-label', 'GIFT'));
  const nameFrame = node(document, 'div', 'ripploid-gift-name-frame');
  const nameCopy = node(document, 'div', 'ripploid-gift-name-copy');
  const giftTitle = node(document, 'strong', 'ripploid-gift-name', giftName);
  nameCopy.append(giftTitle);
  if (giftCount) nameCopy.append(node(document, 'span', 'ripploid-gift-count', `×${giftCount}`));
  nameFrame.append(nameCopy, hidden(ornament(document, 'ripploid-gift-chevrons')));
  const price = node(document, 'div', 'ripploid-gift-price');
  price.append(createGiftPriceIcon(document));
  price.append(node(document, 'span', 'ripploid-gift-price-value', formatAmount(item.giftTotalPrice)));
  const unit = node(document, 'span', 'ripploid-gift-price-unit');
  unit.append(node(document, 'span', 'ripploid-gift-price-unit-text', 'RMB'), hidden(ornament(document, 'ripploid-gift-price-scramble')));
  price.append(unit);
  main.append(nameFrame, price, createGiftFooterMarks(document));

  const ticket = node(document, 'div', 'ripploid-gift-ticket');
  const title = node(document, 'strong', 'ripploid-ticket-title');
  title.append(node(document, 'span', '', 'GIFT'), node(document, 'span', '', 'TICKET'));
  ticket.append(title);
  const from = node(document, 'div', 'ripploid-ticket-from');
  from.append(node(document, 'small', 'ripploid-ticket-from-label', '» FROM'));
  const signature = node(document, 'div', 'ripploid-ticket-signature', name);
  from.append(signature);
  ticket.append(from, createTicketBarcode(document));
  body.replaceChildren(main, ticket);
  bubble.append(createEventWipe(document));
}

export function decorateRipploidMessage(document, bubble, item, { identity, body, message, classNames }) {
  const classes = classNames || { ...DEFAULT_CLASS_NAMES, identity: identity.className };
  if (item.kind === 'entry' || item.kind === 'system') {
    decorateRipploidSystem(document, bubble, item, { body, message });
    return;
  }
  if (item.kind === 'gift') {
    decorateRipploidGift(document, bubble, item, { body });
    return;
  }
  const name = identity.children[0]?.textContent || item.name;
  const nextIdentity = createRipploidIdentity(document, item, name, classes);
  const copyWrap = node(document, 'div', 'ripploid-copy-wrap');
  const wipe = hidden(ornament(document, 'ripploid-wipe'));
  copyWrap.append(wipe, message);
  bubble.classList.add('ripploid-chat');
  bubble.append(createRipploidDecorations(document));
  body.replaceChildren(copyWrap, nextIdentity);
}

export function createRipploidGuardCard(document, item, classNames, resolveAvatarUrl = (value) => value, showAvatar = true) {
  const level = Number(item.giftGuardLevel);
  const role = GUARD_LABELS[level];
  const script = GUARD_SCRIPT[level];
  const name = String(item.name || '观众').trim() || '观众';
  const root = node(document, 'article', `${classNames.item} ripploid-event-root ripploid-member`);
  root.dataset.guard = String(level);
  root.style.setProperty('--danmaku-delay', '0ms');
  root.setAttribute('aria-label', `NEW MEMBER，${role}，${name}`);
  setEventAccent(root, 'guard', item);

  const stage = node(document, 'div', `${classNames.body} ripploid-event-stage ripploid-wipe-stage ripploid-member-stage`);
  const passport = hidden(node(document, 'div', 'ripploid-member-passport'));
  passport.append(
    ornament(document, 'ripploid-passport-square'),
    node(document, 'span', 'ripploid-passport-number', String(level).padStart(2, '0')),
    node(document, 'span', 'ripploid-passport-copy', 'PASSPORT'),
    node(document, 'span', 'ripploid-passport-ticket', 'TICKET'),
  );
  const heading = node(document, 'div', 'ripploid-member-heading');
  const firstLine = node(document, 'div', 'ripploid-member-new-line');
  firstLine.append(node(document, 'strong', 'ripploid-member-new', 'NEW'), node(document, 'span', 'ripploid-member-tag', '新会员'));
  heading.append(firstLine, node(document, 'strong', 'ripploid-member-title', 'MEMBER'));
  heading.append(node(document, 'span', 'ripploid-member-role', script));

  const sender = node(document, 'div', 'ripploid-member-sender');
  const emblem = hidden(ornament(document, 'ripploid-member-emblem'));
  const emblemBorder = svgNode(document, 'svg', { class: 'ripploid-member-emblem-border', viewBox: '0 0 27 30' });
  emblemBorder.append(svgNode(document, 'polygon', { points: '13.5,1 25.2,7.8 25.2,22.2 13.5,29 1.8,22.2 1.8,7.8', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.1' }));
  emblem.append(emblemBorder, createGuardAnchor(document));
  sender.append(
    emblem,
    hidden(ornament(document, 'ripploid-member-mini-badge')),
    node(document, 'strong', 'ripploid-member-name', name),
  );

  const avatarClip = hidden(node(document, 'div', 'ripploid-member-avatar-clip'));
  if (showAvatar) {
    const avatar = node(document, 'div', 'ripploid-member-avatar', Array.from(name)[0] || '观');
    const source = String(resolveAvatarUrl(item.avatarUrl) || '');
    if (source) {
      const image = document.createElement('img');
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      image.addEventListener('error', () => image.remove());
      image.src = source;
      avatar.append(image, ornament(document, 'ripploid-member-avatar-tint'), ornament(document, 'ripploid-member-avatar-dots'));
    }
    avatarClip.append(avatar);
  }
  const diamonds = hidden(ornament(document, 'ripploid-member-diamonds'));
  stage.append(passport, heading, sender, avatarClip, diamonds);
  root.append(stage, createEventWipe(document));
  return root;
}

export function createRipploidSuperChat(document, root, card, { item, name, price, copy, amount }) {
  root.classList.add('ripploid-event-root', 'ripploid-superchat');
  card.classList.add('ripploid-event-stage', 'ripploid-sc-stage');
  setEventAccent(root, 'superchat', item);

  const stable = node(document, 'div', 'ripploid-sc-stable');
  const header = node(document, 'header', 'ripploid-sc-header');
  const senderMeta = node(document, 'div', 'ripploid-sc-sender-meta');
  senderMeta.append(node(document, 'span', 'ripploid-sc-sender-label', '# SENDER'), hidden(ornament(document, 'ripploid-sc-sender-rule')));
  const sender = node(document, 'div', 'ripploid-sc-sender-line');
  sender.append(
    hidden(ornament(document, 'ripploid-sc-sender-wipe')),
    node(document, 'strong', 'sc-name ripploid-sc-sender', name),
    hidden(ornament(document, 'ripploid-sc-sender-check')),
    hidden(ornament(document, 'ripploid-sc-sender-mark')),
  );
  header.append(senderMeta, sender);

  const panel = node(document, 'div', 'ripploid-sc-message-panel');
  panel.append(hidden(ornament(document, 'ripploid-sc-corner')), copy);
  amount.replaceChildren(
    node(document, 'span', 'sc-value', price),
    node(document, 'span', 'sc-currency', 'RMB'),
  );
  amount.classList.add('ripploid-sc-amount');
  const amountRing = hidden(svgNode(document, 'svg', { class: 'ripploid-sc-amount-ring', viewBox: '0 0 76 25', preserveAspectRatio: 'none' }));
  amountRing.append(svgNode(document, 'path', { d: 'M3 13 C2 1 66 0 72 11 C78 25 11 28 3 13 M8 4 C29 -1 65 5 74 13', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2' }));
  amount.append(amountRing);
  const footer = node(document, 'footer', 'ripploid-sc-footer');
  footer.append(node(document, 'span', 'ripploid-sc-footer-copy', 'SC / MESSAGE'), amount);
  stable.append(header, panel, footer);

  const transition = hidden(node(document, 'div', 'ripploid-sc-transition'));
  const sequence = ++scTransitionSequence;
  const titleClipId = `ripploid-sc-title-clip-${sequence}`;
  const titleMaskId = `ripploid-sc-title-mask-${sequence}`;
  const artwork = svgNode(document, 'svg', {
    class: 'ripploid-sc-tear-art',
    viewBox: '0 0 1000 240',
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  artwork.append(
    svgNode(document, 'path', {
      class: 'ripploid-sc-tear-fringe',
      d: 'M0 -34 C35 -34 55 -34 90 -34 C125 -34 150 -34 185 -34 C220 -34 250 -34 285 -34 C320 -34 350 -34 390 -34 C430 -34 455 -34 495 -34 C535 -34 565 -34 610 -34 C650 -34 690 -34 730 -34 C770 -34 805 -34 845 -34 C885 -34 915 -34 950 -34 C970 -34 985 -34 1000 -34 L1000 280 L0 280 Z',
    }),
    svgNode(document, 'path', {
      class: 'ripploid-sc-tear-fill',
      d: 'M0 -20 C35 -20 55 -20 90 -20 C125 -20 150 -20 185 -20 C220 -20 250 -20 285 -20 C320 -20 350 -20 390 -20 C430 -20 455 -20 495 -20 C535 -20 565 -20 610 -20 C650 -20 690 -20 730 -20 C770 -20 805 -20 845 -20 C885 -20 915 -20 950 -20 C970 -20 985 -20 1000 -20 L1000 280 L0 280 Z',
    }),
    svgNode(document, 'path', {
      class: 'ripploid-sc-silhouette',
      d: 'M0 160 C25 148 44 210 90 178 C132 148 142 82 185 110 C232 140 244 214 285 192 C330 168 346 124 390 146 C436 168 452 224 495 196 C542 166 560 106 610 130 C660 154 682 214 730 184 C780 154 802 94 845 122 C892 150 916 204 950 178 C974 160 988 150 1000 156 L1000 280 L0 280 Z',
    }),
  );
  // Reuse the animated artwork so the title stays on the orange paper through both tears.
  const definitions = svgNode(document, 'defs', {});
  const titleClip = svgNode(document, 'clipPath', { id: titleClipId, clipPathUnits: 'objectBoundingBox' });
  titleClip.append(svgNode(document, 'path', { class: 'ripploid-sc-tear-fill', transform: 'scale(.001 .004166667)' }));
  const titleMask = svgNode(document, 'mask', { id: titleMaskId, x: '0', y: '0', width: '1', height: '1', maskUnits: 'objectBoundingBox', maskContentUnits: 'objectBoundingBox' });
  const silhouetteMask = svgNode(document, 'g', { transform: 'scale(.001 .004166667)' });
  silhouetteMask.append(svgNode(document, 'path', { class: 'ripploid-sc-silhouette', style: 'filter:brightness(0)' }));
  titleMask.append(
    svgNode(document, 'rect', { width: '1', height: '1', fill: '#fff' }),
    silhouetteMask,
  );
  definitions.append(titleClip, titleMask);
  artwork.append(definitions);
  const title = node(document, 'div', 'ripploid-sc-transition-title');
  title.style.clipPath = `url(#${titleClipId})`;
  title.style.mask = `url(#${titleMaskId})`;
  title.append(
    node(document, 'span', 'ripploid-sc-title-outline', `SC ${price}RMB`),
    node(document, 'span', 'ripploid-sc-title-fill', `SC ${price}RMB`),
  );
  transition.append(artwork, title);
  card.append(stable, transition);
}
