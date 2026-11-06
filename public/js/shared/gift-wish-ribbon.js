import { setGiftImage } from './gift-image-fallback.js';
import { GIFT_WISH_RIBBON_FIELDS, getRibbonDecorationStyle } from './gift-wish-ribbon-appearance.js';

const DECORATION_IMAGES = {
  bow: '/img/shared/gift-wish-ribbon/bow.webp',
  sakura: '/img/shared/gift-wish-ribbon/sakura.webp',
  candy: '/img/shared/gift-wish-ribbon/candy.webp',
  star: '/img/shared/gift-wish-ribbon/star.webp',
};

const views = new WeakMap();

export function mountRibbonGiftWish(card, wish, documentRef) {
  const element = (tag, className) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    return node;
  };
  card.classList.add('wish-card--ribbon');
  const frame = element('div', 'wish-ribbon-frame');
  frame.setAttribute('role', 'progressbar');
  frame.setAttribute('aria-valuemin', '0');
  const fill = element('div', 'wish-ribbon-fill');
  const flow = element('span', 'wish-ribbon-flow');
  fill.setAttribute('aria-hidden', 'true');
  fill.append(flow);
  const image = element('img', 'wish-card-image');
  image.alt = '';
  const name = element('span', 'wish-ribbon-name');
  const total = element('div', 'wish-ribbon-total');
  const count = element('strong', 'wish-ribbon-count');
  const target = element('span', 'wish-ribbon-target');
  total.append(count, target);
  frame.append(fill, image, name, total);
  const flourish = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  flourish.setAttribute('class', 'wish-ribbon-flourish wish-ribbon-flourish--pastry');
  flourish.setAttribute('viewBox', '0 0 80 34');
  flourish.setAttribute('aria-hidden', 'true');
  const pastry = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
  pastry.setAttribute('class', 'wish-ribbon-pastry');
  pastry.setAttribute('d', 'M4 16C3 11 7 8 12 7L67 1C72 0 76 4 77 9L78 16C78 21 74 24 68 25L16 32C8 33 2 29 2 23Z');
  const icing = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
  icing.setAttribute('class', 'wish-ribbon-icing');
  icing.setAttribute('d', 'M4 16C3 11 7 8 12 7L67 1C72 0 76 4 77 9L76 12C73 15 70 10 67 11C64 12 63 19 56 21C48 24 42 23 38 20C35 18 32 19 29 20C26 22 21 21 17 23C11 26 7 20 5 21C2 23 2 19 4 16Z');
  flourish.append(pastry, icing);
  const sticker = element('img', 'wish-ribbon-flourish wish-ribbon-sticker');
  sticker.alt = '';
  sticker.setAttribute('aria-hidden', 'true');
  card.append(frame, flourish, sticker);
  views.set(card, { frame, fill, image, name, count, target, sticker });
  updateRibbonGiftWish(card, wish);
  return card;
}

export function updateRibbonGiftWish(card, wish) {
  const view = views.get(card);
  const progress = Math.max(0, Math.min(100, wish.progress));
  card.classList.toggle('is-complete', wish.completed);
  for (const [key, field] of Object.entries(GIFT_WISH_RIBBON_FIELDS)) {
    const value = wish[key] ?? field.default;
    if (!['ribbonDecorations', 'ribbonDecorationStyle'].includes(key)) {
      const property = `--wish-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
      if (field.optional && value === '') {
        card.style.removeProperty(property);
        continue;
      }
      const unit = field.type === 'number' ? key === 'ribbonSpeed' ? 's' : 'px' : '';
      card.style.setProperty(property, `${value}${unit}`);
    }
  }
  const decoration = getRibbonDecorationStyle(wish);
  card.classList.toggle('has-ribbon-decoration', decoration !== 'none');
  card.dataset.ribbonDecoration = decoration;
  if (view.decoration !== decoration) {
    if (Object.hasOwn(DECORATION_IMAGES, decoration)) view.sticker.src = DECORATION_IMAGES[decoration];
    else view.sticker.removeAttribute('src');
    view.decoration = decoration;
  }
  card.classList.toggle('is-ribbon-static', wish.ribbonSpeed === 0);
  card.setAttribute('aria-label', `${wish.giftName} · 已收集 ${wish.count} 个，目标 ${wish.target} 个`);
  view.name.textContent = wish.giftName;
  view.name.title = wish.giftName;
  if (view.source !== wish.imagePath || !view.image.hasAttribute('src')) {
    setGiftImage(view.image, wish.imagePath);
    view.source = wish.imagePath;
  }
  view.count.textContent = String(wish.count);
  view.target.textContent = `/${wish.target}`;
  card.style.setProperty('--wish-ribbon-number-length', String(view.count.textContent.length + view.target.textContent.length));
  view.frame.setAttribute('aria-label', `${wish.giftName}收集进度`);
  view.frame.setAttribute('aria-valuemax', String(wish.target));
  view.frame.setAttribute('aria-valuenow', String(Math.min(wish.count, wish.target)));
  view.frame.setAttribute('aria-valuetext', `已收集 ${wish.count} 个，目标 ${wish.target} 个`);
  view.fill.style.clipPath = `inset(0 ${100 - progress}% 0 0)`;
}
