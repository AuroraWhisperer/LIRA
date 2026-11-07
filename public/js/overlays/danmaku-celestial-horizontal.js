const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };
const STAR_PATHS = [
  'M12 2 14.8 9.2 22 12 14.8 14.8 12 22 9.2 14.8 2 12 9.2 9.2Z',
  'M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26Z',
  'M12 2V22M2 12H22M5 5 19 19M19 5 5 19',
  'M12 4 16 12 12 20 8 12Z',
  'M12 2 15 8 21 8 17 12 18.5 18 12 15 5.5 18 7 12 3 8 9 8Z',
];

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function userStar(document, name) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = name.charCodeAt(index) + ((hash << 5) - hash);
  const variant = Math.abs(hash) % STAR_PATHS.length;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'celestial-user-star');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.setProperty('--celestial-star-color', `hsl(45 100% ${30 + Math.abs(hash) % 40}%)`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', STAR_PATHS[variant]);
  if (variant === 2) {
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '2');
    svg.append(circle);
  }
  svg.append(path);
  return svg;
}

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

// Keep the shared safe text/emote renderer; this adapter owns only the inline composition.
export function createCelestialHorizontalMessageRenderer(options, render) {
  const { document, classNames } = options;
  return (item = {}, index = 0) => {
    const root = render({ ...item, kind: 'danmaku' }, index);
    const copy = root.querySelector(`.${classNames.body}`).children[1];
    const name = String(item.name || '观众');
    const identity = node(document, 'strong', 'celestial-name', name);
    const body = node(document, 'div', `${classNames.body} celestial-message`);
    copy.classList.add('celestial-copy');
    root.classList.add('celestial-item');
    if (item.kind === 'superchat') {
      root.classList.add('is-superchat');
      copy.classList.add('sc-copy');
      copy.textContent = String(item.message ?? '');
      body.append(userStar(document, name), identity, node(document, 'span', 'celestial-amount', amount(item.price)), copy);
    } else {
      if (item.kind === 'gift') {
        root.classList.add('is-gift');
        const guard = GUARDS[item.giftGuardLevel];
        const action = guard ? item.guardAction === 'open' ? '开通' : item.guardAction === 'renew' ? '续费' : '支持' : '送出';
        copy.textContent = `${action} ${guard || item.giftName || '礼物'} ×${item.giftCount ?? 1} · ${amount(item.giftTotalPrice)}`;
      }
      body.append(userStar(document, name), identity, copy);
    }
    root.replaceChildren(body);
    return root;
  };
}

// Decorative nodes are siblings of the feed so message measurement never includes the sky.
export function syncCelestialBackdrop(document, enabled) {
  const stage = document.querySelector('.danmaku-signal-stage');
  const existing = stage.querySelector('.celestial-backdrop');
  if (!enabled) { existing?.remove(); return; }
  if (existing) return;
  const backdrop = node(document, 'div', 'celestial-backdrop');
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.append(node(document, 'div', 'celestial-nebula'));
  const stars = node(document, 'div', 'celestial-stars');
  let seed = 337;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  // The first 30 retain the original sky; CSS reveals the extra stars for dense mode.
  for (let index = 0; index < 60; index += 1) {
    const star = node(document, 'i', 'celestial-star');
    star.style.setProperty('--star-size', `${1 + random() * 2}px`);
    star.style.left = `${random() * 100}%`;
    star.style.top = `${random() * 100}%`;
    star.style.setProperty('--star-duration', `${2 + random() * 3}s`);
    star.style.setProperty('--star-delay', `${-index * 0.37}s`);
    stars.append(star);
  }
  backdrop.append(stars);
  stage.prepend(backdrop);
}
