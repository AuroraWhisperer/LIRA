const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };
const ROLE_PATHS = {
  streamer: 'M4 6h10v3l6-3v12l-6-3v3H4Z',
  guard: 'm12 2 3 6.2 6.8 1-4.9 4.8 1.2 6.8L12 17.5l-6.1 3.3 1.2-6.8-4.9-4.8 6.8-1Z',
  fan: 'm12 3 9 9-9 9-9-9Z',
};

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '—';
}

// The shared renderer owns text and emote parsing; this adapter owns their composition.
export function createAnimatedGradientMessageRenderer({ document, classNames }, render) {
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  const badge = (role, label) => {
    const element = node('span', `gradient-role-icon gradient-role-icon--${role}`);
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', label);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ROLE_PATHS[role === 'streamer' || role === 'fan' ? role : 'guard']);
    svg.append(path);
    element.append(svg);
    return element;
  };

  return (item = {}, index = 0) => {
    const gift = item.kind === 'gift';
    const sc = item.kind === 'superchat';
    const membership = gift && GUARDS[item.giftGuardLevel];
    const event = gift || sc || ['entry', 'system'].includes(item.kind);
    const root = render({ ...item, kind: event ? 'danmaku' : item.kind, guardLevel: 0, medalName: '',
      giftImageUrl: '', emotes: sc ? [] : item.emotes }, index);
    const body = root.querySelector(`.${classNames.body}`);
    const copy = body.children[1];
    const name = String(item.name || '观众').trim() || '观众';
    root.classList.add('gradient-item');
    if (gift) root.classList.add('is-gift');
    const elapsed = Date.now() - Number(item.timestamp);
    if (Number.isFinite(elapsed) && elapsed >= 0) root.style.setProperty('--gradient-phase', `${-elapsed}ms`);
    root.dataset.gradientKind = sc ? 'superchat' : membership ? 'member' : gift ? 'gift' : event ? 'notice' : 'chat';
    body.className = `${classNames.body} gradient-body`;
    const heading = node('div', `${classNames.identity} gradient-heading`);
    const sender = node('strong', 'gradient-name', name);
    if (event) {
      const ticket = node('div', 'gradient-ticket gradient-panel');
      ticket.append(sender);
      const label = node('span', 'gradient-event-label');
      if (gift) {
        const action = membership ? ({ open: '开通', renew: '续费' })[item.guardAction] || '支持' : '送出';
        const giftName = membership || String(item.giftName || '礼物');
        const count = `×${item.giftCount ?? 1}`;
        const total = node('span', 'gradient-amount', ` · ${amount(item.giftTotalPrice)}`);
        label.append(node('span', 'gradient-event-action', `${action} `),
          node('span', 'gradient-gift-name', giftName), node('span', 'gradient-gift-count', count));
        ticket.append(total);
      } else if (sc) {
        root.classList.add('is-superchat');
        ticket.append(node('span', 'gradient-amount', ` · ${amount(item.price)}`));
        label.textContent = '醒目留言';
      } else label.textContent = item.kind === 'entry' ? '来到直播间' : '消息';
      const shell = node('div', 'gradient-event');
      shell.append(ticket, label);
      body.replaceChildren(shell);
      if (sc || item.kind === 'system') {
        if (sc) copy.textContent = String(item.message ?? '');
        copy.className = sc ? 'sc-copy gradient-copy gradient-panel' : 'gradient-copy gradient-panel';
        body.append(copy);
      }
    } else {
      const guard = GUARDS[item.roomGuardLevel];
      const role = item.isStreamer === true ? 'streamer' : guard
        ? ({ 1: 'governor', 2: 'admiral', 3: 'captain' })[item.roomGuardLevel] : item.roomMedal?.name ? 'fan' : '';
      root.dataset.gradientRole = role || 'viewer';
      if (role) heading.append(badge(role, role === 'streamer' ? '主播' : guard || '粉丝'));
      heading.append(sender);
      const medal = item.roomMedal;
      const level = Number.isSafeInteger(medal?.level) && medal.level > 0 ? ` ${medal.level}` : '';
      if (guard || medal?.name) heading.append(node('span', 'gradient-role',
        [guard, medal?.name ? `${medal.name}${level}` : ''].filter(Boolean).join(' · ')));
      copy.classList.add('gradient-copy', 'gradient-panel');
      body.replaceChildren(heading, copy);
      const line = node('span', 'gradient-underline');
      line.setAttribute('aria-hidden', 'true');
      body.append(line);
    }
    root.replaceChildren(body);
    return root;
  };
}
