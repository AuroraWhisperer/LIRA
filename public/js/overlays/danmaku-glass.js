const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };
const ICONS = {
  star: 'M12 2.5 15 8.6l6.7 1-4.9 4.7 1.2 6.7-6-3.2-6 3.2 1.2-6.7-4.9-4.7 6.7-1Z',
  gift: 'M3 10h18V6H3Zm2 0v11h14V10M12 6v15M12 6H8.5A2.5 2.5 0 1 1 11 3.5Zm0 0h3.5A2.5 2.5 0 1 0 13 3.5Z',
  tip: 'M17 5.5c-1.1-1-2.7-1.5-5-1.5-3 0-5 1.5-5 4s2.5 3.5 5 4 5 1.5 5 4-2 4-5 4c-2.3 0-4.3-.8-5.5-2M12 1v22',
  camera: 'M4 5h11a3 3 0 0 1 3 3v1l5-3v12l-5-3v1a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z',
  diamond: 'm2 8 4-5h12l4 5-10 13Z',
  glint: 'M12 0c0 8-4 12-12 12 8 0 12 4 12 12 0-8 4-12 12-12-8 0-12-4-12-12Z',
};

// The core keeps ownership of safe text/emotes; Glass only composes the notification.
export function createGlassMessageRenderer({ document, classNames }, render) {
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = (kind, className, label) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.classList.add(className);
    svg.setAttribute('fill', ['camera', 'diamond', 'glint'].includes(kind) ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', label ? 'false' : 'true');
    if (label) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', label);
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[kind]);
    svg.append(path);
    return svg;
  };
  const amount = (value) => Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '';

  return (item = {}, index = 0) => {
    const sc = item.kind === 'superchat';
    const gift = item.kind === 'gift';
    const membership = gift && GUARDS[Number(item.giftGuardLevel)];
    const guard = GUARDS[Number(item.roomGuardLevel)];
    const root = render({ ...item, kind: sc ? 'danmaku' : item.kind, guardLevel: 0, medalName: '',
      giftImageUrl: '', emotes: sc ? [] : item.emotes }, index);
    root.classList.add('glass-item');
    root.dataset.glassKind = sc ? 'sc' : membership ? 'member' : gift ? 'gift' : 'chat';
    root.style.setProperty('--glass-phase', `${-(index % 9)}s`);
    const body = root.querySelector(`.${classNames.body}`);
    const heading = body.children[0];
    const copy = body.children[1];
    body.classList.add('glass-content');
    heading.classList.add('glass-heading');
    copy.classList.add('glass-copy');
    if (!gift && !sc) {
      if (item.isStreamer === true) heading.append(icon('camera', 'glass-role-icon', '主播'));
      else if (guard) heading.append(icon('star', 'glass-role-icon', guard));
      else if (item.roomMedal?.name) heading.append(icon('diamond', 'glass-role-icon', item.roomMedal.name));
    }
    if (gift) {
      const giftCopy = copy.querySelector('.draw-danmaku-gift-copy');
      const count = copy.querySelector('.draw-danmaku-gift-count');
      if (membership) {
        giftCopy.querySelector('.draw-danmaku-gift-action').textContent =
          ({ open: '开通', renew: '续费' })[item.guardAction] || '支持';
        giftCopy.querySelector('.draw-danmaku-gift-name').textContent = membership;
      }
      copy.replaceChildren(giftCopy, count);
      const total = amount(item.giftTotalPrice);
      if (total) copy.append(element('span', 'glass-amount', ` · ${total}`));
    }
    if (sc) {
      root.classList.add('is-superchat');
      copy.textContent = String(item.message ?? '');
      const total = amount(item.price);
      const label = element('div', 'glass-event-label', total ? `醒目留言 · ${total}` : '醒目留言');
      body.replaceChildren(heading, label, copy);
    }
    const panel = element('div', 'glass-panel');
    if (gift || sc) {
      panel.append(icon(sc ? 'tip' : membership ? 'star' : 'gift', 'glass-event-icon'));
      const divider = element('span', 'glass-divider');
      divider.setAttribute('aria-hidden', 'true');
      panel.append(divider);
    }
    panel.append(body);
    const date = new Date(item.timestamp);
    if (Number.isFinite(date.getTime())) {
      const time = element('time', 'glass-time',
        `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
      time.setAttribute('datetime', date.toISOString());
      panel.append(time);
    }
    const glints = element('span', 'glass-glints');
    glints.setAttribute('aria-hidden', 'true');
    glints.append(icon('glint', 'glass-glint'), icon('glint', 'glass-glint'));
    panel.append(glints);
    root.replaceChildren(panel);
    return root;
  };
}
