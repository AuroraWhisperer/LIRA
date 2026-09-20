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
  const top = element('div', 'wish-card-top');
  const type = element('span', 'wish-card-period', WISH_PERIODS[wish.period]);
  const state = element(
    'span',
    'wish-card-state',
    wish.completed ? '心愿达成' : '收集中',
  );
  top.append(type, state);
  const main = element('div', 'wish-card-main');
  const art = element('div', 'wish-card-art');
  const image = element('img', 'wish-card-image');
  image.alt = '';
  setGiftImage(image, wish.imagePath);
  art.append(image);
  const detail = element('div', 'wish-card-detail');
  const name = element('h4', 'wish-card-name', wish.giftName);
  const label = element(
    'p',
    'wish-card-label',
    wish.label || '一起攒满这份小心愿',
  );
  detail.append(name, label);
  main.append(art, detail);
  const counts = element('div', 'wish-card-counts');
  const total = element('div', 'wish-card-total');
  total.append(
    element('strong', 'wish-card-count', String(wish.count)),
    element('span', 'wish-card-target', ` / ${wish.target}`),
  );
  const remaining = element(
    'span',
    'wish-card-remaining',
    wish.completed ? '谢谢每一份心意' : `还差 ${wish.remaining} 个`,
  );
  counts.append(total, remaining);
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
  card.append(top, main, counts, track);
  return card;
}
