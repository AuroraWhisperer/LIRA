const GUARD_NAMES = { 1: '总督', 2: '提督', 3: '舰长' };

export function isHarborGiftVisible(item, minimum = 0) {
  return item?.kind !== 'gift' || minimum === 0
    || Number.isFinite(item.giftTotalPrice) && item.giftTotalPrice >= minimum;
}

export function decorateHarborMessage(document, bubble, item, { avatar, identity, body }) {
  const guard = Number(item.roomGuardLevel);
  bubble.dataset.roomGuard = GUARD_NAMES[guard] ? String(guard) : '0';
  if (avatar) decorateAvatar(document, avatar, guard);
  if (item.kind === 'gift') return;
  identity.remove();
  bubble.setAttribute('aria-label', `${item.name || '观众'}${GUARD_NAMES[guard] ? `，${GUARD_NAMES[guard]}` : ''}`);
  if ([1, 2, 3].includes(item.onlineRank)) {
    const badge = document.createElement('span');
    badge.className = 'harbor-rank';
    badge.dataset.rank = String(item.onlineRank);
    badge.textContent = `榜${item.onlineRank}`;
    badge.setAttribute('aria-label', `在线榜第${item.onlineRank}名`);
    bubble.append(badge, body);
  }
}

function decorateAvatar(document, avatar, guard) {
  if (!GUARD_NAMES[guard]) return;
  const portrait = document.createElement('span');
  portrait.className = 'harbor-portrait';
  portrait.setAttribute('aria-hidden', 'true');
  avatar.replaceWith(portrait);
  portrait.append(avatar);
  const frame = document.createElement('span');
  frame.className = 'harbor-avatar-frame';
  portrait.append(frame);
}

export function createHarborGuardCard(document, item, classNames, createAvatar) {
  const root = document.createElement('article');
  root.className = `${classNames.item} ${classNames.bubble} is-gift is-guard-thanks`;
  root.dataset.roomGuard = String(item.giftGuardLevel);
  const name = String(item.name || '观众').trim() || '观众';
  const avatar = createAvatar(item, name, root);
  if (avatar) {
    root.append(avatar);
    decorateAvatar(document, avatar, item.giftGuardLevel);
  }
  const body = document.createElement('div');
  body.className = 'harbor-guard-body';
  const nickname = document.createElement('strong');
  nickname.className = 'harbor-guard-name';
  nickname.textContent = name;
  const amount = document.createElement('span');
  amount.className = 'harbor-guard-amount';
  amount.textContent = Number.isFinite(item.giftTotalPrice) && item.giftTotalPrice >= 0
    ? `CN¥${item.giftTotalPrice.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : 'CN¥—';
  const copy = document.createElement('p');
  copy.className = 'harbor-guard-copy';
  const action = { open: '开通', renew: '续费' }[item.guardAction] || '感谢支持';
  copy.textContent = `${action}${GUARD_NAMES[item.giftGuardLevel]}`;
  if (Number.isSafeInteger(item.guardAccompanyDays) && item.guardAccompanyDays >= 0) {
    copy.textContent += `，已陪伴主播 ${item.guardAccompanyDays} 天`;
  }
  body.append(nickname, amount, copy);
  root.append(body);
  const icon = document.createElement('span');
  icon.className = 'harbor-guard-icon';
  icon.setAttribute('aria-hidden', 'true');
  root.append(icon);
  return root;
}
