const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };
const NAME_COLORS = ['#ffa58d', '#f09bc9', '#8dd9ef', '#b4df75', '#c2adff'];
const ICONS = {
  crown: 'M3 6l4 4 5-7 5 7 4-4-2 13H5Z',
  gift: 'M3 9h18v12H3ZM2 5h20v4H2ZM12 5v16M12 5C4 6 4 0 8 1c2 0 4 4 4 4Zm0 0c8 1 8-5 4-4-2 0-4 4-4 4Z',
  bell: 'M5 9a7 7 0 0 1 14 0v6l2 3H3l2-3ZM9 21h6M12 1v2',
  letter: 'M2 5h20v14H2Zm0 0 10 8L22 5',
};

function icon(document, kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'neon-glass-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', kind === 'crown' ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[kind]);
  svg.append(path);
  return svg;
}

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '—';
}

// The shared renderer owns literal text and safe emotes; this adapter only composes the capsule.
export function createNeonGlassMessageRenderer({ document, classNames }, render) {
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  return (item = {}, index = 0) => {
    const sc = item.kind === 'superchat';
    const gift = item.kind === 'gift';
    const membership = gift && GUARDS[Number(item.giftGuardLevel)];
    const guard = Number(item.roomGuardLevel);
    const name = String(item.name || '观众');
    const root = render({ ...item, kind: 'danmaku', giftImageUrl: '', guardLevel: 0, medalName: '',
      roomGuardLevel: 0, emotes: gift || sc ? [] : item.emotes }, index);
    const body = root.querySelector(`.${classNames.body}`);
    const copy = body.children[1];
    copy.classList.add('neon-glass-copy');
    root.classList.add('neon-glass-item');
    root.dataset.neonGlassKind = sc ? 'sc' : membership ? 'member' : gift ? 'gift' : 'chat';
    root.dataset.neonGlassRole = item.isStreamer === true ? 'streamer' : GUARDS[guard]
      ? ({ 1: 'governor', 2: 'admiral', 3: 'captain' })[guard] : item.roomMedal?.name ? 'fan' : 'viewer';
    let hash = 0;
    for (const character of name) hash = Math.imul(hash, 31) + character.codePointAt(0) | 0;
    root.style.setProperty('--neon-glass-original-name-color', NAME_COLORS[(hash >>> 0) % NAME_COLORS.length]);
    const identity = element('strong', 'neon-glass-name', name);
    const separator = element('span', 'neon-glass-separator', gift || sc ? ' ' : ' : ');
    if (gift) {
      root.classList.add('is-gift');
      const action = membership ? ({ open: '开通', renew: '续费' })[item.guardAction] || '支持' : '送出';
      copy.replaceChildren(element('span', 'draw-danmaku-gift-action', `${action} `),
        element('span', 'draw-danmaku-gift-name', membership || item.giftName || '礼物'),
        element('span', 'draw-danmaku-gift-count', ` ×${item.giftCount ?? 1}`));
      copy.append(element('span', 'neon-glass-amount', ` · ${amount(item.giftTotalPrice)}`));
    }
    if (sc) {
      root.classList.add('is-superchat');
      copy.classList.add('sc-copy');
      copy.textContent = String(item.message ?? '');
      separator.textContent = ` · SC ${amount(item.price)} · `;
      separator.classList.add('neon-glass-amount');
    }
    body.classList.add('neon-glass-content');
    body.replaceChildren(...(item.isStreamer === true && !gift && !sc ? [icon(document, 'crown')] : []), identity, separator, copy);
    if (gift || sc) body.append(icon(document, membership ? 'bell' : sc ? 'letter' : 'gift'));
    root.replaceChildren(element('span', 'neon-glass-panel'), body);
    return root;
  };
}
