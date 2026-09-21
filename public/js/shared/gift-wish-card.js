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

export function createGiftWishCard(wish, documentRef = document) {
  const element = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const card = element(
    'article',
    `wish-card${wish.completed ? ' is-complete' : ''}`,
  );
  card.dataset.wishId = wish.id;
  card.setAttribute(
    'aria-label',
    [WISH_PERIODS[wish.period], wish.giftName, wish.label].filter(Boolean).join(' · '),
  );
  const image = element('img', 'wish-card-image');
  image.alt = wish.giftName;
  setGiftImage(image, wish.imagePath);
  const progress = element('div', 'wish-card-progress');
  const total = element('div', 'wish-card-total');
  total.append(
    element('strong', 'wish-card-count', String(wish.count)),
    element('span', 'wish-card-target', ` / ${wish.target}`),
  );
  const track = element('div', 'wish-card-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', `${wish.giftName}收集进度`);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(wish.target));
  track.setAttribute(
    'aria-valuenow',
    String(Math.min(wish.count, wish.target)),
  );
  track.setAttribute(
    'aria-valuetext',
    `已收集 ${wish.count} 个，目标 ${wish.target} 个`,
  );
  const fill = element('div', 'wish-card-fill');
  fill.style.transform = `scaleX(${wish.progress / 100})`;
  track.append(fill);
  progress.append(total, track);
  card.append(image, progress);
  return card;
}
