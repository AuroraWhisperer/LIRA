import { setGiftImage } from './gift-image-fallback.js';
import { setGiftWishTextImage } from './gift-wish-image.js';
import { mountMoonlitGiftWish, updateMoonlitGiftWish } from './gift-wish-moonlit.js';

export const WISH_PERIODS = {
  long: '长效许愿',
  day: '本日许愿',
  session: '本场直播许愿',
};
export const WISH_CATEGORIES = {
  guard: '大航海',
  blindBox: '盲盒本体',
  blindBoxOutput: '盲盒产出',
  directGift: '礼物',
};
export const DEFAULT_WISH_TEXT = '许愿{礼物}（{已收}/{目标}）';
export const DEFAULT_WISH_TEXT_COLORS = { pending: '#3b6ea8', received: '#21815c' };

export function getGiftWishTextTemplate(wish) {
  const template = wish.textTemplate?.trim() || DEFAULT_WISH_TEXT;
  if (template.includes('{图片}')) return template;
  // Keep saved image positions readable until the editor saves explicit image tokens.
  if (wish.textImagePosition === 'after') return `${template}{图片}`;
  if (wish.textImagePosition === 'inline' && template.includes('{礼物}'))
    return template.replace('{礼物}', '{图片}{礼物}');
  if (wish.textImagePosition === 'before' || wish.textImagePosition === 'inline') return `{图片}${template}`;
  return template;
}

export function formatGiftWishText(wish, template = wish.textTemplate?.trim() || DEFAULT_WISH_TEXT) {
  const values = { 礼物: wish.giftName, 已收: wish.count, 目标: wish.target };
  return template.replace(/\{(礼物|已收|目标)\}/g, (_match, key) =>
    String(values[key]),
  );
}

export function createGiftWishCard(wish, documentRef = document) {
  const element = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const card = element('article', `wish-card${wish.completed ? ' is-complete' : ''}`);
  card.dataset.wishId = wish.id;
  card.setAttribute('aria-label', [WISH_PERIODS[wish.period], wish.giftName, wish.label].filter(Boolean).join(' · '));
  if (wish.displayStyle === 'moonlit') return mountMoonlitGiftWish(card, wish, documentRef);
  if (wish.displayStyle === 'text') {
    card.classList.add('wish-card--text');
    card.classList.toggle('is-received-today', wish.todayCount > 0);
    card.style.setProperty('--wish-ink', wish.todayCount > 0
      ? wish.textReceivedColor || DEFAULT_WISH_TEXT_COLORS.received
      : wish.textPendingColor || DEFAULT_WISH_TEXT_COLORS.pending);
    const text = element('p', 'wish-card-text');
    const parts = getGiftWishTextTemplate(wish).split('{图片}');
    parts.forEach((part, index) => {
      if (index > 0) {
        const image = element('img', 'wish-card-text-image');
        image.alt = '';
        setGiftWishTextImage(image, wish.imagePath, wish.textImageFormat);
        text.append(image);
      }
      if (part) text.append(documentRef.createTextNode(formatGiftWishText(wish, part)));
    });
    card.append(text);
    return card;
  }
  const image = element('img', 'wish-card-image');
  image.alt = wish.giftName;
  setGiftImage(image, wish.imagePath);
  const progress = element('div', 'wish-card-progress');
  const total = element('div', 'wish-card-total');
  total.append(
    element('strong', 'wish-card-count', String(wish.count)),
    element('span', 'wish-card-target', wish.displayStyle === 'circle' ? `/${wish.target}` : ` / ${wish.target}`),
  );
  const track = wish.displayStyle === 'circle' ? total : element('div', 'wish-card-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', `${wish.giftName}收集进度`);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(wish.target));
  track.setAttribute('aria-valuenow', String(Math.min(wish.count, wish.target)));
  track.setAttribute('aria-valuetext', `已收集 ${wish.count} 个，目标 ${wish.target} 个`);
  if (wish.displayStyle === 'circle') {
    card.classList.add('wish-card--circle');
    const frame = element('div', 'wish-card-circle');
    frame.append(image);
    card.append(frame, total);
    return card;
  }
  card.classList.add('wish-card--bar');
  const fill = element('div', 'wish-card-fill');
  fill.style.transform = `scaleX(${wish.progress / 100})`;
  track.append(fill);
  progress.append(total, track);
  card.append(image, progress);
  return card;
}

export function renderGiftWishCards(root, wishes) {
  const previous = new Map([...root.children].map(card => [card.dataset.wishId, card]));
  const retained = new Set();
  wishes.forEach((wish, index) => {
    let card = previous.get(wish.id);
    if (wish.displayStyle === 'moonlit' && card?.classList.contains('wish-card--moonlit')) {
      updateMoonlitGiftWish(card, wish);
    } else card = createGiftWishCard(wish, root.ownerDocument);
    retained.add(card);
    // Keep live moonlit nodes attached so progress transitions and particles continue.
    if (root.children[index] !== card) root.insertBefore(card, root.children[index] || null);
  });
  for (const card of [...root.children]) if (!retained.has(card)) card.remove();
}
