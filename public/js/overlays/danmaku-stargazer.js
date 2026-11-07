const GUARDS = Object.freeze({ 1: '总督', 2: '提督', 3: '舰长' });
const ICONS = Object.freeze({
  chat: 'M5 3h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-7l-6 4v-4H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z',
  gift: 'M2 8h20v5H2zM4 14h7v9H4zM13 14h7v9h-7zM11 7C2 9 3-3 9 2l3 5 3-5c6-5 7 7-2 5h-2Zm-1-2L8 3C5 1 5 6 10 5Zm4 0c5 1 5-4 2-2Z',
  member: 'm12 1 3.4 6.9L23 9l-5.5 5.4 1.3 7.6-6.8-3.6L5.2 22l1.3-7.6L1 9l7.6-1.1Z',
  superchat: 'M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm1 3v2c4 .6 5 5 1 5h-3c-1 0-1 2 1 2 5 0 6 6 1 7v2h-2v-2c-4-.6-5-5-1-5h3c1 0 1-2-1-2-5 0-6-6-1-7V4Z',
  system: 'M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm-1 4h2v3h-2Zm0 5h2v9h-2Z',
});

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function icon(document, kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[kind]);
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}

function seedFor(item) {
  const value = String(item.id || `${item.uid || ''}:${item.timestamp || ''}:${item.name || ''}:${item.message || ''}`);
  let seed = 0;
  for (const character of value) seed = (Math.imul(seed, 31) + character.codePointAt(0)) >>> 0;
  return (seed ^ (seed >>> 16)) >>> 0;
}

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

// The canonical renderer owns literal text, avatars and inline emotes; this owns the card.
export function createStargazerMessageRenderer(options, render) {
  const { document, classNames } = options;
  return (item = {}, index = 0) => {
    const member = item.kind === 'gift' && GUARDS[item.giftGuardLevel];
    const kind = member ? 'member' : item.kind === 'gift' ? 'gift'
      : item.kind === 'superchat' ? 'superchat' : ['system', 'entry'].includes(item.kind) ? 'system' : 'chat';
    const root = render({ ...item, kind: 'danmaku' }, index);
    const copy = root.querySelector(`.${classNames.body}`).children[1];
    const avatar = root.querySelector(`.${classNames.avatar}`);
    const seed = seedFor(item);
    root.replaceChildren();
    root.classList.add('stargazer-item');
    root.dataset.stargazerKind = kind;
    root.dataset.stargazerTone = String(seed % 4);
    root.style.setProperty('--stargazer-phase', `${-((Math.imul(seed, 2654435761) >>> 0) % 7000)}ms`);
    const card = node(document, 'div', `${classNames.body} stargazer-card`);
    const heading = node(document, 'div', `${classNames.identity} stargazer-heading`);
    const event = ['gift', 'member', 'superchat'].includes(kind);
    if (event) {
      heading.append(node(document, 'strong', 'stargazer-title',
        { gift: '收到礼物！', member: '欢迎上舰！', superchat: '醒目留言' }[kind]));
      if (kind === 'superchat') heading.append(node(document, 'span', 'stargazer-amount', amount(item.price)));
    } else {
      if (avatar) heading.append(avatar);
      heading.append(node(document, 'strong', 'stargazer-name', item.name || '观众'));
      const role = item.isStreamer === true ? '主播' : GUARDS[item.roomGuardLevel];
      if (role) heading.append(node(document, 'span', 'stargazer-role', role));
      if (item.roomMedal?.level > 0) heading.append(node(document, 'span', 'stargazer-role',
        `${item.roomMedal.name || '粉丝'} ${item.roomMedal.level}`));
    }
    copy.classList.add('stargazer-copy');
    if (kind === 'gift' || kind === 'member') {
      const action = member ? item.guardAction === 'open' ? '开通' : item.guardAction === 'renew' ? '续费' : '支持' : '送出';
      copy.replaceChildren(node(document, 'span', 'stargazer-sender', item.name || '观众'),
        node(document, 'span', 'stargazer-action', ` ${action} `),
        node(document, 'span', 'draw-danmaku-gift-name', member || item.giftName || '礼物'),
        node(document, 'span', 'draw-danmaku-gift-count', ` × ${item.giftCount ?? 1}`),
        node(document, 'span', 'stargazer-amount', ` · ${amount(item.giftTotalPrice)}`));
    } else if (kind === 'superchat') {
      heading.append(node(document, 'span', 'stargazer-sender', item.name || '观众'));
      // SC is a literal message, not a danmaku expression-token stream.
      copy.replaceChildren();
      copy.textContent = String(item.message ?? '');
    }
    const plate = node(document, 'span', 'stargazer-icon');
    plate.setAttribute('aria-hidden', 'true');
    plate.append(icon(document, kind));
    const sky = node(document, 'span', 'stargazer-sky');
    sky.setAttribute('aria-hidden', 'true');
    sky.append(node(document, 'i', 'stargazer-meteor'));
    if (event) for (let particle = 0; particle < 8; particle += 1) sky.append(node(document, 'i', 'stargazer-particle'));
    card.append(sky, heading, copy, plate);
    root.append(card);
    return root;
  };
}
