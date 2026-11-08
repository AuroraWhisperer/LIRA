import { setGuardIcon } from '../shared/bilibili-guard-icons.js';

const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };

function mixedEntrance(item) {
  let hash = 2166136261;
  for (const character of [item.id, item.uid, item.timestamp, item.name, item.message].join('|')) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  }
  return ['pop', 'unfold', 'rise'][(hash >>> 0) % 3];
}

// Only the window's composition is new. Safe content, placement and lifetime keep their owners.
export function createWindowMessageRenderer({ document, classNames }, render) {
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  return (item = {}, index = 0) => {
    const settings = document.body?.dataset || {};
    const sc = item.kind === 'superchat';
    const gift = item.kind === 'gift';
    const guard = GUARDS[Number(item.roomGuardLevel)] ? Number(item.roomGuardLevel) : 0;
    const membership = gift && GUARDS[Number(item.giftGuardLevel)];
    const root = render({ ...item, kind: sc ? 'danmaku' : item.kind,
      guardLevel: guard, medalName: item.roomMedal?.name || '', emotes: sc ? [] : item.emotes }, index);
    root.classList.add('window-item');
    root.dataset.windowKind = sc ? 'sc' : membership ? 'member' : gift ? 'gift' : 'chat';
    root.dataset.windowEntrance = settings.windowEntrance === 'mixed' || !settings.windowEntrance
      ? mixedEntrance(item) : settings.windowEntrance;
    root.style.setProperty('--window-entry-duration', `${Number(settings.windowEntranceMs) || 460}ms`);
    root.style.setProperty('--window-phase', `${-(index % 7)}s`);
    const body = root.querySelector(`.${classNames.body}`);
    const heading = body.children[0];
    const copy = body.children[1];
    const avatar = root.querySelector(`.${classNames.avatar}`);
    const nameplate = element('span', 'window-nameplate');
    if (avatar) nameplate.append(avatar);
    nameplate.append(heading.children[0]);
    const sender = element('div', 'window-sender');
    sender.append(nameplate);
    if (guard) {
      const icon = element('img', 'window-guard');
      icon.alt = GUARDS[guard];
      setGuardIcon(icon, guard);
      sender.append(icon);
    }
    const medal = item.roomMedal;
    if (medal?.name && Number.isSafeInteger(medal.level) && medal.level > 0) {
      const badge = element('span', 'window-medal');
      if (typeof medal.isLight === 'boolean') badge.dataset.lit = String(medal.isLight);
      for (const [field, token] of [['colorStart', 'start'], ['colorEnd', 'end'], ['colorBorder', 'border'], ['colorText', 'text']]) {
        const color = medal[field];
        if (typeof color === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) {
          badge.style.setProperty(`--medal-${token}`, color);
        }
      }
      badge.append(element('span', 'window-medal-name', medal.name), element('b', 'window-medal-level', String(medal.level)));
      sender.append(badge);
    }
    const controls = element('span', 'window-controls');
    controls.setAttribute('aria-hidden', 'true');
    controls.append(element('i', 'window-minimize'), element('i', 'window-close'));
    heading.replaceChildren(sender, controls);
    body.classList.add('window-content');
    copy.classList.add('window-copy');
    if (gift) {
      copy.querySelector('.draw-danmaku-gift-art')?.remove();
      copy.querySelector('.draw-danmaku-gift-amount')?.remove();
      if (membership) {
        copy.querySelector('.draw-danmaku-gift-action').textContent =
          ({ open: '开通', renew: '续费' })[item.guardAction] || '支持';
        copy.querySelector('.draw-danmaku-gift-name').textContent = membership;
      }
    }
    if (sc) {
      root.classList.add('is-superchat');
      copy.textContent = String(item.message ?? '');
    }
    if (gift || sc) {
      const total = sc ? item.price : item.giftTotalPrice;
      const amount = Number.isFinite(total) && total >= 0
        ? `¥${total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
      const footer = element('div', 'window-footer');
      footer.append(element('span', 'window-event', sc ? '醒目留言' : membership ? '大航海' : '礼物'),
        element('b', 'window-amount', amount));
      body.append(footer);
    }
    const panel = element('div', 'window-panel');
    const frame = element('div', 'window-frame');
    frame.setAttribute('aria-hidden', 'true');
    panel.append(frame, body);
    root.replaceChildren(panel);
    return root;
  };
}
