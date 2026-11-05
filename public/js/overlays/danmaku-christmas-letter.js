const ART = '/img/overlays/danmaku-christmas-letter/';
const GUARDS = Object.freeze({ 1: 'governor', 2: 'admiral', 3: 'captain' });
const LABELS = Object.freeze({ streamer: '主播', captain: '舰长', admiral: '提督', governor: '总督', fan: '粉丝团' });
const DECORATIONS = Object.freeze({
  viewer: ['gingerbread', 'snowman'], fan: ['reindeer', 'gift'],
  streamer: ['tree', 'stockings'], captain: ['gingerbread', 'gift'],
  admiral: ['stockings', 'stockings'], governor: ['santa', 'gift'],
});

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function star(document, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M10 0 12.5 7.5 20 10 12.5 12.5 10 20 7.5 12.5 0 10 7.5 7.5Z');
  svg.append(path);
  return svg;
}

function art(document, key, position) {
  const slot = node(document, 'span', `xletter-art xletter-art--${position}`);
  slot.dataset.art = key;
  slot.setAttribute('aria-hidden', 'true');
  const image = node(document, 'img', '');
  image.alt = '';
  image.decoding = 'async';
  image.src = `${ART}${key}.webp`;
  image.addEventListener('error', () => image.remove(), { once: true });
  slot.append(image);
  return slot;
}

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

// The shared SC module owns paid-message dispatch; this adapter decorates the other messages.
export function createChristmasLetterMessageRenderer(options, render) {
  const { document, classNames } = options;
  let lastLiveAt = null;
  return (item = {}, index = 0, entry = {}) => {
    const dense = entry.live && lastLiveAt !== null && entry.now >= lastLiveAt && entry.now - lastLiveAt < 240;
    if (entry.live) lastLiveAt = entry.now;
    if (item.kind === 'superchat') return render(item, index);
    const root = render({ ...item, kind: 'danmaku', avatarUrl: '' }, index);
    const copy = root.querySelector(`.${classNames.body}`).children[1];
    return decorateChristmasLetterMessage(document, root, item, copy, classNames, dense);
  };
}

export function createChristmasLetterSuperChat(document, root, item, copy, classNames) {
  return decorateChristmasLetterMessage(document, root, item, copy, classNames);
}

function decorateChristmasLetterMessage(document, root, item, copy, classNames, dense = false) {
  const gift = item.kind === 'gift';
  const sc = item.kind === 'superchat';
  const bought = gift && LABELS[GUARDS[item.giftGuardLevel]];
  const guardRole = GUARDS[bought ? item.giftGuardLevel : item.roomGuardLevel];
  const notice = item.kind === 'system' || item.kind === 'entry';
  const event = Boolean(sc || bought);
  const medalLevel = Number(item.roomMedal?.level);
  const hasMedal = Number.isSafeInteger(medalLevel) && medalLevel > 0;
  const role = item.isStreamer === true ? 'streamer'
    : GUARDS[item.roomGuardLevel] || (hasMedal ? 'fan' : 'viewer');
  const kind = sc ? 'superchat' : bought ? 'member' : gift ? 'gift' : notice ? 'notice' : 'chat';
  root.className = `${classNames.item} christmas-letter-item${sc ? ' is-superchat' : ''}`;
  if (sc) root.setAttribute('aria-label', `醒目留言，${amount(item.price)}`);
  root.dataset.role = role;
  root.dataset.letterKind = kind;
  if (bought) root.dataset.letterTier = guardRole;
  // Latch once: removing older messages never restarts this entrance.
  root.dataset.letterDensity = dense && !event ? 'compact' : 'full';
  root.style.setProperty('--danmaku-delay', '0ms');
  const bubble = node(document, 'div', `${classNames.body} xletter-bubble`);
  for (const layer of ['trace', 'surface', 'glint']) {
    const decoration = node(document, 'span', `xletter-${layer}`);
    decoration.setAttribute('aria-hidden', 'true');
    bubble.append(decoration);
  }
  copy.className = `xletter-copy${sc ? ' sc-copy' : ''}`;

  if (sc) {
    const heading = node(document, 'div', 'xletter-event-heading');
    heading.append(node(document, 'span', 'xletter-event-title', 'SC · 醒目留言'),
      node(document, 'strong', 'xletter-amount', amount(item.price)));
    bubble.append(heading);
  }
  if (!notice && (!gift || bought)) {
    const identity = node(document, 'div', `${classNames.identity} xletter-identity`);
    const nameplate = node(document, 'span', 'xletter-nameplate');
    const name = node(document, 'strong', 'xletter-name', String(item.name || '观众').trim() || '观众');
    name.title = name.textContent;
    nameplate.append(name);
    if (!event && (role === 'streamer' || role === 'governor')) nameplate.append(art(document, 'hat', 'hat'));
    identity.append(nameplate);
    if (!event && role === 'streamer') identity.append(node(document, 'span', 'xletter-role-label', LABELS.streamer));
    if (guardRole || hasMedal) {
      const label = guardRole ? LABELS[guardRole] : LABELS.fan;
      const medal = node(document, 'span', `xletter-role-label${guardRole ? ' xletter-guard-label' : ''}${hasMedal ? ' xletter-medal' : ''}`,
        `${label}${hasMedal ? ` ${medalLevel}` : ''}`);
      medal.title = hasMedal ? `${item.roomMedal.name || '本房间灯牌'} · ${medalLevel}` : label;
      identity.append(medal);
    }
    bubble.append(identity);
  }

  if (gift) {
    const action = bought ? item.guardAction === 'open' ? '开通' : item.guardAction === 'renew' ? '续费' : '支持' : '送出';
    copy.replaceChildren();
    if (!bought) copy.append(node(document, 'strong', 'xletter-gift-sender', item.name || '观众'));
    copy.append(node(document, 'span', 'xletter-gift-action', `${action} `),
      node(document, 'strong', 'xletter-gift-name', bought || item.giftName || '礼物'),
      node(document, 'span', 'xletter-gift-count', ` × ${item.giftCount ?? 1}`));
    if (!bought) copy.append(node(document, 'span', 'xletter-gift-amount', amount(item.giftTotalPrice)));
  }
  bubble.append(copy);
  if (bought) {
    bubble.append(node(document, 'strong', 'xletter-amount xletter-member-amount', amount(item.giftTotalPrice)));
    const scene = node(document, 'img', 'xletter-member-scene');
    scene.src = `${ART}${guardRole}-scene.webp`;
    scene.alt = '';
    scene.decoding = 'async';
    scene.setAttribute('aria-hidden', 'true');
    bubble.append(scene);
  }

  if (kind === 'chat') {
    const [left, right] = DECORATIONS[role];
    bubble.append(art(document, left, 'left'), art(document, right, 'right'));
    if (role === 'streamer' || role === 'governor') {
      const badge = node(document, 'span', 'xletter-bottom-badge');
      badge.setAttribute('aria-hidden', 'true');
      bubble.append(badge);
    }
  } else if (!notice && !bought) {
    bubble.append(art(document, sc ? 'tree' : 'gift', 'alert'));
    if (sc) bubble.append(art(document, 'snowman', 'right'));
    const ribbon = node(document, 'span', 'xletter-ribbon');
    ribbon.setAttribute('aria-hidden', 'true');
    bubble.append(ribbon);
  }
  if (!notice) {
    bubble.append(star(document, 'xletter-spark xletter-spark--left'), star(document, 'xletter-spark xletter-spark--right'));
    const particles = node(document, 'span', 'xletter-particles');
    particles.setAttribute('aria-hidden', 'true');
    for (let number = 0; number < (event ? 7 : 4); number += 1) {
      const spark = star(document, 'xletter-particle');
      spark.style.setProperty('--particle', number);
      particles.append(spark);
    }
    bubble.append(particles);
  }
  root.replaceChildren(bubble);
  return root;
}
