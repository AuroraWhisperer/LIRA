import { getGuardIcon, setGuardIcon } from '../shared/bilibili-guard-icons.js';

export function createSnowfoxIdentity(document, item, name, classNames) {
  const identity = document.createElement('div');
  identity.className = classNames.identity;
  const nickname = document.createElement('strong');
  nickname.textContent = name;
  identity.append(nickname);
  if (item.kind === 'gift') return identity;

  const medal = item.roomMedal;
  if (medal?.name && Number.isSafeInteger(medal.level) && medal.level > 0) {
    const badge = document.createElement('span');
    badge.className = 'snowfox-medal';
    badge.textContent = `${medal.name} ${medal.level}`;
    identity.append(badge);
  }
  const guard = Number(item.roomGuardLevel);
  const source = getGuardIcon(guard);
  if (source) {
    const icon = document.createElement('img');
    icon.className = 'snowfox-guard';
    icon.alt = { 1: '总督', 2: '提督', 3: '舰长' }[guard];
    icon.referrerPolicy = 'no-referrer';
    icon.decoding = 'async';
    icon.addEventListener('error', () => icon.remove());
    setGuardIcon(icon, guard);
    identity.append(icon);
  }
  return identity;
}

export function decorateSnowfoxMessage(bubble, item) {
  const guard = Number(item.roomGuardLevel);
  bubble.dataset.roomGuard = [1, 2, 3].includes(guard) ? String(guard) : '0';
  bubble.dataset.roomMedal = String(Boolean(item.roomMedal?.name && Number.isSafeInteger(item.roomMedal.level) && item.roomMedal.level > 0));
}

export function createSnowfoxGuardCard(document, item, classNames) {
  const root = document.createElement('article');
  root.className = `${classNames.item} is-guard-thanks`;
  root.dataset.guard = String(item.giftGuardLevel);
  const name = String(item.name || '观众').trim() || '观众';
  const role = { 1: '总督', 2: '提督', 3: '舰长' }[item.giftGuardLevel];
  const action = { open: '开通', renew: '续费' }[item.guardAction] || '支持';
  root.setAttribute('aria-label', `${name}，${action}${role}`);
  const card = document.createElement('div');
  card.className = 'snowfox-member';
  const heading = document.createElement('span');
  heading.className = 'snowfox-member-title';
  heading.textContent = 'NEW MEMBER';
  const nickname = document.createElement('strong');
  nickname.className = 'snowfox-member-name';
  nickname.textContent = name;
  card.append(heading, nickname);
  root.append(card);
  return root;
}
