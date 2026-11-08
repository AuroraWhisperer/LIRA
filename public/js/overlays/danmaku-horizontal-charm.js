const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };
const ICONS = {
  chat: 'M5 5h14v12H9l-4 3V5Zm3 4v2h8V9H8Zm0 4v2h5v-2H8Z',
  streamer: 'm3 7 5 4 4-7 4 7 5-4-2 12H5L3 7Z',
  member: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z',
  gift: 'M3 8h18v5H3V8Zm2 6h6v8H5v-8Zm8 0h6v8h-6v-8ZM12 8C3 9 4 0 9 3l3 5 3-5c5-3 6 6-3 5Z',
  superchat: 'M12 21S2 15 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13Z',
};

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function badge(document, kind) {
  const plate = node(document, 'span', 'charm-badge');
  plate.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[kind] || ICONS.chat);
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path); plate.append(svg);
  return plate;
}

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

// Reuse literal text and inline-emote rendering; only this style owns the ribbon composition.
export function createHorizontalCharmMessageRenderer(options, render) {
  const { document, classNames } = options;
  return (item = {}, index = 0) => {
    const member = item.kind === 'gift' && GUARDS[item.giftGuardLevel];
    const kind = member ? 'member' : item.kind === 'gift' ? 'gift' : item.kind === 'superchat' ? 'superchat' : 'chat';
    const root = render({ ...item, kind: 'danmaku' }, index);
    const copy = root.querySelector(`.${classNames.body}`).children[1];
    const name = item.name || '观众';
    const role = item.isStreamer === true ? '主播' : GUARDS[item.roomGuardLevel];
    const identity = node(document, 'span', `${classNames.identity} charm-identity`);
    const content = node(document, 'div', `${classNames.body} charm-content`);
    const layout = node(document, 'div', 'charm-message');
    root.classList.add('charm-item');
    root.dataset.charmKind = kind;
    root.dataset.charmRole = item.isStreamer === true ? 'streamer' : [1, 2, 3].includes(item.roomGuardLevel) ? `guard-${item.roomGuardLevel}` : 'viewer';
    copy.classList.add('charm-copy');
    const label = node(document, 'strong', 'charm-name', name);
    if (kind === 'chat') {
      identity.append(label);
      if (role) identity.append(node(document, 'span', 'charm-role', role));
      content.append(copy);
      layout.append(badge(document, item.isStreamer === true ? 'streamer' : role ? 'member' : 'chat'), identity, content);
    } else {
      root.classList.add(kind === 'superchat' ? 'is-superchat' : 'is-gift');
      const heading = node(document, 'div', 'charm-event-heading');
      heading.append(label);
      if (kind === 'superchat') {
        heading.append(node(document, 'span', 'charm-event-label', '醒目留言'), node(document, 'span', 'charm-amount', amount(item.price)));
        copy.classList.add('sc-copy');
        copy.textContent = String(item.message ?? '');
      } else {
        const action = member ? item.guardAction === 'open' ? '开通' : item.guardAction === 'renew' ? '续费' : '支持' : '送出';
        heading.append(node(document, 'span', 'charm-event-label', member ? '大航海' : '礼物'));
        copy.replaceChildren(node(document, 'span', 'charm-action', `${action} `),
          node(document, 'strong', 'draw-danmaku-gift-name', member || item.giftName || '礼物'),
          node(document, 'span', 'draw-danmaku-gift-count', ` × ${item.giftCount ?? 1}`),
          node(document, 'span', 'charm-amount', amount(item.giftTotalPrice)));
      }
      content.append(heading, copy);
      layout.append(badge(document, kind), content);
    }
    root.replaceChildren(layout);
    return root;
  };
}
