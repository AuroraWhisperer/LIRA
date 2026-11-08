import { setGuardIcon } from '../shared/bilibili-guard-icons.js';

const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };
const ICONS = {
  gift: 'M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3zM12 8h4a3 3 0 1 0-3-3z',
  sc: 'M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-8l-6 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h8M8 12h5',
};

// Keep the safe renderer's text/emote nodes. The shared feed owns all scheduling.
export function createGlowyMessageRenderer({ document, classNames }, render) {
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function guardIcon(level, className) {
    const image = element('img', className);
    image.alt = GUARDS[level];
    image.decoding = 'async';
    setGuardIcon(image, level);
    return image;
  }
  function eventIcon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('glowy-event-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', ICONS[kind]);
    svg.append(path);
    return svg;
  }
  const amount = value => Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '';

  return (item = {}, index = 0) => {
    const sc = item.kind === 'superchat';
    const gift = item.kind === 'gift';
    const member = gift && GUARDS[Number(item.giftGuardLevel)] ? Number(item.giftGuardLevel) : 0;
    const guard = GUARDS[Number(item.roomGuardLevel)] ? Number(item.roomGuardLevel) : 0;
    const root = render({ ...item, kind: sc ? 'danmaku' : item.kind, guardLevel: 0, medalName: '',
      avatarUrl: gift || sc ? '' : item.avatarUrl, giftImageUrl: '' }, index);
    const body = root.querySelector(`.${classNames.body}`);
    const heading = body.children[0];
    const copy = body.children[1];
    const avatar = root.querySelector(`.${classNames.avatar}`);
    root.classList.add('glowy-item');
    root.dataset.glowyKind = sc ? 'sc' : member ? 'member' : gift ? 'gift' : 'chat';
    root.dataset.glowyRole = item.isStreamer === true ? 'streamer' : String(member || guard);
    root.style.setProperty('--glowy-phase', `${-(index % 7)}s`);
    body.classList.add('glowy-content');
    heading.classList.add('glowy-heading');
    copy.classList.add('glowy-copy');
    const role = item.isStreamer === true ? '主播' : GUARDS[member || guard];
    if (role) heading.append(element('span', 'glowy-role', role));
    const date = new Date(item.timestamp);
    if (Number.isFinite(date.getTime())) {
      const time = element('time', 'glowy-time', `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
      time.setAttribute('datetime', date.toISOString());
      heading.append(time);
    }
    if (gift) {
      copy.querySelector('.draw-danmaku-gift-art')?.remove();
      if (member) {
        copy.querySelector('.draw-danmaku-gift-action').textContent =
          ({ open: '开通', renew: '续费' })[item.guardAction] || '支持';
        copy.querySelector('.draw-danmaku-gift-name').textContent = GUARDS[member];
      }
    }
    if (sc) {
      root.classList.add('is-superchat');
      copy.classList.add('sc-copy');
      copy.textContent = String(item.message ?? '');
    }
    if (gift || sc) {
      const price = amount(sc ? item.price : item.giftTotalPrice);
      if (sc) heading.append(element('span', 'glowy-event-label', '醒目留言'));
      if (price) body.append(element('span', 'glowy-amount', price));
      if (!member) body.append(eventIcon(sc ? 'sc' : 'gift'));
    }
    const material = element('div', 'glowy-material');
    material.setAttribute('aria-hidden', 'true');
    const panel = element('div', 'glowy-panel');
    if (avatar && !gift && !sc) {
      avatar.classList.add('glowy-avatar');
      panel.append(avatar);
    }
    panel.append(body);
    if (member || guard) panel.append(guardIcon(member || guard, 'glowy-guard'));
    root.replaceChildren(material, panel);
    return root;
  };
}
