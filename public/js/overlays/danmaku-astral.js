const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function ornament(document, className) {
  const element = node(document, 'span', className);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function star(document, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `astral-star ${className}`);
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M10 0C11.6 6.4 13.6 8.4 20 10C13.6 11.6 11.6 13.6 10 20C8.4 13.6 6.4 11.6 0 10C6.4 8.4 8.4 6.4 10 0Z');
  svg.append(path);
  return svg;
}

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

// Only composition lives here; the canonical renderer retains text and inline emotes.
export function createAstralMessageRenderer(options, render) {
  const { document, classNames } = options;
  return (item = {}, index = 0) => {
    const root = render({ ...item, kind: 'danmaku' }, index);
    const copy = root.querySelector(`.${classNames.body}`).children[1];
    const gift = item.kind === 'gift';
    const member = gift && GUARDS[item.giftGuardLevel];
    const sc = item.kind === 'superchat';
    const event = gift || sc;
    const role = item.isStreamer === true ? '主播' : GUARDS[item.roomGuardLevel];
    root.classList.add('astral-item');
    if (gift) root.classList.add('is-gift');
    if (sc) root.classList.add('is-superchat');
    root.dataset.astralKind = sc ? 'sc' : member ? 'member' : gift ? 'gift' : 'chat';
    root.dataset.astralRole = String(Boolean(role));
    root.style.setProperty('--danmaku-delay', '0ms');
    const panel = node(document, 'div', `${classNames.body} astral-panel`);
    const frame = ornament(document, 'astral-frame');
    const surface = ornament(document, 'astral-surface');
    const heading = node(document, 'div', `${classNames.identity} astral-heading`);
    const name = node(document, 'strong', 'astral-name', item.name || '观众');
    name.title = name.textContent;
    const rail = ornament(document, 'astral-rail');
    rail.append(star(document, 'astral-pendant'));
    copy.classList.add('astral-copy');
    if (event) {
      const action = member ? ({ open: '开通', renew: '续费' })[item.guardAction] || '支持' : '送出';
      const identity = node(document, 'span', 'astral-event-identity');
      identity.append(name, node(document, 'span', 'astral-event-label', sc ? '醒目留言' : member ? `${action}${member}` : '送出礼物'));
      heading.append(star(document, 'astral-event-star'), identity,
        node(document, 'span', 'astral-amount', amount(sc ? item.price : item.giftTotalPrice)));
      if (sc) {
        copy.classList.add('sc-copy');
        copy.textContent = String(item.message ?? '');
      }
      else copy.replaceChildren(node(document, 'span', 'draw-danmaku-gift-name', member ? '感谢守护' : item.giftName || '礼物'),
        node(document, 'span', 'draw-danmaku-gift-count', ` × ${item.giftCount ?? 1}`));
      panel.append(surface, frame, heading, copy, rail);
    } else {
      heading.append(name);
      panel.append(surface, frame, heading, copy, rail,
        star(document, 'astral-side astral-side--left'), star(document, 'astral-side astral-side--right'),
        ornament(document, 'astral-dots'));
      if (role) {
        panel.append(node(document, 'span', 'astral-role', role));
      }
    }
    root.replaceChildren(panel);
    return root;
  };
}
