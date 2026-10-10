import { HONOR_BADGES, GUARD_ICONS } from './danmaku-bilibili-badges.js';

// Hue families keep the washes soft while varying both colors and placement per event.
const PRISMATIC_PALETTES = [
  [345, 35, 320, 55],
  [165, 205, 185, 75],
  [255, 320, 275, 210],
  [25, 65, 40, 350],
  [200, 240, 155, 185],
  [315, 355, 285, 35],
  [90, 155, 65, 185],
  [280, 210, 250, 335],
  [45, 15, 190, 65],
  [175, 135, 55, 205],
  [230, 285, 25, 195],
  [350, 300, 155, 25],
];

// Event identity, not viewer identity or list position, owns the static color recipe.
export function decoratePrismaticMessage(bubble, item) {
  const guard = Number(item.roomGuardLevel);
  bubble.dataset.roomGuard = [1, 2, 3].includes(guard) ? String(guard) : '0';
  if (bubble.dataset.roomGuard === '0' || item.kind === 'gift') return;
  const seed = [item.id, item.timestamp, item.uid, item.name, item.message].join('|');
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  const next = () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return ((hash ^= hash >>> 16) >>> 0) / 4294967296;
  };
  const palette = PRISMATIC_PALETTES[Math.floor(next() * PRISMATIC_PALETTES.length)];
  for (let i = 0; i < palette.length; i += 1) {
    const hue = (palette[i] + Math.floor(next() * 17) - 8 + 360) % 360;
    bubble.style.setProperty(`--prismatic-color-${i}`, `hsl(${hue} ${70 + Math.floor(next() * 13)}% ${84 + Math.floor(next() * 7)}%)`);
  }
  bubble.style.setProperty('--prismatic-angle', `${Math.floor(next() * 360)}deg`);
  for (const spot of ['a', 'b']) {
    bubble.style.setProperty(`--prismatic-spot-${spot}`, `${Math.floor(next() * 101)}% ${Math.floor(next() * 101)}%`);
    bubble.style.setProperty(`--prismatic-spread-${spot}`, `${45 + Math.floor(next() * 36)}%`);
  }
}

export function createPrismaticIdentity(document, item, name, classNames, resolveImageUrl) {
  const identity = document.createElement('div');
  identity.className = classNames.identity;
  const image = (source, className, label) => {
    const url = source && resolveImageUrl(source);
    if (!url) return null;
    const node = document.createElement('img');
    node.className = className;
    node.alt = label;
    node.referrerPolicy = 'no-referrer';
    node.decoding = 'async';
    node.addEventListener('error', () => node.remove());
    node.src = url;
    return node;
  };
  const honorSource = Object.hasOwn(HONOR_BADGES, item.honorLevel) ? HONOR_BADGES[item.honorLevel] : '';
  const honor = image(honorSource, 'prismatic-honor', `荣耀 ${item.honorLevel} 级`);
  if (honor) identity.append(honor);
  if (item.kind !== 'gift') {
    const medal = item.roomMedal;
    const guardLevel = Number(medal?.guardLevel ?? item.roomGuardLevel);
    const guard = image(GUARD_ICONS[guardLevel], 'prismatic-guard', ({ 1: '总督', 2: '提督', 3: '舰长' })[guardLevel]);
    if (medal?.name && Number.isSafeInteger(medal.level) && medal.level > 0) {
      const badge = document.createElement('span');
      badge.className = 'prismatic-medal';
      if (typeof medal.isLight === 'boolean') badge.dataset.lit = String(medal.isLight);
      for (const [field, token] of [['colorStart', 'start'], ['colorEnd', 'end'], ['colorBorder', 'border'], ['colorText', 'text']]) {
        const color = medal[field];
        if (typeof color === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color) && [7, 9].includes(color.length)) {
          badge.style.setProperty(`--medal-${token}`, color);
        }
      }
      if (guard) badge.append(guard);
      const title = document.createElement('span');
      title.textContent = medal.name;
      const level = document.createElement('b');
      level.className = 'prismatic-medal-level';
      level.textContent = String(medal.level);
      badge.append(title, level);
      identity.append(badge);
    } else if (guard) identity.append(guard);
  }
  const nickname = document.createElement('strong');
  nickname.textContent = name;
  identity.append(nickname);
  return identity;
}

export function createPrismaticGuardCard(document, item, classNames, createAvatar) {
  const root = document.createElement('article');
  root.className = `${classNames.item} ${classNames.bubble} is-gift is-guard-thanks`;
  root.dataset.guard = String(item.giftGuardLevel);
  const card = document.createElement('div');
  card.className = 'prismatic-guard-card';
  const name = String(item.name || '观众').trim() || '观众';
  const avatar = createAvatar(item, name, root);
  if (avatar) card.append(avatar);
  const nickname = document.createElement('strong');
  nickname.className = 'prismatic-guard-name';
  nickname.textContent = name;
  const copy = document.createElement('p');
  copy.className = 'prismatic-guard-copy';
  const action = { open: '开通', renew: '续费' }[item.guardAction] || '感谢支持';
  copy.textContent = `${action}${{ 1: '总督', 2: '提督', 3: '舰长' }[item.giftGuardLevel]}`;
  if (Number.isSafeInteger(item.guardAccompanyDays) && item.guardAccompanyDays >= 0) {
    copy.textContent += `，已陪伴主播 ${item.guardAccompanyDays} 天`;
  }
  card.append(nickname, copy);
  if (Number.isFinite(item.giftTotalPrice) && item.giftTotalPrice >= 0) {
    const amount = document.createElement('span');
    amount.className = 'prismatic-guard-amount';
    amount.textContent = item.giftTotalPrice.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    card.append(amount);
  }
  root.append(card);
  return root;
}
