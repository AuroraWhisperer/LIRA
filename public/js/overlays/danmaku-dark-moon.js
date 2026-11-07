const GUARDS = Object.freeze({ 1: '总督', 2: '提督', 3: '舰长' });
const SHAPES = Object.freeze({
  star: 'M12 1C13.5 8.6 15.4 10.5 23 12C15.4 13.5 13.5 15.4 12 23C10.5 15.4 8.6 13.5 1 12C8.6 10.5 10.5 8.6 12 1Z',
  moon: 'M19.8 15.4A8.9 8.9 0 0 1 8.6 4.2A9 9 0 1 0 19.8 15.4Z',
});

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function icon(document, shape, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', SHAPES[shape]);
  svg.append(path);
  return svg;
}

function decorations(document, event) {
  const art = node(document, 'span', event ? 'dark-moon-event-art' : 'dark-moon-trim');
  art.setAttribute('aria-hidden', 'true');
  if (event) {
    art.append(icon(document, 'moon', 'dark-moon-watermark'),
      node(document, 'i', 'dark-moon-bookmark'), node(document, 'i', 'dark-moon-orbit'),
      node(document, 'i', 'dark-moon-comet'));
  }
  art.append(node(document, 'i', 'dark-moon-dot'), icon(document, 'star', 'dark-moon-spark'));
  return art;
}

function price(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

// The canonical renderer owns safe text and emotes; this adapter only composes the theme.
export function createDarkMoonMessageRenderer(options, render) {
  const { document, classNames } = options;
  return (item = {}, index = 0) => {
    const guard = GUARDS[item.roomGuardLevel];
    const bought = item.kind === 'gift' && GUARDS[item.giftGuardLevel];
    const gift = item.kind === 'gift';
    const sc = item.kind === 'superchat';
    const event = gift || sc;
    const role = item.isStreamer === true ? '主播' : guard;
    const root = render({ ...item, kind: 'danmaku' }, index);
    const copy = root.querySelector(`.${classNames.body}`).children[1];
    root.replaceChildren();
    root.classList.add('dark-moon-item');
    root.dataset.identity = guard ? 'guard' : 'regular';
    root.dataset.moonKind = sc ? 'superchat' : bought ? 'member' : gift ? 'gift' : 'chat';
    if (gift) root.classList.add('is-gift');
    if (sc) root.classList.add('is-superchat');

    const body = node(document, 'div', `${classNames.body} dark-moon-body`);
    const heading = node(document, 'div', `${classNames.identity} dark-moon-heading`);
    const seal = node(document, 'span', 'dark-moon-seal');
    seal.setAttribute('aria-hidden', 'true');
    seal.append(icon(document, event ? 'star' : guard ? 'moon' : 'star', 'dark-moon-symbol'));
    heading.append(seal, node(document, 'strong', 'dark-moon-name', item.name || '观众'));
    if (role && !event) {
      heading.append(icon(document, 'star', 'dark-moon-divider'), node(document, 'span', 'dark-moon-role', role));
    }

    const panel = node(document, 'div', 'dark-moon-panel');
    const lining = node(document, 'span', 'dark-moon-lining');
    lining.setAttribute('aria-hidden', 'true');
    panel.append(lining);
    copy.classList.add('dark-moon-copy');
    if (event) {
      panel.append(seal);
      panel.append(decorations(document, true));
      heading.classList.add('dark-moon-event-heading');
      const action = bought ? item.guardAction === 'open' ? '开通' : item.guardAction === 'renew' ? '续费' : '支持' : '送出';
      const label = sc ? `醒目留言 ${price(item.price)}` : `${action} ${bought || item.giftName || '礼物'} × ${item.giftCount ?? 1}`;
      heading.append(node(document, 'span', 'dark-moon-event-label', label));
      if (gift) {
        heading.append(node(document, 'span', 'dark-moon-amount', price(item.giftTotalPrice)));
        panel.append(heading);
      } else {
        copy.textContent = item.message || '';
        panel.append(heading);
        body.append(panel);
        const message = node(document, 'div', 'dark-moon-panel dark-moon-sc-message');
        message.append(copy, decorations(document, false));
        body.append(message);
      }
    } else {
      const rail = node(document, 'span', 'dark-moon-rail');
      rail.setAttribute('aria-hidden', 'true');
      body.append(heading, rail);
      panel.append(copy, decorations(document, false));
    }
    if (!sc) body.append(panel);
    root.append(body);
    return root;
  };
}
