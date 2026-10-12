const GUARD_NAMES = { 1: '总督', 2: '提督', 3: '舰长' };

export function decorateMistMessage(bubble, item, { avatar, identity, body, message }) {
  const guard = Number(item.roomGuardLevel);
  bubble.dataset.roomGuard = GUARD_NAMES[guard] ? String(guard) : '0';
  if (item.kind === 'gift') {
    body.replaceChildren(message, identity);
    return;
  }
  body.replaceChildren(...(avatar ? [avatar] : []), message);
  bubble.replaceChildren(identity, body);
}

export function createMistGuardCard(document, item, classNames, createAvatar) {
  const root = document.createElement('article');
  root.className = `${classNames.item} ${classNames.bubble} is-gift is-guard-thanks`;
  root.dataset.roomGuard = String(item.giftGuardLevel);
  const card = node('div', 'mist-guard-card');
  const profile = node('div', 'mist-guard-profile');
  const name = String(item.name || '观众').trim() || '观众';
  const avatar = createAvatar(item, name, root);
  if (avatar) profile.append(avatar);
  profile.append(node('strong', 'mist-guard-name', name));
  const seal = node('span', 'mist-guard-seal');
  seal.setAttribute('aria-hidden', 'true');
  const action = { open: '开通', renew: '续费' }[item.guardAction] || '感谢支持';
  const title = node('p', 'mist-guard-title', `${action}${GUARD_NAMES[item.giftGuardLevel]}`);
  if (Number(item.giftCount) > 1) title.append(node('span', 'mist-guard-count', ` × ${item.giftCount}`));
  const footer = node('div', 'mist-guard-footer');
  const days = item.guardAccompanyDays;
  footer.append(node('span', 'mist-guard-companion', Number.isSafeInteger(days) && days >= 0
    ? `已陪伴 ${days} 天` : '感谢你的陪伴'));
  const total = item.giftTotalPrice;
  footer.append(node('span', 'mist-guard-amount', Number.isFinite(total) && total >= 0
    ? `¥${total.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '—'));
  card.append(profile, seal, title, footer);
  root.append(card);
  return root;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
}
