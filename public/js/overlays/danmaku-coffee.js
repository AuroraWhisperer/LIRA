const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };
const GRAPHEMES = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
const CUP_LINES = [
  ['rim', 'M6 28C8 22 43 22 48 27C49 33 9 35 6 28Z'],
  ['bowl', 'M6 29L9 55C11 66 39 67 44 55L48 29'],
  ['handle', 'M48 34C66 26 64 49 45 53M48 39C58 34 57 45 47 47'],
  ['saucer', 'M3 68C15 74 38 75 53 67M8 66C18 70 37 70 46 65'],
  ['steam', 'M15 18C11 13 21 10 17 3'],
  ['steam', 'M27 17C24 12 33 8 29 1'],
  ['steam', 'M39 18C36 14 43 10 41 5'],
];

function cup(document) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 82');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('coffee-cup');
  CUP_LINES.forEach(([part, d], index) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('pathLength', '1');
    path.setAttribute('class', `coffee-${part}`);
    path.style.setProperty('--coffee-stroke-delay', `${120 + index * 45}ms`);
    path.style.setProperty('--coffee-steam-phase', `${-index * 0.7}s`);
    svg.append(path);
  });
  return svg;
}

function eventDecoration(document, kind) {
  const frame = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  frame.classList.add('coffee-event-frame');
  frame.setAttribute('aria-hidden', 'true');
  for (const inset of [2, 5]) {
    const line = document.createElementNS(frame.namespaceURI, 'rect');
    line.setAttribute('x', String(inset));
    line.setAttribute('y', String(inset));
    line.setAttribute('rx', '4');
    line.setAttribute('pathLength', '1');
    line.style.setProperty('--coffee-frame-inset', `${inset * 2}px`);
    frame.append(line);
  }
  const ornament = document.createElementNS(frame.namespaceURI, 'svg');
  ornament.classList.add('coffee-event-ornament');
  ornament.setAttribute('viewBox', '0 0 32 32');
  ornament.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(frame.namespaceURI, 'path');
  path.setAttribute('pathLength', '1');
  path.setAttribute('d', kind === 'member'
    ? 'M16 8V26M10 14H22M6 20C6 29 26 29 26 20M6 20L4 23M6 20L10 22M26 20L28 23M26 20L22 22M19 5A3 3 0 1 1 13 5A3 3 0 1 1 19 5'
    : kind === 'sc'
      ? 'M8 7H24Q27 7 27 10V22Q27 25 24 25H15L9 29V25H8Q5 25 5 22V10Q5 7 8 7M11 13H21M11 18H18'
      : 'M19 10L21 16L27 18L21 20L19 26L17 20L11 18L17 16ZM7 3L8 7L12 8L8 9L7 13L6 9L2 8L6 7ZM28 26V30M26 28H30');
  ornament.append(path);
  return [frame, ornament];
}

// Reserve complete lines before revealing them, including joined emoji. Reuse
// safe core nodes so image failures retain their text fallback without timers.
function writeMessage(document, copy, start = 420) {
  let position = 0;
  const reveal = (node) => {
    const span = document.createElement('span');
    span.className = 'coffee-glyph';
    span.style.setProperty('--coffee-write-delay', `${start + position++ * 85}ms`);
    span.append(node);
    return span;
  };
  const visit = (parent) => {
    for (const child of [...parent.childNodes]) {
      if (child.nodeType === 3) {
        const fragment = document.createDocumentFragment();
        for (const { segment } of GRAPHEMES.segment(child.textContent)) {
          fragment.append(reveal(document.createTextNode(segment)));
        }
        child.replaceWith(fragment);
      } else if (child.tagName === 'IMG') {
        const wrapper = reveal(document.createTextNode(''));
        child.replaceWith(wrapper);
        wrapper.replaceChildren(child);
      } else visit(child);
    }
  };
  visit(copy);
  return Math.max(900, start + position * 85);
}

export function createCoffeeMessageRenderer({ document, classNames }, render) {
  return (item = {}, index = 0) => {
    const sc = item.kind === 'superchat';
    const gift = item.kind === 'gift';
    const member = gift && GUARDS[Number(item.giftGuardLevel)] ? Number(item.giftGuardLevel) : 0;
    const event = gift || sc;
    const root = render({ ...item, kind: sc ? 'danmaku' : item.kind,
      guardLevel: 0, medalName: '', giftImageUrl: '' }, index);
    root.classList.add('coffee-item');
    root.dataset.coffeeKind = sc ? 'sc' : member ? 'member' : gift ? 'gift' : 'chat';
    root.dataset.coffeeRole = String(item.isStreamer ? 'streamer' : member || Number(item.roomGuardLevel) || 0);
    if (member) root.dataset.coffeeMembership = String(member);
    const body = root.querySelector(`.${classNames.body}`);
    const heading = body.children[0];
    const copy = body.children[1];
    heading.classList.add('coffee-heading');
    copy.classList.add('coffee-copy');
    const role = item.isStreamer ? '主播' : GUARDS[member || Number(item.roomGuardLevel)];
    if (role) {
      const badge = document.createElement('span');
      badge.className = 'coffee-role';
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', role);
      heading.append(badge);
    }
    const leader = document.createElement('span');
    leader.className = 'coffee-leader';
    leader.setAttribute('aria-hidden', 'true');
    heading.append(leader);
    const date = new Date(item.timestamp);
    if (!event && Number.isFinite(date.getTime())) {
      const time = document.createElement('time');
      time.className = 'coffee-time';
      time.textContent = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      time.setAttribute('datetime', date.toISOString());
      heading.append(time);
    }
    const avatar = root.querySelector(`.${classNames.avatar}`);
    if (avatar) {
      const portrait = document.createElement('div');
      portrait.className = 'coffee-portrait';
      avatar.replaceWith(portrait);
      portrait.append(avatar, cup(document));
    } else root.classList.add('coffee-no-avatar');
    if (gift) {
      copy.querySelector('.draw-danmaku-gift-art')?.remove();
      copy.querySelector('.draw-danmaku-gift-amount')?.remove();
      const action = copy.querySelector('.draw-danmaku-gift-action');
      if (member) {
        action.textContent = `${({ open: '开通', renew: '续费' })[item.guardAction] || '支持'} `;
        copy.querySelector('.draw-danmaku-gift-name').textContent = GUARDS[member];
        const note = document.createElement('span');
        note.className = 'coffee-event-note';
        const days = Number(item.guardAccompanyDays);
        note.textContent = Number.isSafeInteger(days) && days > 0 ? `大航海 · 已相伴 ${days} 天` : '大航海';
        body.append(note);
      } else action.textContent = '送出 ';
    }
    if (sc) {
      root.classList.add('is-superchat');
      copy.classList.add('sc-copy');
      copy.textContent = String(item.message ?? '');
    }
    if (event) {
      root.classList.add('coffee-event');
      root.append(...eventDecoration(document, root.dataset.coffeeKind));
      const value = sc ? item.price : item.giftTotalPrice;
      const price = document.createElement('span');
      price.className = 'coffee-price';
      const amount = Number.isFinite(value) && value >= 0
        ? `CN¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
      price.textContent = sc ? ['SC', amount].filter(Boolean).join(' · ') : amount;
      if (price.textContent) heading.append(price);
    }
    root.style.setProperty('--coffee-entry-duration', `${Math.max(event ? 1200 : 900,
      writeMessage(document, copy, event ? 620 : 420))}ms`);
    return root;
  };
}
