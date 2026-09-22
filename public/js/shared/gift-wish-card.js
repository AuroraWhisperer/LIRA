import { setGiftImage } from './gift-image-fallback.js';

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

export function formatGiftWishText(wish) {
  const values = { 礼物: wish.giftName, 已收: wish.count, 目标: wish.target };
  return (wish.textTemplate?.trim() || DEFAULT_WISH_TEXT).replace(/\{(礼物|已收|目标)\}/g, (_match, key) =>
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
  if (wish.displayStyle === 'text') {
    card.classList.add('wish-card--text');
    card.append(element('p', 'wish-card-text', formatGiftWishText(wish)));
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
  const fill = element('div', 'wish-card-fill');
  fill.style.transform = `scaleX(${wish.progress / 100})`;
  track.append(fill);
  progress.append(total, track);
  card.append(image, progress);
  return card;
}
